import * as THREE from 'three/webgpu';
import {
  tileMaterial, stoneMaterial, copperMaterial, chromeMaterial, agaveMaterial, pinaMaterial, strawMaterial,
} from './textures.js';

// three.js materials per Blender material name. Procedural Blender shaders don't export to glTF
// (they come out grey, glass comes out as black metal), so these are rebuilt here.
// Blender materials not listed here are kept as exported.
const LIBRARY = {
  // ---------- glass ----------
  // real refraction: transmission renders the scene behind it, ior bends it, dispersion splits colors
  'Material.007': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#ffffff', metalness: 0, roughness: 0.04,
    transmission: 1, thickness: 0.08, ior: 1.5, dispersion: 0.3,
  }),
  // frosted "Rojo" lettering on the bottle
  'Outer': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#ffffff', metalness: 0, roughness: 0.45, transmission: 1, thickness: 0.02, ior: 1.5,
  }),

  // ---------- metals (procedural, textures.js) ----------
  'Gold': copperMaterial,          // hammered copper
  'Chrome Metal': chromeMaterial,

  // ---------- plants (procedural, textures.js) ----------
  'Agave_Exotic': { perMesh: (mesh) => agaveMaterial(reach(mesh)) }, // gradient needs each leaf's length
  'Pina_Skin': pinaMaterial,
  'Straw': strawMaterial,
  'lemonslice': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#d4e86a', roughness: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.2, // juicy
  }),

  // ---------- tiles and stone (procedural, textures.js) ----------
  'Bathroom tile': () => tileMaterial({ colorA: '#4f8f87', colorB: '#78b3a8', grout: '#ddd5c6' }),
  'Green old tiles': () => tileMaterial({ colorA: '#3f7a6a', colorB: '#5f9a7c', grout: '#cfc6b2', tilesPerUnit: 9, clearcoat: 0.7 }),
  'Stone wall': () => stoneMaterial({ base: '#e9d0c2', dark: '#b8907f', light: '#fff1e6' }),    // pale mill basin
  'Eroded Gray Marlstone': () => stoneMaterial({ base: '#a39d95', dark: '#6f6962', light: '#d2cdc6', scale: 9 }),
  'Natural Wood': () => new THREE.MeshStandardNodeMaterial({ color: '#8c6b4f', roughness: 0.8 }),
  'Material.009': () => new THREE.MeshPhysicalNodeMaterial({ color: '#f5f2ec', roughness: 0.9, sheen: 1, sheenColor: '#ffffff' }), // salt rim

  // ---------- labels (their images were procedural, so plain colors for now) ----------
  'eticket': () => new THREE.MeshStandardNodeMaterial({ color: '#c9302c', roughness: 0.5 }),
  'eticket.blue': () => new THREE.MeshStandardNodeMaterial({ color: '#2f8aa0', roughness: 0.5 }),
};

// objects that share a Blender material but should look different
const BY_OBJECT = {
  tahona_wheel: () => stoneMaterial({ base: '#8b6a55', dark: '#4d3528', light: '#b8977e', scale: 8 }), // darker, worn wheel
};

// distance from a mesh's origin to its furthest vertex (= leaf tip for the agaves)
function reach(mesh) {
  const pos = mesh.geometry.attributes.position;
  let max = 0;
  for (let i = 0; i < pos.count; i++) max = Math.max(max, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
  return max || 1;
}

// swap materials by name, one shared three.js material per Blender material
// (or per geometry for perMesh entries, per object for BY_OBJECT)
export function applyMaterials(root) {
  const made = new Map();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;

    if (BY_OBJECT[obj.name]) {
      obj.material = BY_OBJECT[obj.name]();
      return;
    }

    const name = obj.material.name;
    const entry = LIBRARY[name];
    if (!entry) return;

    const key = entry.perMesh ? `${name}:${obj.geometry.uuid}` : name; // meshes sharing a geometry share it
    if (!made.has(key)) {
      const material = entry.perMesh ? entry.perMesh(obj) : entry();
      material.name = name;
      made.set(key, material);
    }
    obj.material = made.get(key);
  });
  console.log('materials replaced:', [...new Set([...made.keys()].map((k) => k.split(':')[0]))].join(', '));
}
