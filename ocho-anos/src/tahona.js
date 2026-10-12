import * as THREE from 'three/webgpu';

// drag the tahona wheel around the mill: the arm swings around its origin (center of the basin)
// and the wheel (child of the arm) rolls on its axle
export function createTahonaDrag({ camera, controls, canvas, machine, onGrind }) {
  const arm = machine.getObjectByName('tahona_arm');
  const wheel = machine.getObjectByName('tahona_wheel');
  if (!arm || !wheel) {
    console.warn('❌ tahona_arm / tahona_wheel NOT found');
    return;
  }

  // rolling without slipping: wheel turn = swing × arm length / wheel radius
  wheel.geometry.computeBoundingBox();
  // both in the arm's space (the wheel can have its own scale in the export)
  const wheelRadius = wheel.geometry.boundingBox.max.y * wheel.scale.y;
  const rollRatio = wheel.position.length() / wheelRadius;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pivot = new THREE.Vector3();
  const plane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();

  let dragging = false;
  let lastAngle = 0;
  let lastMoveTime = 0;
  let controlsWereEnabled = true;

  // ---------- SOUND ----------
  // looping grind, volume follows how fast the wheel moves
  let audioCtx, gain, source, stillTimer;

  async function startSound() {
    if (audioCtx) return audioCtx.resume(); // browsers only allow audio after a click
    audioCtx = new AudioContext();
    gain = audioCtx.createGain();
    gain.gain.value = 0;
    gain.connect(audioCtx.destination);

    const res = await fetch(encodeURI('/sounds/stone sound.mp3'));
    const buffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
    source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
  }

  function setGrind(amount) {
    if (!source) return;
    const now = audioCtx.currentTime;
    gain.gain.setTargetAtTime(amount * 0.8, now, 0.05);
    source.playbackRate.setTargetAtTime(0.85 + amount * 0.3, now, 0.1); // faster = slightly higher
  }

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function hitsTahona() {
    return raycaster.intersectObjects([arm, wheel], false).length > 0;
  }

  // angle of the mouse around the pivot, on a flat plane at arm height
  function pointerAngle() {
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;
    return Math.atan2(-(hitPoint.z - pivot.z), hitPoint.x - pivot.x); // same direction as rotation.y
  }

  // capture: runs before OrbitControls, so it doesn't start orbiting
  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    if (!hitsTahona()) return;

    arm.getWorldPosition(pivot);
    plane.set(new THREE.Vector3(0, 1, 0), -pivot.y);
    const angle = pointerAngle();
    if (angle === null) return;

    e.stopImmediatePropagation(); // no orbiting, no flame heat while dragging
    dragging = true;
    lastAngle = angle;
    lastMoveTime = performance.now();
    startSound();
    controlsWereEnabled = controls.enabled;
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    setPointer(e);

    if (!dragging) {
      canvas.style.cursor = hitsTahona() ? 'grab' : '';
      return;
    }

    const angle = pointerAngle();
    if (angle === null) return;

    // shortest way around, so crossing ±180° doesn't jump
    let delta = angle - lastAngle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    lastAngle = angle;

    arm.rotation.y += delta;
    wheel.rotation.x -= delta * rollRatio; // flip the sign if it looks like sliding

    // speed in radians/second → 0..1 grind (about half a turn per second = full)
    const now = performance.now();
    const speed = Math.abs(delta) / Math.max((now - lastMoveTime) / 1000, 0.001);
    lastMoveTime = now;
    const amount = Math.min(speed / 3, 1);
    setGrind(amount);
    onGrind?.(Math.abs(delta), amount);

    // mouse held still → fade out
    clearTimeout(stillTimer);
    stillTimer = setTimeout(() => setGrind(0), 100);
  });

  function stopDrag(e) {
    if (!dragging) return;
    dragging = false;
    clearTimeout(stillTimer);
    setGrind(0);
    controls.enabled = controlsWereEnabled;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
}
