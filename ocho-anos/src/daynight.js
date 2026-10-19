import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { uniform, smoothstep, positionWorld, vec3, sin, length, float } from 'three/tsl';
import { createDesert } from './desert.js';

// colors per mode (sRGB hex) for the floor and the lights. Day = pastel sunset, night = Mexican desert night.
// (the sky itself is the ported Shadertoy desert in desert.js)
const PALETTES = {
  day: { // sunset: low warm sun, less flat fill light, pink back light
    ground: '#eab095', // matches the sand of the desert shader
    hemiSky: '#ffc4a8', hemiGround: '#7a4a52', hemi: 0.8,
    sun: '#ff9450', sunIntensity: 2.6, rim: '#ff7ab0', rimIntensity: 1.2,
    env: 0.75, exposure: 1.0,
  },
  night: {
    ground: '#4a2a40',
    hemiSky: '#4b3a8c', hemiGround: '#2a1520', hemi: 0.6,
    sun: '#9fb0ff', sunIntensity: 0.9, rim: '#e0508f', rimIntensity: 1.4,
    env: 0.35, exposure: 0.95,
  },
};

// day/night: desert sky (shader), sand floor, matching reflections and lights, and the toggle
export function createDayNight({ scene, renderer, hemi, sun, rim, toggle }) {
  const day = toColors(PALETTES.day);
  const night = toColors(PALETTES.night);
  const now = toColors(PALETTES.day); // current mix, updated while switching

  const u = {
    ground: uniform(new THREE.Color()),
  };

  // ---------- SKY + REFLECTIONS ----------
  // the ported Shadertoy desert: baked day/night panoramas as background and environment light
  const desert = createDesert({ renderer, scene });

  // ---------- GROUND ----------
  let groundMesh = null;
  function addGround({ center, size, y: groundY }) {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, transparent: true });
    // fade out far away, so the floor melts into the dunes of the desert shader behind it
    const dist = length(positionWorld.xz.sub(vec3(center).xz));
    const far = smoothstep(size * 0.6, size * 2.2, dist);
    const ripples = sin(positionWorld.x.mul(18).add(sin(positionWorld.z.mul(2)).mul(3))).mul(0.04).add(1); // dune ripples
    material.colorNode = u.ground.mul(ripples);
    material.opacityNode = float(1).sub(far);
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
    u.ground.value.copy(now.ground);
    desert.setNight(state.t);

    hemi.color.copy(now.hemiSky);
    hemi.groundColor.copy(now.hemiGround);
    hemi.intensity = now.hemi;
    sun.color.copy(now.sun);
    sun.intensity = now.sunIntensity;
    rim.color.copy(now.rim);
    rim.intensity = now.rimIntensity;
    scene.environmentIntensity = now.env;
    renderer.toneMappingExposure = now.exposure;
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
    envMap: desert.envMap,
    addGround,
    // the desert's sun sits where the scene's light comes from
    setSunDirection(v) {
      desert.setSunDirection(v);
    },
    // call every frame before rendering (bakes the desert panoramas, refreshes reflections)
    update() {
      desert.update();
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
