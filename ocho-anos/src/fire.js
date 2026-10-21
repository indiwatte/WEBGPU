import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { music } from './music.js';

const MIN_SIZE = 0.35;
const MAX_SIZE = 2.3;  // flame size at the biggest
const DRAG = 0.004;
const GLOW = 4;
const FLAME_BASE = 0.21;

export function createFire({ camera, controls, canvas, machine, scene, firePlane, flameUniforms, base }) {
  const oven = machine.getObjectByName('oven');
  if (!oven || !firePlane) {
    console.warn('❌ oven / fire_plane NOT found');
    return { update() {} };
  }
  const { uHeat, uOn } = flameUniforms;

  let lit = false;
  let target = 0.4; // size the user asks for, 0..1
  const planeScale = firePlane.scale.clone(); // scale at size 1
  const baseY = base.bottom + base.height * 0.12;

  const glow = new THREE.PointLight('#ff8a3d', 0, base.height * 2.5, 2);
  glow.position.set(base.center.x, base.bottom + base.height * 0.3, base.center.z);
  scene.add(glow);

  const sound = createFireSound();

  // ---------- LIGHTING ----------
  function ignite() {
    lit = true;
    music.activity();
    target = 0.4;
    sound.start();
    sound.whoosh();
    // flicker on: a few quick tries, then it catches
    gsap.timeline()
      .to(uOn, { value: 0.35, duration: 0.08 })
      .to(uOn, { value: 0.05, duration: 0.1 })
      .to(uOn, { value: 0.6, duration: 0.12 })
      .to(uOn, { value: 1, duration: 0.9, ease: 'power2.out' });
    window.dispatchEvent(new CustomEvent('fire-lit'));
  }

  // ---------- POINTER ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let hovering = false;
  let startY = 0;
  let startTarget = 0;
  let controlsWereEnabled = true;

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }
  // the oven, and the flame itself once it's burning
  const overFire = () => raycaster.intersectObjects(lit ? [oven, firePlane] : [oven], true).length > 0;

  // capture: runs before OrbitControls
  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    if (!overFire()) return;
    e.stopImmediatePropagation();
    if (!lit) {
      ignite();
      return;
    }
    dragging = true;
    startY = e.clientY;
    startTarget = target;
    controlsWereEnabled = controls.enabled;
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'ns-resize';
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      target = THREE.MathUtils.clamp(startTarget + (startY - e.clientY) * DRAG, 0, 1); // up = bigger
      music.activity();
      return;
    }
    setPointer(e);
    if (overFire()) {
      canvas.style.cursor = lit ? 'ns-resize' : 'pointer';
      hovering = true;
    } else if (hovering) {
      canvas.style.cursor = '';
      hovering = false;
    }
  });

  function stopDrag() {
    if (!dragging) return;
    dragging = false;
    controls.enabled = controlsWereEnabled;
    canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  // ---------- UPDATE ----------
  return {
    update(dt) {
      // ease the heat towards what the user asked for
      uHeat.value += (target - uHeat.value) * Math.min(dt * 5, 1);
      const heat = uHeat.value;
      const on = uOn.value;

      const size = THREE.MathUtils.lerp(MIN_SIZE, MAX_SIZE, heat);
      const h = base.height * size;
      firePlane.visible = on > 0.001;
      firePlane.scale.set(planeScale.x * size, planeScale.y * size, 1);
      firePlane.position.y = baseY - FLAME_BASE * h + h / 2;

      // glow on the copper, flickering a little
      const flicker = 0.85 + Math.random() * 0.3;
      glow.intensity = on * (0.4 + heat * 3) * flicker * GLOW;
      glow.position.y = baseY + h * 0.15;

      sound.set(lit ? on * (0.25 + heat * 0.75) : 0);
    },
  };
}

function createFireSound() {
  let ctx, roarGain, noiseBuffer;
  let level = 0;

  function makeNoise() {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function crackle() {
    if (!ctx) return;
    if (level > 0.05) {
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1500 + Math.random() * 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25 * level * Math.random(), now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.03 + Math.random() * 0.04);
      src.connect(filter).connect(g).connect(ctx.destination);
      src.start(now, Math.random() * 1.5, 0.08);
    }
    setTimeout(crackle, 40 + Math.random() * (400 - level * 300)); // more crackles when it's big
  }

  return {
    start() {
      if (ctx) return ctx.resume();
      ctx = new AudioContext();
      noiseBuffer = makeNoise();
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 400;
      roarGain = ctx.createGain();
      roarGain.gain.value = 0;
      src.connect(lowpass).connect(roarGain).connect(ctx.destination);
      src.start();
      crackle();
    },

    // short rising whoosh when it catches
    whoosh() {
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.5;
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(2500, now + 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.exponentialRampToValueAtTime(0.5, now + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      src.connect(filter).connect(g).connect(ctx.destination);
      src.start(now, 0, 1);
    },

    set(amount) {
      level = amount;
      if (!ctx) return;
      roarGain.gain.setTargetAtTime(amount * 0.35, ctx.currentTime, 0.15);
    },
  };
}
