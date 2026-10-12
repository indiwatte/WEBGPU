import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mix, vec3, uniform, texture, uv } from 'three/tsl';
import { createFlameMaterial, flameUniforms } from './flame.js';
import { createLiquidMaterial, liquidUniforms, setLiquidEnvironment } from './liquid.js';
import { createStory } from './story.js';
import { createTahonaDrag } from './tahona.js';
import { applyMaterials } from './materials.js';
import { addFlowAttribute, createCoilMaterial, coilUniforms } from './coil.js';

// ---------- SCENE ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1a1a'); // until the HDR loads

// sky tint
const skyTint = uniform(new THREE.Color('#ff9a4d'));
const skyTintStrength = uniform(0.6); // 0 = original, 1 = full tint

// HDR used for background + lighting/reflections
let hdr;
new EXRLoader().load(
  '/desert.exr',
  (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping; // HDR is linear, no sRGB
    scene.background = tex; // until the ground is built
    scene.environment = tex;
    scene.environmentIntensity = 0.8;
    hdr = tex;
    setLiquidEnvironment(tex);
    buildGround();
  },
  undefined,
  (error) => console.error('❌ Could not load the HDR background', error)
);

// sphere whose bottom half is flattened into a floor at y = -height,
// so the HDR looks like real ground (same idea as three's GroundedSkybox)
function createGroundedSkybox(map, height, radius, resolution = 128) {
  const geometry = new THREE.SphereGeometry(radius, 2 * resolution, resolution);
  geometry.scale(1, 1, -1); // render the inside

  const pos = geometry.getAttribute('position');
  const tmp = new THREE.Vector3();
  const y1 = -height * 1.5;
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i);
    if (tmp.y < 0) {
      // flat floor, smooth bend up into the sky
      const f = tmp.y < y1 ? -height / tmp.y : 1 - (tmp.y * tmp.y) / (3 * y1 * y1);
      tmp.multiplyScalar(f);
      tmp.toArray(pos.array, 3 * i);
    }
  }

  const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  // x1.6 so the tint warms the sky instead of darkening it
  material.colorNode = texture(map, uv()).rgb.mul(mix(vec3(1), skyTint.mul(1.6), skyTintStrength));
  return new THREE.Mesh(geometry, material);
}

// needs both the HDR and the model, runs after whichever loads last
function buildGround() {
  if (!hdr || !machine) return;

  const box = new THREE.Box3().setFromObject(machine);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  const groundY = box.min.y;

  // height = how high the photo's camera was; lower → ground feels closer
  const height = size * 0.6;
  const skybox = createGroundedSkybox(hdr, height, size * 6);
  skybox.position.set(center.x, groundY + height, center.z);
  skybox.renderOrder = -1;
  scene.add(skybox);
  scene.background = null;

  // invisible floor that only shows shadows
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 3, size * 3),
    new THREE.ShadowNodeMaterial({ opacity: 0.45 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.set(center.x, groundY + size * 0.001, center.z);
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  // aim the sun at the model and fit the shadow camera around it
  sun.target.position.copy(center);
  scene.add(sun.target);
  sun.position.copy(center).add(new THREE.Vector3(-4, 3, 4).normalize().multiplyScalar(size * 1.5));
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
scene.add(new THREE.HemisphereLight('#ffd9c2', '#3b3a2a', 1.2)); // sky / ground
const sun = new THREE.DirectionalLight('#ffb070', 3); // warm, low sun
sun.position.set(-4, 3, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun);
const rim = new THREE.DirectionalLight('#9db8ff', 0.8); // cool back light
rim.position.set(4, 4, -5);
scene.add(rim);


const flameMaterial = createFlameMaterial({ flipY: false });
const coilMaterial = createCoilMaterial();
const liquidMaterial = createLiquidMaterial();

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

    // see-through oven so the flame shows
    for (const mesh of ovenMeshes) {
      mesh.material = mesh.material.clone();
      mesh.material.transparent = true;
      mesh.material.opacity = 0.35;
      mesh.material.depthWrite = false;
    }

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
      firePlane.renderOrder = 1; // after the oven glass
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
      bottleLiquid.geometry.computeBoundingBox();
      liquidUniforms.uHeight.value = bottleLiquid.geometry.boundingBox.max.y;
      bottleLiquid.material = liquidMaterial;
      console.log('✅ bottle_liquid found');
    } else {
      console.warn('❌ bottle_liquid NOT found, check the name in Blender');
    }

    // everything casts a shadow except the shader planes/volumes
    machine.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = obj !== firePlane && obj !== bottleLiquid;
    });

    frameModel(machine);
    buildGround();
    story.setModel(machine);
    createTahonaDrag({
      camera, controls, canvas: renderer.domElement, machine,
      onGrind: (turned, amount) => {
        // about 10 full turns of the tahona fill the whole coil
        coilUniforms.uFill.value = Math.min(coilUniforms.uFill.value + turned * 0.016, 1);
        coilUniforms.uFlow.value = Math.max(coilUniforms.uFlow.value, amount);
      },
    });
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
      window.dispatchEvent(new CustomEvent('tap-clicked'));
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
renderer.setAnimationLoop(() => {
  controls.update();
  story.update();

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
