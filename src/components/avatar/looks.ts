import * as THREE from 'three';
import type { ApplyLook, MakeMaterials } from './types';
/** STUB: replaced by the looks agent. */
export const makeMaterials: MakeMaterials = () => {
  const mk = (c: number) => new THREE.MeshStandardMaterial({ color: c });
  return { skin: mk(0xe0b090), hair: mk(0x3a2a20), cloth: mk(0x446688), cloth2: mk(0x88aacc), accent: mk(0xffaa33), metal: mk(0x999999), dark: mk(0x222222), glow: new THREE.MeshBasicMaterial({ color: 0xffdd88 }),
    stat: { body: 0xff8a5c, mind: 0x5cc8ff, skill: 0xffd35c, discipline: 0xb48cff }, accentHex: 0xffaa33, accent2Hex: 0x88ccff, bgHex: 0x101418, textHex: 0xffffff, outline: false, addOutline: () => null, dispose() {} };
};
export const applyLook: ApplyLook = ({ scene }) => {
  const l = new THREE.DirectionalLight(0xffffff, 2); l.position.set(2, 4, 3); scene.add(l, new THREE.AmbientLight(0xffffff, 0.8));
  return { update() {}, camera: { fov: 35, distance: 5.2, height: 1.1, lookAtY: 0.95 }, dispose() { scene.remove(l); } };
};
