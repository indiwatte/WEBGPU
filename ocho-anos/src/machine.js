import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { Observer } from 'gsap/Observer';
import { music } from './music.js';
import { positionWorld, fract, step, mix, color, uniform } from 'three/tsl';

gsap.registerPlugin(Observer);

export function createShotMachine({ camera, controls, canvas, machine }) {
  const panel = machine.getObjectByName('panel_shots');
  const light = machine.getObjectByName('machine_button');
  const lever = machine.getObjectByName('machine_lever');
  const dial = machine.getObjectByName('machine_dial');
  const belt = machine.getObjectByName('belt');
  if (!panel || !lever) {
    console.warn('❌ panel_shots / machine_lever NOT found');
    return { update() {} };
  }

  let state = 'idle'; // idle → warming → ready
  const shake = { level: 0 }; // 0..1, drives shaking and the hum
  const hum = createHum();

  // ---------- LIGHT ----------
  const lightMeshes = !light ? [] : light.isMesh ? [light] : light.children.filter((c) => c.isMesh);
  const lamp = lightMeshes.find((m) => m.material.name === 'M_Magneta.001') ?? lightMeshes[0];
  if (lamp) {
    lamp.material = lamp.material.clone();
    lamp.material.emissive = new THREE.Color('#ffe07a');
    lamp.material.emissiveIntensity = 0; // off until the handle is pulled
  }

  function startMachine() {
    state = 'warming';
    window.dispatchEvent(new CustomEvent('machine-start'));

    // light flickers on
    if (lamp) {
      gsap.timeline()
        .to(lamp.material, { emissiveIntensity: 3, duration: 0.05 })
        .to(lamp.material, { emissiveIntensity: 0.4, duration: 0.08 })
        .to(lamp.material, { emissiveIntensity: 3, duration: 0.05 })
        .to(lamp.material, { emissiveIntensity: 2.5, duration: 0.3 });
    }
    if (dial) gsap.to(dial.rotation, { z: dial.rotation.z - 2.2, duration: 2, ease: 'power1.inOut' }); // gauge climbs

    // warm up, then settle into an idle rumble: ready to fill
    gsap.to(shake, {
      level: 1,
      duration: 2,
      ease: 'power2.in',
      onComplete: () => {
        state = 'ready';
        gsap.to(shake, { level: 0.3, duration: 0.8 });
        advance(); // the first glass comes out
      },
    });
  }

  // ---------- SHAKING PARTS ----------
  const panelBox = new THREE.Box3().setFromObject(panel);
  const onBelt = (name) => /^(glass|glass_liquid|lime)_\d+$/.test(name);
  const shakers = machine.children
    .filter((obj) => {
      if (onBelt(obj.name)) return false;
      const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
      return c.x > panelBox.min.x && c.x < panelBox.max.x && c.z > panelBox.min.z && c.z < panelBox.max.z;
    })
    .map((obj) => ({ obj, base: obj.position.clone() }));

  // ---------- BELT ----------
  // one group per shot so glass + liquid + lime move together
  machine.updateMatrixWorld(true);
  const shots = [1, 2, 3, 4]
    .map((k) => {
      const parts = ['glass', 'glass_liquid', 'lime'].map((p) => machine.getObjectByName(`${p}_0${k}`)).filter(Boolean);
      if (!parts.length) return null;
      const group = new THREE.Group();
      group.position.copy(parts[0].position);
      machine.add(group);
      parts.forEach((p) => group.attach(p)); // keeps where they are
      const glassBox = new THREE.Box3().setFromObject(parts[0]); // the glass, not the lime on top
      const size = glassBox.getSize(new THREE.Vector3());
      const liquid = parts.find((p) => p.name.startsWith('glass_liquid'));
      const liquidBox = liquid ? new THREE.Box3().setFromObject(liquid) : null;
      const liquidHeight = liquidBox ? liquidBox.max.y - liquidBox.min.y : 1;
      return {
        group,
        liquid,
        rimRadius: size.x / 2,
        rimTop: glassBox.max.y - group.position.y, // relative to the group
        liquidBottom: liquidBox ? liquidBox.min.y - group.position.y : 0,
        liquidHeight,
        fill: 0, // 1 = as full as in Blender
        maxFill: liquidBox ? (glassBox.max.y - liquidBox.min.y) / liquidHeight : 1, // up to the rim
        done: false, // filled and the tap closed
      };
    })
    .filter(Boolean);

  function setFill(shot, fill) {
    shot.fill = fill;
    if (!shot.liquid) return;
    shot.liquid.scale.y = Math.max(Math.min(fill, shot.maxFill), 0.001);
    shot.liquid.visible = fill > 0.02;
  }
  shots.forEach((shot) => setFill(shot, 0)); // all glasses start empty

  // moving seams on the belt surface
  const beltOffset = uniform(0);
  const beltSpeed = { value: 0 };
  const BELT_SPEED = 0.45;
  if (belt) {
    const base = belt.material.color.clone();
    const material = new THREE.MeshStandardNodeMaterial({ roughness: belt.material.roughness });
    const seam = step(0.9, fract(positionWorld.x.sub(beltOffset).mul(5)));
    material.colorNode = mix(color(base), color(base).mul(0.6), seam);
    belt.material = material;
  }

  // ---------- FILLING LINE ----------
  const beltBox = belt ? new THREE.Box3().setFromObject(belt) : null;
  const beltEnd = beltBox ? beltBox.max.x : Infinity;
  const beltStart = beltBox ? beltBox.min.x : -Infinity;
  let slotX = [];
  let dispenseX = 0;
  let lineZ = 0;
  let spacing = 0.6;
  let queue = [...shots]; // still inside the machine
  let line = [];
  let moving = false;
  let filled = 0;

  function hideInMachine(shot) {
    shot.group.visible = false;
    shot.group.scale.setScalar(0.001);
    shot.group.position.set(dispenseX, shot.group.position.y, lineZ);
  }

  function setStation(x, z) {
    const r = Math.max(...shots.map((s) => s.rimRadius));
    spacing = Math.min(0.65, (beltEnd - r - x) / (shots.length - 1));
    slotX = shots.map((_, i) => x + i * spacing);
    dispenseX = Math.max(beltStart + r, x - spacing); // where a glass comes out
    lineZ = z;
    queue = [...shots];
    line = [];
    shots.forEach(hideInMachine); // the belt starts empty
  }

  function advance() {
    if (!queue.length && !line.length) return;
    moving = true;
    const next = queue.shift();
    const tl = gsap.timeline({
      onComplete: () => {
        if (next) line.unshift(next);
        moving = false;
        gsap.to(beltSpeed, { value: 0, duration: 0.4 });
        gsap.to(shake, { level: 0.3, duration: 0.6 });
        window.dispatchEvent(new CustomEvent('glass-ready', { detail: { count: line.length } }));
      },
    });
    line.forEach((shot, i) => {
      tl.to(shot.group.position, { x: slotX[i + 1], duration: 1.4, ease: 'power2.inOut' }, 0);
    });
    if (next) {
      next.group.visible = true;
      next.group.position.x = dispenseX;
      tl.to(next.group.scale, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'back.out(2)' }, 0.2) // pops out of the machine
        .to(next.group.position, { x: slotX[0], duration: 1, ease: 'power2.inOut' }, 0.4);
    }
    gsap.to(beltSpeed, { value: 1, duration: 0.3 });
    gsap.to(shake, { level: 0.7, duration: 0.3 });
  }

  // the tap closed with a full glass under it
  window.addEventListener('tap-closed-full', () => {
    const shot = line[0];
    if (moving || !shot || shot.done || shot.fill < 1) return;
    shot.done = true;
    filled++;
    if (filled === shots.length) startFinale();
    else window.dispatchEvent(new CustomEvent('glass-filled', { detail: { filled, total: shots.length } }));
  });

  // ---------- FINALE: a toast with two glasses, driven by scrolling ----------
  const toast = { p: 0 };   // 0 = on the belt, 1 = clinked
  let toastTarget = 0;
  let finale = null;
  let clinked = false;
  const clink = createClink();

  function startFinale() {
    const [a, b] = [line[1], line[2]];
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
    const mid = a.group.position.clone().lerp(b.group.position, 0.5);
    const meet = mid.clone().addScaledVector(camDir, -spacing * 0.9).add(new THREE.Vector3(0, spacing * 1.4, 0));
    finale = {
      a, b, right, camDir, meet,
      fromA: a.group.position.clone(), fromB: b.group.position.clone(),
      rotA: a.group.quaternion.clone(), rotB: b.group.quaternion.clone(),
    };
    toast.p = 0;
    toastTarget = 0;
    clinked = false;
    controls.enableZoom = false; // the wheel drives the toast now
    toastObserver.enable();
    window.dispatchEvent(new CustomEvent('all-filled'));
  }

  const qTilt = new THREE.Quaternion();
  function applyToast() {
    if (!finale) return;
    const { a, b, right, camDir, meet, fromA, fromB, rotA, rotB } = finale;
    const p = toast.p;
    const lift = THREE.MathUtils.smoothstep(p, 0, 0.45);      // off the belt, up and towards you
    const close = THREE.MathUtils.smoothstep(p, 0.45, 0.92);  // towards each other
    const gap = THREE.MathUtils.lerp(spacing * 0.75, a.rimRadius * 0.95, close);
    for (const [shot, from, rot, side] of [[a, fromA, rotA, -1], [b, fromB, rotB, 1]]) {
      const target = meet.clone().addScaledVector(right, side * gap);
      shot.group.position.lerpVectors(from, target, lift);
      if (lift >= 1) shot.group.position.copy(target);
      qTilt.setFromAxisAngle(camDir, side * 0.45 * close); // rims tip towards each other
      shot.group.quaternion.copy(rot).premultiply(qTilt);
    }
    if (p > 0.97 && !clinked) {
      clinked = true;
      clink.play();
      gsap.fromTo(toast, { p: 0.9 }, { p: 1, duration: 0.25, ease: 'back.out(4)', onUpdate: applyToast }); // little bounce
      window.dispatchEvent(new CustomEvent('salud'));
    }
  }

  const toastObserver = Observer.create({
    target: window,
    type: 'wheel,touch',
    onChangeY: (self) => {
      toastTarget = THREE.MathUtils.clamp(toastTarget + self.deltaY * 0.0012, 0, 1);
      music.activity();
      gsap.to(toast, { p: toastTarget, duration: 0.6, ease: 'power2.out', overwrite: true, onUpdate: applyToast });
    },
  });
  toastObserver.disable();

  function resetRound() {
    toastObserver.disable();
    controls.enableZoom = true;
    gsap.killTweensOf(toast);
    if (finale) {
      const { a, b, fromA, fromB, rotA, rotB } = finale;
      gsap.to(a.group.position, { x: fromA.x, y: fromA.y, z: fromA.z, duration: 0.8, ease: 'power2.inOut' });
      gsap.to(b.group.position, { x: fromB.x, y: fromB.y, z: fromB.z, duration: 0.8, ease: 'power2.inOut' });
      a.group.quaternion.copy(rotA);
      b.group.quaternion.copy(rotB);
    }
    finale = null;
    filled = 0;
    moving = true;
    const tl = gsap.timeline({
      delay: 0.8,
      onComplete: () => {
        shots.forEach((shot) => {
          hideInMachine(shot);
          shot.done = false;
          setFill(shot, 0);
        });
        queue = [...shots];
        line = [];
        moving = false;
        window.dispatchEvent(new CustomEvent('shots-reset'));
      },
    });
    line.forEach((shot, i) => {
      tl.to(shot.group.position, { x: dispenseX, duration: 1.2, ease: 'power2.inOut' }, i * 0.1)
        .to(shot.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3 }, 0.9 + i * 0.1);
    });
  }

  // ---------- HANDLE ----------
  const leverMeshes = lever.isMesh ? [lever] : lever.children.filter((c) => c.isMesh);
  const stick = leverMeshes.find((m) => m.material.name !== 'M_Orange') ?? leverMeshes[0];
  stick.material = new THREE.MeshPhysicalNodeMaterial({ color: '#f4f1ec', roughness: 0.3, clearcoat: 0.6 });

  stick.geometry.computeBoundingBox();
  const { min, max } = stick.geometry.boundingBox;
  const cutoff = min.y + (max.y - min.y) * 0.15;
  const stickPos = stick.geometry.attributes.position;
  const hinge = new THREE.Vector3();
  let lowCount = 0;
  for (let i = 0; i < stickPos.count; i++) {
    if (stickPos.getY(i) > cutoff) continue;
    hinge.x += stickPos.getX(i);
    hinge.y += stickPos.getY(i);
    hinge.z += stickPos.getZ(i);
    lowCount++;
  }
  hinge.divideScalar(lowCount).multiply(stick.scale);

  const pivot = new THREE.Object3D();
  pivot.position.copy(stick.position).add(hinge);
  stick.parent.add(pivot);
  pivot.add(stick);
  stick.position.copy(hinge).negate();

  const HANDLE_MAX = 1.1; // radians, tipped down towards you
  let dragging = false;
  let fired = false;
  let startY = 0;
  let controlsWereEnabled = true;

  function releaseHandle() {
    dragging = false;
    fired = false;
    controls.enabled = controlsWereEnabled;
    canvas.style.cursor = '';
    gsap.to(pivot.rotation, { x: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)' });
  }

  function handlePulled() {
    music.activity(8); // a bit longer: the belt keeps moving
    hum.start();
    hum.clunk();
    if (state === 'idle') return startMachine();
    if (state !== 'ready' || moving) return;
    if (finale) return clinked ? resetRound() : null;     // after the toast: a new round
    if (!line.length || line[0].done) return advance();   // empty belt or full glass → next glass
    window.dispatchEvent(new CustomEvent('glass-not-full'));
  }

  // ---------- POINTER ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovering = false;

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }
  const hits = (obj) => raycaster.intersectObject(obj, true).length > 0;

  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    if (!hits(stick)) return;

    e.stopImmediatePropagation();
    gsap.killTweensOf(pivot.rotation);
    dragging = true;
    startY = e.clientY;
    controlsWereEnabled = controls.enabled;
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const angle = THREE.MathUtils.clamp((e.clientY - startY) * 0.008, 0, HANDLE_MAX); // drag down = pull
      pivot.rotation.x = angle;
      if (!fired && angle > HANDLE_MAX * 0.85) {
        fired = true;
        handlePulled();
      }
      return;
    }

    setPointer(e);
    if (hits(stick)) {
      canvas.style.cursor = 'grab';
      hovering = true;
    } else if (hovering) {
      canvas.style.cursor = '';
      hovering = false;
    }
  });

  canvas.addEventListener('pointerup', () => dragging && releaseHandle());
  canvas.addEventListener('pointercancel', () => dragging && releaseHandle());

  return {
    shotUnder(x, z) {
      const shot = line[0];
      if (moving || finale || !shot) return null;
      return Math.hypot(shot.group.position.x - x, shot.group.position.z - z) < shot.rimRadius ? shot : null;
    },

    // tap.js tells where the spout is: slot 0 goes under it
    setStation,

    setFill,

    // call every frame
    update(dt, time) {
      const a = 0.004 * shake.level;
      for (const { obj, base } of shakers) {
        obj.position.set(
          base.x + Math.sin(time * 61 + base.y) * a,
          base.y + Math.sin(time * 47 + base.x) * a * 0.6,
          base.z + Math.sin(time * 53 + base.z) * a
        );
      }
      beltOffset.value += BELT_SPEED * beltSpeed.value * dt; // seams move while the belt runs
      hum.setLevel(shake.level);
    },
  };
}

// glass clink: two short bright pings, slightly detuned
function createClink() {
  let ctx;
  return {
    play() {
      ctx ??= new AudioContext();
      const now = ctx.currentTime;
      for (const [freq, delay] of [[2637, 0], [3136, 0.012], [5274, 0.02]]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now + delay);
        g.gain.exponentialRampToValueAtTime(0.25, now + delay + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.6);
        osc.connect(g).connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.7);
      }
    },
  };
}

function createHum() {
  let ctx, gain, filter, osc1, osc2, rattle;
  let lastLevel = -1;

  function init() {
    ctx = new AudioContext();
    gain = ctx.createGain();
    gain.gain.value = 0;
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 250;

    osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 40;
    osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 80.5; // slightly off → beating
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.3;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    rattle = ctx.createGain();
    rattle.gain.value = 0;
    lfo.connect(rattle).connect(gain.gain);

    osc1.connect(filter);
    osc2.connect(osc2Gain).connect(filter);
    filter.connect(gain).connect(ctx.destination);
    osc1.start();
    osc2.start();
    lfo.start();
  }

  return {
    start() {
      if (!ctx) init();
      ctx.resume();
    },

    setLevel(level) {
      if (!ctx || Math.abs(level - lastLevel) < 0.01) return;
      lastLevel = level;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(level * 0.12, now, 0.1);
      rattle.gain.setTargetAtTime(level * 0.05, now, 0.1);
      osc1.frequency.setTargetAtTime(40 + level * 25, now, 0.2);
      osc2.frequency.setTargetAtTime(80.5 + level * 50, now, 0.2);
      filter.frequency.setTargetAtTime(250 + level * 500, now, 0.2);
    },

    // short low thump when the lever engages
    clunk() {
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
      g.gain.setValueAtTime(0.4, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    },
  };
}
