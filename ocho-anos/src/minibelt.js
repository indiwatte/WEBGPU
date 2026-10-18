import * as THREE from 'three/webgpu';
import { positionWorld, fract, step, mix, color, uniform } from 'three/tsl';

const SPEED = 0.25; // units per second at full grinding speed
const COUNT = 3;    // piñas on the belt
const FADE = 0.08;  // distance over which a piña pops in/out at the ends

// small belt from the oven to the mill: runs while the tahona is grinding,
// carrying cooked piñas out of the oven into the mill
export function createMiniBelt({ machine }) {
  const belt = machine.getObjectByName('belt_mini');
  const pina = machine.getObjectByName('Agave_Pina015'); // the one lying on the belt (three strips the '.')
  if (!belt || !pina) {
    console.warn('❌ belt_mini / Agave_Pina.015 NOT found');
    return { run() {}, update() {} };
  }

  // belt length along its own x axis, in world space
  machine.updateMatrixWorld(true);
  belt.geometry.computeBoundingBox();
  const { min, max } = belt.geometry.boundingBox;
  const a = new THREE.Vector3(min.x, 0, 0).applyMatrix4(belt.matrixWorld);
  const b = new THREE.Vector3(max.x, 0, 0).applyMatrix4(belt.matrixWorld);
  const ovenEnd = a.distanceTo(pina.getWorldPosition(new THREE.Vector3())) > b.distanceTo(pina.getWorldPosition(new THREE.Vector3())) ? a : b;
  const millEnd = ovenEnd === a ? b : a; // the piña lies at the mill end
  const direction = millEnd.clone().sub(ovenEnd).normalize();
  const length = ovenEnd.distanceTo(millEnd) - 0.1;
  const start = ovenEnd.clone().addScaledVector(direction, 0.05);

  // piñas in world space (machine root has no transform), spaced along the belt
  machine.attach(pina);
  const along = pina.position.clone().sub(start).dot(direction);
  const side = pina.position.clone().sub(start).addScaledVector(direction, -along); // keep its height and sideways offset
  const baseScale = pina.scale.clone();
  const pinas = [pina];
  for (let i = 1; i < COUNT; i++) {
    const copy = pina.clone();
    copy.rotation.y += i * 2.1; // so they don't all look the same
    machine.add(copy);
    pinas.push(copy);
  }
  const items = pinas.map((obj, i) => ({ obj, t: (along - (i * length) / COUNT + length) % length }));

  // moving seams on the belt, along its length
  const offset = uniform(0);
  const base = belt.material.color.clone();
  const material = new THREE.MeshStandardNodeMaterial({ roughness: belt.material.roughness });
  const coord = positionWorld.dot(direction);
  const seam = step(0.9, fract(coord.sub(offset).mul(12)));
  material.colorNode = mix(color(base), color(base).mul(0.6), seam);
  belt.material = material;

  let target = 0; // speed asked by the grinding, 0..1
  let speed = 0;  // smoothed

  return {
    run(amount) {
      target = Math.max(target, amount);
    },

    update(dt) {
      speed += (target - speed) * Math.min(dt * 6, 1); // ease in/out
      target *= Math.pow(0.02, dt); // drops quickly when grinding stops
      const move = SPEED * speed * dt;
      offset.value += move;

      for (const item of items) {
        item.t += move;
        if (item.t > length) item.t -= length; // into the mill → back out of the oven
        item.obj.position.copy(start).addScaledVector(direction, item.t).add(side);
        item.obj.rotation.x += move * 6; // rolls a little
        const pop = Math.min(item.t / FADE, (length - item.t) / FADE, 1);
        item.obj.scale.copy(baseScale).multiplyScalar(Math.max(pop, 0.001));
      }
    },
  };
}
