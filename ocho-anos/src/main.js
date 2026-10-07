import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { uv, time, sin, mix, color } from 'three/tsl';

// ---------- SCENE ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1a1a'); // shown until the photo loads

// desert photo as a flat backdrop (stays fixed while you orbit)
new THREE.TextureLoader().load('/desert.jpeg', (texture) => {
  texture.colorSpace = THREE.SRGBColorSpace; // keep the photo's colors correct
  scene.background = texture;
});

// ---------- CAMERA ----------
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);

// ---------- RENDERER ----------
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// ---------- CONTROLS ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ---------- LIGHTS ----------
scene.add(new THREE.AmbientLight('#ffffff', 0.6));
const sun = new THREE.DirectionalLight('#ffffff', 2);
sun.position.set(3, 5, 4);
scene.add(sun);


// ---------- TEST FLAME MATERIAL (placeholder, will become the Shadertoy shader) ----------
const flameMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
const flicker = sin(time.mul(8)).mul(0.1);                      // moves up and down quickly
flameMaterial.colorNode = mix(color('#ff3c00'), color('#ffd23f'), uv().y.add(flicker));

// ---------- BASIC COLORS PER PART ----------
// key = object name from Blender (numbers like _01 are stripped, so 'glass' covers glass_01..05)
const palette = {
  base:          { color: '#5a3b26', roughness: 0.8 },              // dark wood
  agave:         { color: '#4f8f6b', roughness: 0.6 },              // blue-green agave
  pina:          { color: '#d9a441', roughness: 0.7 },              // cooked agave heart
  oven: { color: '#b87333', roughness: 0.3, metalness: 1 },              // clay / brick
  mill:          { color: '#8a8580', roughness: 0.9 },              // stone
  tahona_wheel:  { color: '#9b958e', roughness: 0.9 },              // stone wheel
  tahona_arm:    { color: '#6b4a2f', roughness: 0.7 },              // wood
  belt:          { color: '#ff6b01', roughness: 0.6 },              // rubber
  belt_mini:     { color: '#ff6b01', roughness: 0.6 },
  still:         { color: '#b87333', roughness: 0.3, metalness: 1 }, // copper
  coil:          { color: '#b87333', roughness: 0.3, metalness: 1 },
  tap:           { color: '#c0c0c0', roughness: 0.2, metalness: 1 }, // chrome
  panel_shots: { color: '#ff6b01', roughness: 0.5 },
  neon_shots:    { color: '#ff2fa8', emissive: '#ff2fa8', emissiveIntensity: 2 }, // glows
  bottle:        { color: '#cfe8ff', roughness: 0.05, transparent: true, opacity: 0.35 },
  bottle_liquid: { color: '#f2d27a', roughness: 0.1, transparent: true, opacity: 0.85 }, // tequila
  glass:         { color: '#e8f4ff', roughness: 0.05, transparent: true, opacity: 0.3 },
  glass_liquid:  { color: '#f2d27a', roughness: 0.1, transparent: true, opacity: 0.85 },
  lime:          { color: '#7cc142', roughness: 0.6 },
};

// one material per palette entry, shared by every mesh that uses it (cheaper for the GPU)
const materials = {};
for (const [key, settings] of Object.entries(palette)) {
  materials[key] = new THREE.MeshStandardNodeMaterial(settings);
}

function paintMachine(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const key = obj.name.replace(/_\d+$/, ''); // 'glass_liquid_03' → 'glass_liquid'
    if (materials[key]) obj.material = materials[key];
  });
}

// ---------- LOAD THE BLOCKOUT ----------
let machine; // will hold the loaded model

const loader = new GLTFLoader();
loader.load(
  '/models/blockout.glb',
  (gltf) => {
    machine = gltf.scene;
    scene.add(machine);

    // 1. Print all object names (so you can check your naming)
    console.log('--- Objects in blockout.glb ---');
    machine.traverse((obj) => console.log(obj.type, '→', obj.name));

    // 2. Give every part its basic color
    paintMachine(machine);

    // 3. Find objects by name
    const firePlane = machine.getObjectByName('fire_plane');
    if (firePlane) {
      firePlane.material = flameMaterial;
      console.log('✅ fire_plane found');
    } else {
      console.warn('❌ fire_plane NOT found, check the name in Blender');
    }

    // 4. Point the camera at the model automatically
    frameModel(machine);
  },
  undefined,
  (error) => console.error('❌ Could not load blockout.glb', error)
);

// Puts the camera at a good distance, looking at the center of the model
function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());

  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0.6, 0.4, 1).normalize().multiplyScalar(size * 1.1));
  camera.near = size / 100;
  camera.far = size * 10;
  camera.updateProjectionMatrix();
  controls.update();
}

// ---------- CLICK TEST (Raycaster) ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('click', (event) => {
  if (!machine) return;

  // mouse position → -1 to +1 (clip space, like in the WebGPU lessons!)
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(machine, true)[0];
  if (!hit) return;

  // walk up from the clicked mesh to find a named part
  let obj = hit.object;
  while (obj && obj !== machine) {
    if (obj.name === 'tap') {
      console.log('🚰 tap clicked');
      return;
    }
    obj = obj.parent;
  }
  console.log('clicked:', hit.object.name);
});

// ---------- RESIZE ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- LOOP ----------
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

renderer.init().then(() => {
  console.log('WebGPU backend:', renderer.backend.isWebGPUBackend === true);
});



//import 'three/webgpu'
        
//new WebGPURenderer()
        
//navigator.gpu exists ?
   //├─ yes → WebGPUBackend: requestAdapter → requestDevice → getContext('webgpu')
   //└─ no  → WebGLBackend: getContext('webgl2')
        
//renderer.render(scene, camera) every frame
        
//backend: TSL → WGSL, buffers, pipeline, commands, submit()
//
//GPU draws → you see it on screen
