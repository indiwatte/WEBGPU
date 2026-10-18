import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import {
  uniform, mix, smoothstep, step, normalWorldGeometry, positionWorld, vec3, dot, fract, sin, floor,
  max, pow, time, length, float,
} from 'three/tsl';

// colors per mode (sRGB hex). Day = pastel sunset, night = Mexican desert night.
const PALETTES = {
  day: {
    zenith: '#c9b6e4', mid: '#f4b6c2', horizon: '#ffd3a5', ground: '#e8b49a', glow: '#fff1d6',
    hemiSky: '#ffd9c2', hemiGround: '#b8857a', hemi: 1.2,
    sun: '#ffb070', sunIntensity: 3, rim: '#9db8ff', rimIntensity: 0.8,
    env: 0.9, exposure: 1.1, stars: 0,
  },
  night: {
    zenith: '#140f3d', mid: '#4b1f63', horizon: '#c4552d', ground: '#3a1f2f', glow: '#ffe2b8',
    hemiSky: '#4b3a8c', hemiGround: '#2a1520', hemi: 0.6,
    sun: '#9fb0ff', sunIntensity: 0.9, rim: '#e0508f', rimIntensity: 1.4,
    env: 0.35, exposure: 0.95, stars: 1,
  },
};

const ENV_W = 64; // tiny equirect sky for reflections (a smooth gradient needs no more)
const ENV_H = 32;

// day/night: gradient sky + stars, sand floor, matching reflections and lights, and the toggle
export function createDayNight({ scene, renderer, hemi, sun, rim, toggle }) {
  const day = toColors(PALETTES.day);
  const night = toColors(PALETTES.night);
  const now = toColors(PALETTES.day); // current mix, updated while switching

  const u = {
    zenith: uniform(new THREE.Color()),
    mid: uniform(new THREE.Color()),
    horizon: uniform(new THREE.Color()),
    ground: uniform(new THREE.Color()),
    glow: uniform(new THREE.Color()),
    stars: uniform(0),
    glowDir: uniform(new THREE.Vector3(-4, 3, 4).normalize()),
  };

  // ---------- SKY (background) ----------
  // the background is a sphere around the camera: its normal is the view direction
  const dir = normalWorldGeometry;
  const y = dir.y;
  const below = mix(u.horizon, u.ground, smoothstep(0, 0.25, y.negate()));
  const above = mix(mix(u.horizon, u.mid, smoothstep(0, 0.22, y)), u.zenith, smoothstep(0.22, 0.85, y));
  const sky = mix(below, above, step(0, y)).toVar();

  // soft glow around the sun (day) or moon (night)
  sky.addAssign(u.glow.mul(pow(max(dot(dir, u.glowDir), 0), 48).mul(0.6)));

  // stars: a random value per little cell of the sky, only the brightest few light up, and twinkle
  const cell = floor(dir.mul(220));
  const rand = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))).mul(43758.5453));
  const twinkle = sin(time.mul(3).add(rand.mul(100))).mul(0.35).add(0.65);
  const star = step(0.9975, rand).mul(twinkle).mul(smoothstep(0.08, 0.35, y)).mul(u.stars);
  sky.addAssign(vec3(star));

  scene.background = null;
  scene.backgroundNode = sky;

  // ---------- REFLECTIONS ----------
  // the same gradient baked into a small texture: environment light for the metals and glass,
  // and the sky the liquid shaders refract. Refreshed while the mode changes.
  const envData = new Uint8Array(ENV_W * ENV_H * 4);
  const envMap = new THREE.DataTexture(envData, ENV_W, ENV_H);
  envMap.mapping = THREE.EquirectangularReflectionMapping;
  envMap.colorSpace = THREE.SRGBColorSpace;
  envMap.magFilter = THREE.LinearFilter; // smooth, not blocky pixels
  envMap.minFilter = THREE.LinearFilter;
  envMap.wrapS = THREE.RepeatWrapping;   // no seam where the sky wraps around
  scene.environment = envMap;

  const tmp = new THREE.Color();
  const srgb = new THREE.Color();
  function bakeEnvironment() {
    for (let j = 0; j < ENV_H; j++) {
      const ey = Math.sin(((j + 0.5) / ENV_H - 0.5) * Math.PI); // row → height on the sky (row 0 = bottom)
      if (ey < 0) tmp.copy(now.horizon).lerp(now.ground, smooth(0, 0.25, -ey));
      else tmp.copy(now.horizon).lerp(now.mid, smooth(0, 0.22, ey)).lerp(now.zenith, smooth(0.22, 0.85, ey));
      srgb.copy(tmp).convertLinearToSRGB(); // Color works in linear, the texture is sRGB
      const [r, g, b] = [srgb.r, srgb.g, srgb.b].map((c) => Math.round(c * 255));
      for (let i = 0; i < ENV_W; i++) {
        const k = (j * ENV_W + i) * 4;
        envData[k] = r;
        envData[k + 1] = g;
        envData[k + 2] = b;
        envData[k + 3] = 255;
      }
    }
    envMap.needsUpdate = true;      // new pixels for the liquid shaders
    envMap.needsPMREMUpdate = true; // and re-blur the environment light for the metals/glass
  }

  // ---------- GROUND ----------
  let groundMesh = null;
  function addGround({ center, size, y: groundY }) {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    // fade to the horizon color far away, so the floor melts into the sky
    const dist = length(positionWorld.xz.sub(vec3(center).xz));
    const far = smoothstep(size * 0.8, size * 3.5, dist);
    const ripples = sin(positionWorld.x.mul(18).add(sin(positionWorld.z.mul(2)).mul(3))).mul(0.04).add(1); // dune ripples
    material.colorNode = u.ground.mul(ripples).mul(float(1).sub(far));
    material.emissiveNode = u.horizon.mul(far); // unlit far away, like the background
    groundMesh = new THREE.Mesh(new THREE.CircleGeometry(size * 4, 64).rotateX(-Math.PI / 2), material);
    groundMesh.position.set(center.x, groundY, center.z);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
  }

  // ---------- APPLY ----------
  const state = { t: 0 }; // 0 = day, 1 = night
  const listeners = [];
  function apply() {
    for (const key of Object.keys(now)) {
      if (now[key].isColor) now[key].copy(day[key]).lerp(night[key], state.t);
      else now[key] = THREE.MathUtils.lerp(day[key], night[key], state.t);
    }
    u.zenith.value.copy(now.zenith);
    u.mid.value.copy(now.mid);
    u.horizon.value.copy(now.horizon);
    u.ground.value.copy(now.ground);
    u.glow.value.copy(now.glow);
    u.stars.value = now.stars;

    hemi.color.copy(now.hemiSky);
    hemi.groundColor.copy(now.hemiGround);
    hemi.intensity = now.hemi;
    sun.color.copy(now.sun);
    sun.intensity = now.sunIntensity;
    rim.color.copy(now.rim);
    rim.intensity = now.rimIntensity;
    scene.environmentIntensity = now.env;
    renderer.toneMappingExposure = now.exposure;
    bakeEnvironment();
    listeners.forEach((fn) => fn(state.t));
  }

  function setMode(mode, instant = false) {
    const target = mode === 'night' ? 1 : 0;
    document.body.classList.toggle('is-night', target === 1);
    toggle?.setAttribute('aria-pressed', String(target === 1));
    toggle?.setAttribute('aria-label', target === 1 ? 'Switch to day' : 'Switch to night');
    try { localStorage.setItem('rooster-mode', mode); } catch { /* storage blocked: just don't remember */ }
    if (instant) {
      state.t = target;
      apply();
    } else {
      gsap.to(state, { t: target, duration: 1.6, ease: 'power2.inOut', onUpdate: apply });
    }
  }

  // start with the saved mode, or night if the computer is in dark mode
  let saved = null;
  try { saved = localStorage.getItem('rooster-mode'); } catch { /* ignore */ }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  setMode(saved ?? (prefersDark ? 'night' : 'day'), true);

  toggle?.addEventListener('click', () => setMode(document.body.classList.contains('is-night') ? 'day' : 'night'));

  return {
    envMap,
    addGround,
    // glow follows the sun's direction
    setSunDirection(v) {
      u.glowDir.value.copy(v).normalize();
    },
    onChange(fn) {
      listeners.push(fn);
      fn(state.t);
    },
  };
}

function toColors(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) out[k] = typeof v === 'string' ? new THREE.Color(v) : v;
  return out;
}

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
