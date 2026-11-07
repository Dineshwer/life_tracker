import * as THREE from 'three';
import type { BuildBody } from './types';
/** STUB: replaced by the body agent. */
export const buildBody: BuildBody = (_state, mats) => {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.2, 4, 12), mats.skin); m.position.y = 0.9; root.add(m);
  const o = () => new THREE.Group();
  const slots = Object.fromEntries(['head','headTop','neck','chest','back','waist','shoulderL','shoulderR','upperArmL','upperArmR','forearmL','forearmR','handL','handR','thighL','thighR','shinL','shinR','footL','footR','floor'].map((k) => [k, o()])) as never;
  return { root, dims: { height: 1.8, shoulderW: .5, chestW: .4, chestD: .25, waistW: .32, hipW: .36, armLen: .7, armR: .06, legLen: .9, legR: .09, headR: .12, neckY: 1.5, chestY: 1.25, waistY: 1, hipY: .9 }, slots, update() {}, dispose() { m.geometry.dispose(); } };
};
