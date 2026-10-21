import * as THREE from 'three/webgpu';
import { attribute, uniform, time, sin, mix, smoothstep, float, color } from 'three/tsl';

export const coilUniforms = {
  uFill: uniform(0), // 0 = empty, 1 = full
  uFlow: uniform(0),
};
const { uFill, uFlow } = coilUniforms;

export function addFlowAttribute(geometry) {
  const pos = geometry.attributes.position;
  const count = pos.count;

  const weld = new Int32Array(count);
  const ids = new Map();
  const pts = [];
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    if (!ids.has(key)) {
      ids.set(key, pts.length);
      pts.push(new THREE.Vector3(x, y, z));
    }
    weld[i] = ids.get(key);
  }
  const n = pts.length;

  // neighbours from the triangles
  const neighbours = Array.from({ length: n }, () => new Set());
  const index = geometry.index ? geometry.index.array : Array.from({ length: count }, (_, i) => i);
  for (let t = 0; t < index.length; t += 3) {
    const a = weld[index[t]], b = weld[index[t + 1]], c = weld[index[t + 2]];
    neighbours[a].add(b).add(c);
    neighbours[b].add(a).add(c);
    neighbours[c].add(a).add(b);
  }

  // start at the lowest point
  let start = 0;
  for (let v = 1; v < n; v++) if (pts[v].y < pts[start].y) start = v;

  // Dijkstra with a small binary heap of [distance, vertex]
  const dist = new Float64Array(n).fill(Infinity);
  dist[start] = 0;
  const heap = [[0, start]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const w of neighbours[v]) {
      const nd = d + pts[v].distanceTo(pts[w]);
      if (nd < dist[w]) {
        dist[w] = nd;
        push([nd, w]);
      }
    }
  }

  let longest = 0;
  for (let v = 0; v < n; v++) if (dist[v] !== Infinity) longest = Math.max(longest, dist[v]);

  const flow = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const d = dist[weld[i]];
    flow[i] = d === Infinity ? 1 : d / longest;
  }
  geometry.setAttribute('flow', new THREE.BufferAttribute(flow, 1));
}

export function createCoilMaterial() {
  const flow = attribute('flow', 'float');

  // 1 inside the liquid, soft edge at the front
  const filled = float(1).sub(smoothstep(uFill.sub(0.01), uFill, flow));

  // streaks moving towards the still while grinding
  const streak = sin(flow.mul(300).sub(time.mul(12))).mul(0.5).add(0.5);
  const juice = color('#e8a040').mul(streak.mul(uFlow).mul(0.5).add(1));

  const material = new THREE.MeshPhysicalNodeMaterial({
    metalness: 0, roughness: 0.04, ior: 1.5, thickness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02,
  });
  material.colorNode = mix(color('#ffffff'), juice, filled);
  material.transmissionNode = mix(float(1), float(0.15), filled); // juice is mostly opaque
  material.emissiveNode = juice.mul(filled).mul(0.15); // a little glow
  return material;
}
