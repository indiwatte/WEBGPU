import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 1. Scene: the "world" where everything lives
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1a1a');

// 2. Camera: where we look from
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3, 2, 5);

// 3. Renderer: draws everything with WebGPU
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// 4. Controls: rotate the camera with the mouse
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// 5. Lights
scene.add(new THREE.AmbientLight('#ffffff', 0.5));
const light = new THREE.DirectionalLight('#ffffff', 2);
light.position.set(3, 5, 2);
scene.add(light);

// 6. Test cube
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#3de87f' })
);
scene.add(cube);

// 7. Window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 8. Animation loop (runs every frame)
renderer.setAnimationLoop(() => {
  cube.rotation.y += 0.01;
  controls.update();
  renderer.render(scene, camera);
});

// Check which backend is used (WebGPU or WebGL fallback)
console.log('WebGPU backend:', renderer.backend.isWebGPUBackend === true);



//import 'three/webgpu'
        
//new WebGPURenderer()
        
//navigator.gpu exists ?
   //├─ yes → WebGPUBackend: requestAdapter → requestDevice → getContext('webgpu')
   //└─ no  → WebGLBackend: getContext('webgl2')
        
//renderer.render(scene, camera) every frame
        
//backend: TSL → WGSL, buffers, pipeline, commands, submit()
//
//GPU draws → you see it on screen
