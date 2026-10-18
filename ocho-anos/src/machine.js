import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { positionWorld, fract, step, mix, color, uniform } from 'three/tsl';

// shots machine: pull the handle → the light pops on, the machine warms up (shake + hum),
// then the belt runs and the shots fall off the end
export function createShotMachine({ camera, controls, canvas, machine }) {
  const panel = machine.getObjectByName('panel_shots');
  const light = machine.getObjectByName('machine_button'); // named "button" in Blender, it's the light
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

    // warm up, then send the shots off
    gsap.to(shake, {
      level: 1,
      duration: 2,
      ease: 'power2.in',
      onComplete: () => {
        state = 'ready';
        runBelt();
      },
    });
  }

  // ---------- SHAKING PARTS ----------
  // everything standing on the shots box (still, bolts, tap…), but not the glasses on the belt
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
  const BELT_SPEED = 0.6; // units per second
  const GRAVITY = 9.8;
  const beltEnd = belt ? new THREE.Box3().setFromObject(belt).max.x : Infinity;
  const groundY = new THREE.Box3().setFromObject(machine).min.y;

  // one group per shot so glass + liquid + lime ride and tumble together
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
        home: group.position.clone(),
        radius: size.y / 2,
        rimRadius: size.x / 2,
        rimTop: glassBox.max.y - group.position.y, // relative to the group
        liquidBottom: liquidBox ? liquidBox.min.y - group.position.y : 0,
        liquidHeight,
        fill: 1, // 1 = as full as in Blender
        maxFill: liquidBox ? (glassBox.max.y - liquidBox.min.y) / liquidHeight : 1, // up to the rim
        startsEmpty: false,
        state: 'belt', // belt → falling → down
        velocity: new THREE.Vector3(),
        spin: 0,
      };
    })
    .filter(Boolean);

  // liquid level: the liquid mesh starts at its bottom, so scaling y raises the surface
  function setFill(shot, fill) {
    shot.fill = fill;
    if (!shot.liquid) return;
    shot.liquid.scale.y = Math.max(Math.min(fill, shot.maxFill), 0.001);
    shot.liquid.visible = fill > 0.02;
  }

  // what a falling shot can land on: everything except the shots themselves
  const floorTargets = machine.children.filter((c) => !shots.some((s) => s.group === c));
  const down = new THREE.Vector3(0, -1, 0);
  const floorRay = new THREE.Raycaster();
  function floorBelow(pos) {
    floorRay.set(pos, down);
    const hit = floorRay.intersectObjects(floorTargets, true)[0];
    return hit ? hit.point.y : groundY;
  }

  // moving seams on the belt surface
  const beltOffset = uniform(0);
  const beltSpeed = { value: 0 }; // 0..1, eased so the belt starts and stops smoothly
  let beltRunning = false;
  if (belt) {
    const base = belt.material.color.clone();
    const material = new THREE.MeshStandardNodeMaterial({ roughness: belt.material.roughness });
    const seam = step(0.9, fract(positionWorld.x.sub(beltOffset).mul(5)));
    material.colorNode = mix(color(base), color(base).mul(0.6), seam);
    belt.material = material;
  }

  function runBelt() {
    if (beltRunning) return;
    // nothing left on the belt → bring a fresh round first
    if (!shots.some((s) => s.state === 'belt')) return resetShots();
    beltRunning = true;
    gsap.to(beltSpeed, { value: 1, duration: 0.4 });
    gsap.to(shake, { level: 0.7, duration: 0.3 });
  }

  function stopBelt() {
    beltRunning = false;
    gsap.to(beltSpeed, { value: 0, duration: 0.5 });
    gsap.to(shake, { level: 0.3, duration: 0.6 });
    window.dispatchEvent(new CustomEvent('round-served'));
  }

  function resetShots() {
    shots.forEach((shot, i) => {
      const { group } = shot;
      gsap.timeline({ delay: i * 0.12 })
        .to(group.scale, { x: 0, y: 0, z: 0, duration: 0.25, ease: 'power2.in' })
        .call(() => {
          gsap.killTweensOf(group.rotation);
          group.position.copy(shot.home);
          group.rotation.set(0, 0, 0);
          setFill(shot, shot.startsEmpty ? 0 : 1);
          shot.velocity.set(0, 0, 0);
          shot.state = 'belt';
        })
        .to(group.scale, { x: 1, y: 1, z: 1, duration: 0.4, ease: 'back.out(2)' });
    });
    window.dispatchEvent(new CustomEvent('shots-reset'));
  }

  // belt movement + simple falling physics, called from update()
  function stepShots(dt) {
    const move = BELT_SPEED * beltSpeed.value * dt;
    beltOffset.value += move;

    for (const shot of shots) {
      const { group, velocity } = shot;

      if (shot.state === 'belt') {
        if (!beltRunning && beltSpeed.value === 0) continue;
        group.position.x += move;
        if (group.position.x > beltEnd) {
          // off the end: keep the belt's speed, a little hop, and tip forward
          shot.state = 'falling';
          velocity.set(BELT_SPEED, 0.6, 0);
          shot.spin = -(4 + Math.random() * 3);
        }
      } else if (shot.state === 'falling') {
        velocity.y -= GRAVITY * dt;
        group.position.addScaledVector(velocity, dt);
        group.rotation.z += shot.spin * dt;

        const floor = floorBelow(group.position);
        if (group.position.y - shot.radius < floor) {
          group.position.y = floor + shot.radius;
          if (shot.liquid) shot.liquid.visible = false; // spilled
          velocity.y = -velocity.y * 0.35; // bounce
          velocity.x *= 0.6;
          shot.spin *= 0.5;
          if (Math.abs(velocity.y) < 0.4) {
            // settle: lie flat on its side or stand upright, whichever is closest
            shot.state = 'down';
            velocity.set(0, 0, 0);
            const rest = Math.round(group.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
            gsap.to(group.rotation, { z: rest, duration: 0.3, ease: 'power2.out' });
          }
        }
      }
    }

    if (beltRunning && !shots.some((s) => s.state === 'belt')) stopBelt();
  }

  // ---------- HANDLE ----------
  // only the stick with the ball moves, the red slot (M_Orange) stays on the machine
  const leverMeshes = lever.isMesh ? [lever] : lever.children.filter((c) => c.isMesh);
  const stick = leverMeshes.find((m) => m.material.name !== 'M_Orange') ?? leverMeshes[0];
  // the stick shares the agave material in Blender, give it its own white one
  stick.material = new THREE.MeshPhysicalNodeMaterial({ color: '#f4f1ec', roughness: 0.3, clearcoat: 0.6 });

  // the stick's origin isn't its hinge: use the middle of its lowest vertices (the bottom of the stick)
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

  // hang the stick under a pivot at the hinge, then rotate the pivot
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
    hum.start(); // audio may only start after a user gesture
    hum.clunk();
    if (state === 'idle') startMachine();
    else if (state === 'ready') runBelt();
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

  // capture: runs before OrbitControls and the flame's hold-to-heat
  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    if (!hits(stick)) return;

    e.stopImmediatePropagation();
    gsap.killTweensOf(pivot.rotation); // stop a spring-back that's still running
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
    // the shot standing on the belt under a point (x, z), if any
    shotUnder(x, z) {
      return shots.find((s) => s.state === 'belt' &&
        Math.hypot(s.group.position.x - x, s.group.position.z - z) < s.rimRadius) ?? null;
    },

    // move the nearest shot under a point; the others step aside so nothing overlaps
    placeUnder(x, z) {
      const dist = (s) => Math.hypot(s.home.x - x, s.home.z - z);
      const nearest = [...shots].sort((a, b) => dist(a) - dist(b))[0];
      if (!nearest) return null;
      nearest.home.set(x, nearest.home.y, z);

      const placed = [nearest];
      const others = shots.filter((s) => s !== nearest).sort((a, b) => Math.abs(a.home.x - x) - Math.abs(b.home.x - x));
      for (const o of others) {
        for (const p of placed) {
          const minGap = o.rimRadius + p.rimRadius + 0.02;
          const dz = o.home.z - p.home.z;
          const needX = Math.sqrt(Math.max(minGap * minGap - dz * dz, 0));
          const side = Math.sign(o.home.x - p.home.x) || 1;
          if (Math.abs(o.home.x - p.home.x) < needX) o.home.x = p.home.x + side * needX;
        }
        placed.push(o);
      }
      shots.forEach((s) => s.group.position.copy(s.home));
      return nearest;
    },

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
      stepShots(dt);
      hum.setLevel(shake.level);
    },
  };
}

// motor hum made with Web Audio: two detuned low oscillators, a lowpass, and a rattle on the volume
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
      ctx.resume(); // browsers only allow audio after a click
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
