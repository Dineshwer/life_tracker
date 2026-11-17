// Static CSS audit: class collisions across files, hard-coded colours/fonts outside tokens+skins, !important.
// Usage: node scripts/audit-css.mjs
import fs from 'node:fs'; import path from 'node:path';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.join(d, e.name)] : []);
const files = walk('src');
const isShared = (f) => /src\/styles\/(tokens|skins\/)/.test(f.replace(/\\/g, '/'));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const defs = new Map(); const colours = []; const fonts = []; const imps = [];
for (const f of files) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  const lines = src.split('\n');
  lines.forEach((ln, i) => {
    // selectors: text before '{'
    const pre = ln.replace(/\{[^}]*\}/g, '{}');
    for (const m of ln.matchAll(/([^{}]+)\{/g)) {
      if (/^\s*(@|from|to|\d+%)/.test(m[1])) continue;
      for (const c of m[1].matchAll(/\.([a-zA-Z_][\w-]*)/g)) { if (!defs.has(c[1])) defs.set(c[1], new Map()); defs.get(c[1]).set(f, (defs.get(c[1]).get(f) ?? 0) + 1); }
    }
    if (!isShared(f) && !/skins\//.test(f)) {
      const decl = ln.replace(/var\([^)]*\)/g, '');
      const hc = decl.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g);
      if (hc) colours.push(`${f}:${i + 1}  ${hc.slice(0, 4).join(' ')}`);
      if (/font-family\s*:/.test(ln) && !/font-family\s*:\s*(var\(|inherit)/.test(ln)) fonts.push(`${f}:${i + 1}  ${ln.match(/font-family\s*:[^;}]*/)[0]}`);
    }
    if (/!important/.test(ln)) imps.push(`${f}:${i + 1}`);
  });
}
const coll = [...defs].filter(([, m]) => m.size > 1).sort();
console.log(`# ${files.length} css files\n\n## Class selectors in more than one file (${coll.length})`);
for (const [c, m] of coll) console.log(`.${c}: ${[...m.keys()].map((f) => path.relative('src', f)).join(', ')}`);
console.log(`\n## Hard-coded colours outside tokens/skins (${colours.length})`); colours.forEach((l) => console.log(l));
console.log(`\n## Hard-coded font-family (${fonts.length})`); fonts.forEach((l) => console.log(l));
console.log(`\n## !important (${imps.length})`); console.log(imps.join('\n'));
