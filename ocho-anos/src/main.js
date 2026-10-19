import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createFlameMaterial, flameUniforms } from './flame.js';
import { createLiquidMaterial, setLiquidEnvironment } from './liquid.js';
import { createStory } from './story.js';
import { createTahonaDrag } from './tahona.js';
import { createShotMachine } from './machine.js';
import { createTap } from './tap.js';
import { createMiniBelt } from './minibelt.js';
import { applyMaterials } from './materials.js';
import { addFlowAttribute, createCoilMaterial, coilUniforms } from './coil.js';
import { createDayNight } from './daynight.js';

// ---------- SCENE ----------
const scene = new THREE.Scene();
// sky, floor and reflections come from daynight.js (pastel sunset ↔ desert night)

// needs the model: sand floor under it, sun aimed at it with a fitted shadow camera
function buildGround() {
  const box = new THREE.Box3().setFromObject(machine);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());

  dayNight.addGround({ center, size, y: box.min.y });

  sun.target.position.copy(center);
  scene.add(sun.target);
  const sunDir = SUN_DIRECTION.clone().normalize();
  sun.position.copy(center).addScaledVector(sunDir, size * 1.5);
  dayNight.setSunDirection(sunDir);
  const cam = sun.shadow.camera;
  cam.left = -size * 0.75;
  cam.right = size * 0.75;
  cam.top = size * 0.75;
  cam.bottom = -size * 0.75;
  cam.near = size * 0.1;
  cam.far = size * 4;
  cam.updateProjectionMatrix();
}

// ---------- CAMERA ----------
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);

// ---------- RENDERER ----------
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // soft by default in this three version
document.body.appendChild(renderer.domElement);

// ---------- CONTROLS ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// scroll intro + story chapters (drives the camera)
const story = createStory({ camera, controls });

// ---------- LIGHTS ----------
// where the sun comes from: lower y = lower sun = longer shadows and warmer side light (sunset)
const SUN_DIRECTION = new THREE.Vector3(-4, 1.4, 4);
const hemi = new THREE.HemisphereLight('#ffd9c2', '#3b3a2a', 1.2); // sky / ground
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffb070', 3); // warm, low sun
sun.position.set(-4, 3, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun);
const rim = new THREE.DirectionalLight('#9db8ff', 0.8); // cool back light
rim.position.set(4, 4, -5);
scene.add(rim);

// ---------- DAY / NIGHT ----------
// colors of the sky, floor, lights and reflections; the switch sits in the header
const dayNight = createDayNight({ scene, renderer, hemi, sun, rim, toggle: document.querySelector('.mode-toggle') });
setLiquidEnvironment(dayNight.envMap); // the liquid shaders refract the same sky
dayNight.setSunDirection(SUN_DIRECTION); // the background shader's light matches the sun light


const flameMaterial = createFlameMaterial({ flipY: false });
const coilMaterial = createCoilMaterial();
// bottle: plain light-brown tequila filling the whole liquid body
// (opaque on purpose, so it shows through the transmissive bottle glass)
const bottleTequila = new THREE.MeshPhysicalNodeMaterial({
  color: '#c8935a', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05,
  sheen: 0.3, sheenColor: '#ffd9a0', // a warm glow at the edges
});
const shotLiquidMaterial = createLiquidMaterial({ upright: false, filled: true }); // shot glasses: wide, full of tequila

// a Blender object with several materials loads as a Group of meshes,
// this returns just those meshes (not the child objects parented to it)
function ownMeshes(obj) {
  if (obj.isMesh) return [obj];
  return obj.children.filter((c) => c.isMesh && c.userData.name === undefined);
}

// ---------- LOAD THE MODEL ----------
const MODEL_URL = '/models/tequila.glb';
let machine;
let firePlane;
let shotMachine;
let tap;
let miniBelt;

// the export uses Draco compression, the decoder lives in public/draco
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
loader.load(
  MODEL_URL,
  (gltf) => {
    machine = gltf.scene;
    scene.add(machine);

    console.log(`--- Objects in ${MODEL_URL} ---`);
    machine.traverse((obj) => console.log(obj.type, '→', obj.name));

    // rebuild the materials that didn't survive the glTF export
    applyMaterials(machine);

    const oven = machine.getObjectByName('oven');
    const ovenMeshes = oven ? ownMeshes(oven) : [];

    // flame
    firePlane = machine.getObjectByName('fire_plane');
    if (firePlane) {
      // always make 0..1 UVs from the bounds (exported ones are missing or atlas-sized)
      const geo = firePlane.geometry;
      geo.computeBoundingBox();
      const { min, max } = geo.boundingBox;
      const pos = geo.attributes.position;
      const uvs = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uvs[i * 2] = (pos.getX(i) - min.x) / (max.x - min.x);
        uvs[i * 2 + 1] = (pos.getY(i) - min.y) / (max.y - min.y);
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

      // size the flame to the oven body, rising out of the top
      if (ovenMeshes.length) {
        const ovenBox = new THREE.Box3();
        ovenMeshes.forEach((m) => ovenBox.expandByObject(m));
        const ovenSize = ovenBox.getSize(new THREE.Vector3());
        const ovenCenter = ovenBox.getCenter(new THREE.Vector3());
        const width = ovenSize.x * 1.05;
        const height = ovenSize.y * 1.8;
        const bottom = ovenBox.min.y + ovenSize.y * 0.15;

        firePlane.position.set(ovenCenter.x, bottom + height / 2, ovenCenter.z);
        firePlane.scale.set(width / (max.x - min.x), height / (max.y - min.y), 1);
        flameUniforms.uAspect.value = width / height;
      } else {
        flameUniforms.uAspect.value = (max.x - min.x) / (max.y - min.y);
      }

      firePlane.material = flameMaterial;
      firePlane.renderOrder = 1; // after the opaque scene, so the additive glow blends on top
      console.log('✅ fire_plane found');
    } else {
      console.warn('❌ fire_plane NOT found, check the name in Blender');
    }

    // coil fills with juice while grinding
    const coil = machine.getObjectByName('coil');
    if (coil) {
      addFlowAttribute(coil.geometry);
      coil.material = coilMaterial;
    }

    // liquid
    const bottleLiquid = machine.getObjectByName('bottle_liquid');
    if (bottleLiquid) {
      bottleLiquid.material = bottleTequila;
      console.log('✅ bottle_liquid found');
    } else {
      console.warn('❌ bottle_liquid NOT found, check the name in Blender');
    }

    // tequila in the shot glasses, sized from the first one (they're all the same mesh size)
    const shotLiquids = [1, 2, 3, 4].map((k) => machine.getObjectByName(`glass_liquid_0${k}`)).filter(Boolean);
    if (shotLiquids.length) {
      const box = (shotLiquids[0].geometry.computeBoundingBox(), shotLiquids[0].geometry.boundingBox);
      shotLiquidMaterial.userData.uniforms.uHeight.value = box.max.y - box.min.y;
      shotLiquidMaterial.userData.uniforms.uWidth.value = box.max.x - box.min.x;
      shotLiquids.forEach((m) => (m.material = shotLiquidMaterial));
    }

    // everything casts a shadow except the shader planes/volumes
    machine.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = obj !== firePlane && obj !== bottleLiquid;
    });

    frameModel(machine);
    buildGround();
    story.setModel(machine);
    miniBelt = createMiniBelt({ machine });
    createTahonaDrag({
      camera, controls, canvas: renderer.domElement, machine,
      onGrind: (turned, amount) => {
        miniBelt.run(amount); // piñas roll from the oven into the mill while grinding
        // about 10 full turns of the tahona fill the whole coil
        coilUniforms.uFill.value = Math.min(coilUniforms.uFill.value + turned * 0.016, 1);
        coilUniforms.uFlow.value = Math.max(coilUniforms.uFlow.value, amount);
      },
    });
    shotMachine = createShotMachine({ camera, controls, canvas: renderer.domElement, machine });
    tap = createTap({ camera, controls, canvas: renderer.domElement, machine, scene, shotMachine });
  },
  undefined,
  (error) => console.error(`❌ Could not load ${MODEL_URL}`, error)
);

// fit the camera to the model
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

renderer.domElement.addEventListener('click', (event) => {
  if (!machine) return;

  // mouse → clip space (-1 to +1)
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(machine, true)[0];
  if (!hit) return;

  // walk up to a named part
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

// ---------- FLAME INTERACTION ----------
let holding = false;
let targetWind = 0;

renderer.domElement.addEventListener('pointerdown', () => (holding = true)); // canvas only, not the UI
window.addEventListener('pointerup', () => (holding = false));
window.addEventListener('pointermove', (e) => {
  targetWind = (e.clientX / window.innerWidth) * 2 - 1;
});

// ---------- LOOP ----------
const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  dayNight.update(); // bakes the desert shader once, refreshes reflections on day/night
  controls.update();
  story.update();
  const dt = timer.getDelta();
  shotMachine?.update(dt, timer.getElapsed());
  tap?.update(dt);
  miniBelt?.update(dt);

  // ease heat and wind
  const heat = flameUniforms.uHeat;
  heat.value += ((holding ? 1 : 0.4) - heat.value) * 0.05;
  const wind = flameUniforms.uWind;
  wind.value += (targetWind - wind.value) * 0.05;
  coilUniforms.uFlow.value *= 0.92; // streaks fade when grinding stops

  // face the camera (Y axis only)
  if (firePlane) {
    firePlane.rotation.y = Math.atan2(camera.position.x - firePlane.position.x, camera.position.z - firePlane.position.z);
  }
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
