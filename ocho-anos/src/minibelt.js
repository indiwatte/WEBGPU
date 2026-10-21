import * as THREE from 'three/webgpu';
import { positionWorld, fract, step, mix, color, uniform } from 'three/tsl';

const SPEED = 0.25; // units per second at full grinding speed
const COUNT = 3;    // piñas on the belt
const FADE = 0.08;  // distance over which a piña pops in at the oven end
const GRAVITY = 9.8;
const REST = 1.2;   // seconds a piña lies in the mill before the next one comes

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
  const items = pinas.map((obj, i) => ({
    obj, t: (along - (i * length) / COUNT + length) % length,
    state: 'belt', // belt → falling → resting → back on the belt at the oven
    velocity: new THREE.Vector3(), rest: 0, floor: 0,
  }));

  // where a falling piña lands: the mill basin (or the piñas already in it) below it
  const mill = machine.getObjectByName('mill');
  const down = new THREE.Vector3(0, -1, 0);
  const ray = new THREE.Raycaster();
  function floorBelow(pos) {
    if (!mill) return pos.y - 0.3;
    ray.set(pos, down);
    const hit = ray.intersectObject(mill, true)[0];
    return hit ? hit.point.y : pos.y - 0.3;
  }

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
        const { obj, velocity } = item;

        if (item.state === 'belt') {
          item.t += move;
          obj.position.copy(start).addScaledVector(direction, item.t).add(side);
          obj.rotation.x += move * 6; // rolls a little
          const pop = Math.min(item.t / FADE, 1); // pops out of the oven
          obj.scale.copy(baseScale).multiplyScalar(Math.max(pop, 0.001));
          if (item.t > length) {
            // off the end of the belt: tumble into the mill
            item.state = 'falling';
            velocity.copy(direction).multiplyScalar(SPEED * Math.max(speed, 0.4)).setY(0.4);
            item.floor = floorBelow(obj.position.clone().addScaledVector(direction, 0.15));
          }
        } else if (item.state === 'falling') {
          velocity.y -= GRAVITY * dt;
          obj.position.addScaledVector(velocity, dt);
          obj.rotation.x += dt * 5;
          if (obj.position.y <= item.floor + 0.05) {
            obj.position.y = item.floor + 0.05;
            item.state = 'resting';
            item.rest = REST;
          }
        } else if (item.state === 'resting') {
          // lies in the mill for a moment, then shrinks away and the piña comes back out of the oven
          item.rest -= dt;
          if (item.rest < 0.3) obj.scale.copy(baseScale).multiplyScalar(Math.max(item.rest / 0.3, 0.001));
          if (item.rest <= 0) {
            item.state = 'belt';
            item.t = 0;
          }
        }
      }
    },
  };
}
