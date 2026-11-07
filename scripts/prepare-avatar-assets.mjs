/* Builds the optimised avatar assets in public/avatar/ from the Quaternius CC0 packs
   (Universal Base Characters + Modular Character Outfits - Fantasy).

   HOW TO RUN (dependencies live OUTSIDE the project, nothing is added to package.json):
     mkdir -p /tmp/avatar-prep && cd /tmp/avatar-prep && npm init -y && npm i @gltf-transform/core @gltf-transform/functions sharp
     cp /path/to/life-tracker/scripts/prepare-avatar-assets.mjs . && cp /path/to/life-tracker/scripts/*.mjs . 2>/dev/null
     node prepare-avatar-assets.mjs <UBC_DIR> <MCO_DIR> <OUT_DIR>
   where UBC_DIR = ".../Universal Base Characters[Standard]", MCO_DIR = ".../Modular Character Outfits - Fantasy[Standard]",
   OUT_DIR = /path/to/life-tracker/public/avatar.
   Defaults below match the scratch locations used while developing.

   Output (all .glb, one shared skeleton by bone NAME, textures WebP, normal / ORM maps dropped):
     head.glb      base head + neck (body triangles whose dominant bone is not head/neck are removed), eyes, eyebrows,
                   (no hands or feet: the outfits bring their own) used when no clothing covers them
     hair.glb      Hair_SimpleParted (rigged to the Head bone)
     peasant.glb   Male_Peasant Body / Arms (sleeves + Hands) / Legs / Feet, plus Feet_Bare (bare feet from the base body)
     ranger.glb    Male_Ranger Body (+belts) / Arms (+Hands) / Legs / Boots / Pauldron (no hood: it would hide the hair) as separate named meshes */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, mergeDocuments } from '@gltf-transform/functions';

const SCRATCH = '/tmp/claude-1003/-home-dinesh-personal/2e9fb0a2-31d0-4654-9731-bdba73894c2e/scratchpad/models';
const UBC = process.argv[2] || `${SCRATCH}/ubc/Universal Base Characters[Standard]`;
const MCO_ROOT = process.argv[3] || fs.readdirSync(`${SCRATCH}/mco`).map((d) => `${SCRATCH}/mco/${d}`)[0];
const OUT = process.argv[4] || '/home/dinesh/personal/life-tracker/public/avatar';
const BASE = `${UBC}/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`;
const HAIRDIR = `${UBC}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)`;
const PARTS = `${MCO_ROOT}/Exports/glTF (Godot-Unreal)/Modular Parts`;

const io = new NodeIO().registerExtensions([EXTTextureWebP]);

/** read a .gltf; a few textures are referenced under renamed files, so resources are resolved by hand */
async function readGltf(file) {
  const dir = path.dirname(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const resources = {};
  for (const b of json.buffers || []) resources[b.uri] = new Uint8Array(fs.readFileSync(path.join(dir, b.uri)));
  for (const im of json.images || []) {
    const hit = [im.uri, im.uri.replace('_png.png', '.png')].find((c) => fs.existsSync(path.join(dir, c)));
    resources[im.uri] = hit ? new Uint8Array(fs.readFileSync(path.join(dir, hit))) : new Uint8Array(0);
  }
  return io.readJSON({ json, resources });
}

const skinMeshes = (doc) => doc.getRoot().listNodes().filter((n) => n.getMesh() && n.getSkin());

/** keep only the triangles for which keep(dominantJointNames[]) is true; compacts the vertices */
function filterPrimitive(doc, prim, jointNames, keep) {
  const J = prim.getAttribute('JOINTS_0').getArray(), W = prim.getAttribute('WEIGHTS_0').getArray();
  const dom = (v) => { let b = 0; for (let k = 1; k < 4; k++) if (W[v * 4 + k] > W[v * 4 + b]) b = k; return jointNames[J[v * 4 + b]]; };
  const idx = prim.getIndices().getArray();
  const kept = [];
  for (let i = 0; i < idx.length; i += 3) if (keep(dom(idx[i]), dom(idx[i + 1]), dom(idx[i + 2]))) kept.push(idx[i], idx[i + 1], idx[i + 2]);
  const remap = new Map(); let n = 0;
  for (const v of kept) if (!remap.has(v)) remap.set(v, n++);
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem), size = acc.getElementSize(), src = acc.getArray();
    const dst = new src.constructor(n * size);
    for (const [o, nw] of remap) for (let k = 0; k < size; k++) dst[nw * size + k] = src[o * size + k];
    prim.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(dst).setNormalized(acc.getNormalized()).setBuffer(acc.getBuffer()));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept.map((v) => remap.get(v)))).setBuffer(prim.getAttribute('POSITION').getBuffer()));
}

/** strip attributes we do not use, drop normal + ORM maps, flatten roughness */
function simplifyMaterials(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
    m.setMetallicFactor(0).setRoughnessFactor(0.85);
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives())
    for (const sem of p.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].includes(sem)) p.setAttribute(sem, null);
}

/** resize every colour texture (by name pattern -> max size) and encode as WebP */
async function compressTextures(doc, sizes) {
  for (const t of doc.getRoot().listTextures()) {
    const buf = t.getImage();
    if (!buf || !buf.byteLength) { continue; }
    const name = t.getURI() || t.getName();
    const max = (sizes.find(([re]) => re.test(name)) || [0, 512])[1];
    const out = await sharp(Buffer.from(buf), { limitInputPixels: false })
      .resize(max, max, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 5 }).toBuffer();
    t.setImage(new Uint8Array(out)).setMimeType('image/webp').setURI('');
  }
}

async function finish(doc, name, sizes) {
  doc.createExtension(EXTTextureWebP).setRequired(true);
  simplifyMaterials(doc);
  await doc.transform(prune({ keepLeaves: true }), dedup());
  await compressTextures(doc, sizes);
  await doc.transform(prune({ keepLeaves: true }));
  const file = path.join(OUT, name);
  await io.write(file, doc);
  const kb = Math.round(fs.statSync(file).size / 1024);
  const tris = doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getIndices().getCount() / 3, 0), 0);
  console.log(name.padEnd(14), String(kb).padStart(6), 'KB', Math.round(tris), 'tris');
  return kb;
}

/** merge several single-part documents into one: shared textures deduped, all meshes under one scene */
async function mergeParts(files, rename, extra = []) {
  const docs = [...(await Promise.all(files.map(readGltf))), ...extra];
  const doc = docs[0];
  for (const d of docs.slice(1)) mergeDocuments(doc, d);
  const scenes = doc.getRoot().listScenes();
  for (const s of scenes.slice(1)) { for (const c of s.listChildren()) scenes[0].addChild(c); s.dispose(); }
  const bufs = doc.getRoot().listBuffers();
  for (const a of doc.getRoot().listAccessors()) a.setBuffer(bufs[0]);
  for (const b of bufs.slice(1)) b.dispose();
  // one skeleton: every skin points at the first skin's joint nodes (by name); the duplicate armatures are removed
  const skins = doc.getRoot().listSkins();
  const byName = new Map(skins[0].listJoints().map((j) => [j.getName(), j]));
  const dupes = new Set();
  for (const sk of skins.slice(1)) {
    const joints = sk.listJoints();
    joints.forEach((j) => { dupes.add(j); sk.removeJoint(j); });
    joints.forEach((j) => sk.addJoint(byName.get(j.getName())));
    sk.setSkeleton(null);
  }
  for (const n of skinMeshes(doc)) scenes[0].addChild(n); // skinned meshes live at the scene root (skinning ignores their transform)
  for (const sc of scenes.slice(0, 1)) for (const c of sc.listChildren()) if (!c.getMesh() && c !== skins[0].listJoints()[0] && /armature/i.test(c.getName()) && c !== skins[0].getSkeleton()) {
    const keep = new Set(); let top = skins[0].listJoints()[0]; while (top.getParentNode()) top = top.getParentNode(); keep.add(top);
    if (!keep.has(c)) c.traverse((n) => n.dispose());
  }
  for (const n of skinMeshes(doc)) rename(n, doc);
  for (const n of skinMeshes(doc)) if (/Belt_2$/.test(n.getName())) n.dispose(); // alternative belt, unused
  return doc;
}

fs.mkdirSync(OUT, { recursive: true });
let total = {};

// ---- head.glb ---------------------------------------------------------------------------------
{
  const doc = await readGltf(BASE);
  const body = skinMeshes(doc).find((n) => n.getName() === 'SuperHero_Male');
  const names = body.getSkin().listJoints().map((j) => j.getName());
  const prim = body.getMesh().listPrimitives()[0];
  filterPrimitive(doc, prim, names, (a, b, c) => [a, b, c].every((n) => /^(head|neck)/i.test(n)));
  body.setName('HeadSkin'); // not 'Head': that is the name of the head bone
  for (const n of skinMeshes(doc)) if (n.getName() === 'Eyes') n.setName('Eyes'); else if (n.getName() === 'Eyebrows') n.setName('Eyebrows');
  total['head.glb'] = await finish(doc, 'head.glb', [[/Superhero/i, 2048], [/Eye/i, 256]]);
}
// ---- hair.glb ---------------------------------------------------------------------------------
{
  const doc = await readGltf(`${HAIRDIR}/Hair_SimpleParted.gltf`);
  total['hair.glb'] = await finish(doc, 'hair.glb', [[/Hair/i, 1024]]);
}
// ---- outfits ----------------------------------------------------------------------------------
/** bare lower legs and feet cut from the base body (shown with the plain band-1 clothes that have no shoes) */
async function bareFeet() {
  const doc = await readGltf(BASE);
  for (const n of skinMeshes(doc)) if (n.getName() !== 'SuperHero_Male') n.dispose();
  const body = skinMeshes(doc)[0];
  const names = body.getSkin().listJoints().map((j) => j.getName());
  filterPrimitive(doc, body.getMesh().listPrimitives()[0], names, (a, b, c) => [a, b, c].every((n) => /calf|foot|ball/i.test(n)));
  body.setName('Feet_Bare');
  return doc;
}
const outfit = async (prefix, list, sizes, extra = []) => {
  const doc = await mergeParts(list.map((p) => `${PARTS}/${prefix}_${p}.gltf`), (n, d) => {
    // a part with two materials (clothing + bare hands) becomes two nodes so each can be addressed by name
    for (const prim of n.getMesh().listPrimitives()) {
      if (prim.getMaterial()?.getName() !== 'MI_Regular_Male' || n.getMesh().listPrimitives().length < 2) continue;
      n.getMesh().removePrimitive(prim);
      const nm = n.getName() + '_Hands';
      d.getRoot().listScenes()[0].addChild(d.createNode(nm).setMesh(d.createMesh(nm).addPrimitive(prim)).setSkin(n.getSkin()));
    }
  }, extra);
  return finish(doc, `${prefix.split('_')[1].toLowerCase()}.glb`, sizes);
};
total['peasant.glb'] = await outfit('Male_Peasant', ['Body', 'Arms', 'Legs', 'Feet'], [[/Superhero/i, 1024], [/Regular_Male/i, 1024], [/Peasant/i, 2048]], [await bareFeet()]);
total['ranger.glb'] = await outfit('Male_Ranger', ['Body', 'Arms', 'Legs', 'Feet_Boots', 'Acc_Pauldron'], [[/Regular_Male/i, 1024], [/Ranger/i, 2048]]);
console.log('total KB', Object.values(total).reduce((a, b) => a + b, 0));
