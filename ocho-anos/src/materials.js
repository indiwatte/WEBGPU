import * as THREE from 'three/webgpu';

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

  // ---------- metals ----------
  'Gold': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#c8703f', metalness: 1, roughness: 0.25, clearcoat: 0.4, clearcoatRoughness: 0.1, // lacquered copper
  }),
  'Chrome Metal': () => new THREE.MeshStandardNodeMaterial({ color: '#d6d6d6', metalness: 1, roughness: 0.1 }),

  // ---------- plants ----------
  'Agave_Exotic': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#88b5ab', roughness: 0.55, sheen: 0.6, sheenColor: '#ffc8cc', sheenRoughness: 0.5, // soft pink edge light
  }),
  'Pina_Skin': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#5f6e3a', roughness: 0.6, sheen: 0.4, sheenColor: '#d9c27a',
  }),
  'lemonslice': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#d4e86a', roughness: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.2, // juicy
  }),
  'Straw': () => new THREE.MeshStandardNodeMaterial({ color: '#c9a86a', roughness: 1 }),

  // ---------- tiles, stone, wood ----------
  'Bathroom tile': () => new THREE.MeshStandardNodeMaterial({ color: '#5e968e', roughness: 0.6 }),
  'Green old tiles': () => new THREE.MeshPhysicalNodeMaterial({
    color: '#4f8a80', roughness: 0.5, clearcoat: 0.7, clearcoatRoughness: 0.15, // glazed
  }),
  'Stone wall': () => new THREE.MeshStandardNodeMaterial({ color: '#cdbfae', roughness: 0.95 }),
  'Eroded Gray Marlstone': () => new THREE.MeshStandardNodeMaterial({ color: '#9b958e', roughness: 0.9 }),
  'Natural Wood': () => new THREE.MeshStandardNodeMaterial({ color: '#8c6b4f', roughness: 0.8 }),
  'Material.009': () => new THREE.MeshPhysicalNodeMaterial({ color: '#f5f2ec', roughness: 0.9, sheen: 1, sheenColor: '#ffffff' }), // salt rim

  // ---------- labels (their images were procedural, so plain colors for now) ----------
  'eticket': () => new THREE.MeshStandardNodeMaterial({ color: '#c9302c', roughness: 0.5 }),
  'eticket.blue': () => new THREE.MeshStandardNodeMaterial({ color: '#2f8aa0', roughness: 0.5 }),
};

// swap materials by name, one shared three.js material per Blender material
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
