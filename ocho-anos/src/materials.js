import * as THREE from 'three/webgpu';
import { uniform, color, sin, time, mx_noise_float, vec2, step, mix } from 'three/tsl';

export const neonGlow = uniform(1.5);

function neonMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ color: '#ffe9b0', roughness: 0.35, metalness: 0 });
  const hum = sin(time.mul(90)).mul(0.03).add(0.97);                        // fast, barely visible shimmer
  const stutter = mix(1, 0.55, step(0.93, mx_noise_float(vec2(time.mul(6), 0.5)))); // now and then a short dip
  material.emissiveNode = color('#ffc85a').mul(neonGlow).mul(hum).mul(stutter);
  return material;
}

const LIBRARY = {
  // ---------- glass ----------
  'Material.007': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#ffffff', metalness: 0, roughness: 0.04,
    transmission: 1, thickness: 0.08, ior: 1.5, dispersion: 0.3,
  }),
  // frosted "Rojo" lettering on the bottle
  'Outer': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#ffffff', metalness: 0, roughness: 0.45, transmission: 1, thickness: 0.02, ior: 1.5,
  }),

  // ---------- metal ----------
  'Chrome Metal': () => new THREE.MeshStandardNodeMaterial({ color: '#d6d6d6', metalness: 1, roughness: 0.1 }),

  // ---------- neon "shots" sign ----------
  'Material': neonMaterial,

  // ---------- salt rim on the shot glasses ----------
  'Material.009': () => new THREE.MeshPhysicalNodeMaterial({ color: '#f5f2ec', roughness: 0.9, sheen: 1, sheenColor: '#ffffff' }),
};

export function applyMaterials(root) {
  const made = new Map();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const name = obj.material.name;
    if (!LIBRARY[name]) return;
    if (!made.has(name)) {
      const material = LIBRARY[name]();
      material.name = name;
      made.set(name, material);
    }
    obj.material = made.get(name);
  });
  console.log('materials replaced:', [...made.keys()].join(', '));
}
