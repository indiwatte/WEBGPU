import * as THREE from 'three/webgpu';
import { uv, time, sin, mix, color } from 'three/tsl';

const SNAP_GLASS_UNDER_TAP = true; // set false once a glass stands under the spout in Blender
const OPEN_MAX = Math.PI / 2;      // handle turned a quarter = fully open
const FLOW_RATE = 0.35;            // fill per second at full open (1 = Blender's level)
const GRAVITY = 9.8;
const MAX_DROPS = 400;

// turn the red handle on the tap → tequila flows from the spout into the glass below.
// close it yourself, or the glass overflows and spills onto the table.
export function createTap({ camera, controls, canvas, machine, scene, shotMachine }) {
  const tap = machine.getObjectByName('tap');
  if (!tap || !shotMachine) {
    console.warn('❌ tap NOT found');
    return { update() {} };
  }
  const meshes = tap.isMesh ? [tap] : tap.children.filter((c) => c.isMesh);
  const byMaterial = (name) => meshes.find((m) => m.material.name === name);
  const handle = byMaterial('M_Orange');
  const valve = byMaterial('M_F5E6D3');
  const spoutMesh = byMaterial('Chrome Metal');
  if (!handle || !valve || !spoutMesh) {
    console.warn('❌ tap parts (handle / valve / spout) NOT found');
    return { update() {} };
  }

  // average of the vertices near the top or bottom of a mesh (in the tap's space)
  function edgeCenter(mesh, fromTop, band = 0.02) {
    const pos = mesh.geometry.attributes.position;
    mesh.geometry.computeBoundingBox();
    const { min, max } = mesh.geometry.boundingBox;
    const c = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (fromTop ? y < max.y - band : y > min.y + band) continue;
      c.x += pos.getX(i);
      c.y += y;
      c.z += pos.getZ(i);
      n++;
    }
    return c.divideScalar(n);
  }

  // ---------- HANDLE ----------
  // turns around the valve's upright stem: hang it under a pivot on top of the valve
  const stem = edgeCenter(valve, true);
  const pivot = new THREE.Object3D();
  pivot.position.copy(stem);
  handle.parent.add(pivot);
  pivot.add(handle);
  handle.position.copy(stem).negate();

  let open = 0; // 0..1

  // ---------- SPOUT + GLASS UNDER IT ----------
  const spoutLocal = edgeCenter(spoutMesh, false); // the opening at the bottom of the spout
  const spout = new THREE.Vector3();
  tap.updateMatrixWorld(true);
  tap.localToWorld(spout.copy(spoutLocal));

  if (SNAP_GLASS_UNDER_TAP) {
    const shot = shotMachine.placeUnder(spout.x, spout.z);
    if (shot) {
      shot.startsEmpty = true;
      shotMachine.setFill(shot, 0);
    }
  }

  // ---------- STREAM ----------
  // open cylinder hanging down from y = 0, scaled to the right length every frame
  const streamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, -0.5, 0);
  const streamMat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 });
  const ripples = sin(uv().y.mul(60).add(time.mul(25))).mul(0.5).add(0.5); // bands running down
  streamMat.colorNode = mix(color('#c8742e'), color('#f2b45a'), ripples);
  const stream = new THREE.Mesh(streamGeo, streamMat);
  stream.visible = false;
  scene.add(stream);

  // ---------- DROPS + PUDDLES ----------
  const liquidMat = new THREE.MeshPhysicalNodeMaterial({ color: '#d98a45', roughness: 0.05, clearcoat: 1 });
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 6, 4), liquidMat, MAX_DROPS);
  drops.frustumCulled = false;
  scene.add(drops);
  const dropData = Array.from({ length: MAX_DROPS }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), floor: 0 }));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_DROPS; i++) drops.setMatrixAt(i, hidden);
  let nextDrop = 0;

  const puddleGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  const puddles = [];

  const floorRay = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const start = new THREE.Vector3();
  function floorBelow(pos) {
    floorRay.set(start.copy(pos).setY(pos.y - 0.02), down); // just below, so it doesn't hit the spout itself
    const hit = floorRay.intersectObject(machine, true)[0];
    return hit ? hit.point.y : 0;
  }

  function spawnDrop(pos, vel) {
    const d = dropData[nextDrop];
    nextDrop = (nextDrop + 1) % MAX_DROPS;
    d.alive = true;
    d.pos.copy(pos);
    d.vel.copy(vel);
    d.floor = floorBelow(pos);
  }

  // a landed drop grows the nearest puddle (or starts a new one)
  function addToPuddle(pos, amount) {
    let puddle = puddles.find((p) => Math.abs(p.mesh.position.y - pos.y) < 0.05 &&
      Math.hypot(p.mesh.position.x - pos.x, p.mesh.position.z - pos.z) < p.size + 0.05);
    if (!puddle) {
      if (puddles.length >= 12) return;
      const mesh = new THREE.Mesh(puddleGeo, liquidMat);
      mesh.position.set(pos.x, pos.y + 0.003, pos.z);
      scene.add(mesh);
      puddle = { mesh, volume: 0, size: 0 };
      puddles.push(puddle);
    }
    puddle.volume += amount;
    puddle.size = Math.min(Math.sqrt(puddle.volume) * 0.6, 0.45);
    puddle.mesh.scale.setScalar(puddle.size);
  }

  // fresh round: wipe the table
  window.addEventListener('shots-reset', () => {
    puddles.forEach((p) => scene.remove(p.mesh));
    puddles.length = 0;
  });

  // ---------- SOUND ----------
  const pour = createPourSound();

  // ---------- POINTER ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let hovering = false;
  let startX = 0;
  let startAngle = 0;
  let controlsWereEnabled = true;

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }
  const overHandle = () => raycaster.intersectObjects([handle, valve], false).length > 0;

  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    if (!overHandle()) return;
    e.stopImmediatePropagation(); // no orbiting / flame heat
    dragging = true;
    startX = e.clientX;
    startAngle = pivot.rotation.y;
    controlsWereEnabled = controls.enabled;
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    pour.start(); // audio may only start after a user gesture
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      // drag right to open, left to close; it stays where you leave it
      pivot.rotation.y = THREE.MathUtils.clamp(startAngle + (e.clientX - startX) * 0.01, 0, OPEN_MAX);
      open = pivot.rotation.y / OPEN_MAX;
      return;
    }
    setPointer(e);
    if (overHandle()) {
      canvas.style.cursor = 'grab';
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

  // ---------- STORY FEEDBACK ----------
  let told = ''; // only send each message once per pour
  function tell(name) {
    if (told === name) return;
    told = name;
    window.dispatchEvent(new CustomEvent(name));
  }

  // ---------- UPDATE ----------
  const tmp = new THREE.Vector3();
  const tmpVel = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  return {
    update(dt) {
      tap.localToWorld(spout.copy(spoutLocal)); // the still shakes, so follow it
      const pouring = open > 0.02;
      const shot = shotMachine.shotUnder(spout.x, spout.z);

      // where the stream ends: the liquid surface in the glass, or whatever is below
      let endY;
      if (shot) {
        const level = Math.min(shot.fill, shot.maxFill);
        endY = shot.group.position.y + shot.liquidBottom + level * shot.liquidHeight;
      } else {
        endY = floorBelow(spout);
      }

      // stream
      stream.visible = pouring;
      if (pouring) {
        const r = 0.004 + 0.012 * Math.sqrt(open);
        stream.position.copy(spout);
        stream.scale.set(r, Math.max(spout.y - endY, 0.01), r);
      }

      // fill or spill
      const flow = pouring ? FLOW_RATE * open * dt : 0;
      let spilling = 0; // fill units per frame going over the edge or onto the table
      if (pouring && shot) {
        shotMachine.setFill(shot, shot.fill + flow);
        if (shot.fill >= shot.maxFill) {
          spilling = flow;
          tell('tap-overflow');
        } else if (shot.fill >= 1) {
          tell('tap-full');
        }
      } else if (pouring) {
        spilling = flow;
        tell('tap-spill');
      } else if (told) {
        if (told === 'tap-full') window.dispatchEvent(new CustomEvent('tap-closed-full'));
        told = '';
      }

      // drops: over the rim of a full glass, or splashing where the stream hits
      const count = Math.ceil(spilling * 400);
      for (let i = 0; i < count; i++) {
        if (shot) {
          const a = Math.random() * Math.PI * 2;
          const rim = shot.rimRadius + 0.01;
          tmp.set(shot.group.position.x + Math.cos(a) * rim, shot.group.position.y + shot.rimTop, shot.group.position.z + Math.sin(a) * rim);
          tmpVel.set(Math.cos(a) * 0.25, 0.05, Math.sin(a) * 0.25);
        } else {
          const a = Math.random() * Math.PI * 2;
          tmp.set(spout.x, endY + 0.02, spout.z);
          tmpVel.set(Math.cos(a) * 0.6, 0.8 + Math.random() * 0.6, Math.sin(a) * 0.6);
        }
        spawnDrop(tmp, tmpVel);
      }

      for (let i = 0; i < MAX_DROPS; i++) {
        const d = dropData[i];
        if (!d.alive) continue;
        d.vel.y -= GRAVITY * dt;
        d.pos.addScaledVector(d.vel, dt);
        if (d.pos.y <= d.floor) {
          d.alive = false;
          d.pos.y = d.floor;
          addToPuddle(d.pos, 0.0025);
          drops.setMatrixAt(i, hidden);
          continue;
        }
        drops.setMatrixAt(i, matrix.makeTranslation(d.pos.x, d.pos.y, d.pos.z));
      }
      drops.instanceMatrix.needsUpdate = true;

      // sound: louder with the flow, higher as the glass fills up (like a real glass)
      pour.set(pouring ? open : 0, shot ? Math.min(shot.fill / shot.maxFill, 1) : 0.2);
    },
  };
}

// pouring: looping noise through a bandpass, the pitch rises as the glass fills
function createPourSound() {
  let ctx, gain, filter;
  return {
    start() {
      if (ctx) return ctx.resume();
      ctx = new AudioContext();
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 3;
      filter.frequency.value = 600;
      gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start();
    },
    set(amount, fullness) {
      if (!ctx) return;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(amount * 0.25, now, 0.08);
      filter.frequency.setTargetAtTime(500 + fullness * 1500, now, 0.1);
    },
  };
}
