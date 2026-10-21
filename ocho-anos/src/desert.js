// Desert background: "Eroded sandstone hills" by jarble (https://www.shadertoy.com/view/fsK3Rt), ported to TSL
// Changes: uses the three.js camera, slower fly-through, day/night colors, sky gradient and stars,
// the light follows the scene's sun

import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, uv, time, sin, cos, dot, fract, floor, mix, smoothstep, step,
  clamp, normalize, abs, exp, min, Loop, If, Break, normalWorldGeometry,
} from 'three/tsl';

// ---------- SETTINGS ----------
const MAX_T = 28.0;
const RAY_STEPS = 36;
const SHADOW_STEPS = 22;
const GEO_LOD = 4;
const NOR_LOD = 8;
const FLY_SPEED = 0.15;
const ENV_SIZE = [256, 128];
const ENV_EVERY = 30;
const SUN_HEIGHT = 0.2;
const SUN_GLOW = 0.9;

const PALETTES = {
  day: { // sunset
    skyLow: '#ff9a6b', skyHigh: '#8d6fc4', light: '#ffb07a',
    rock: '#a14a3c', sand: '#f0b28e', layer: '#d99a86',
  },
  night: {
    skyLow: '#b8502e', skyHigh: '#120c36', light: '#8f86d8',
    rock: '#3b1d30', sand: '#6b4058', layer: '#55304a',
  },
};

// ---------- UNIFORMS ----------
const night = uniform(0); // 0 = day, 1 = night
const SUN = uniform(new THREE.Vector3(1, 0.5, 0).normalize()); // lPos, set from the scene's light

const pal = {};
for (const key of Object.keys(PALETTES.day)) {
  pal[key] = { day: uniform(new THREE.Color(PALETTES.day[key])), night: uniform(new THREE.Color(PALETTES.night[key])) };
}
const P = (key) => mix(pal[key].day, pal[key].night, night); // current color

// ---------- TERRAIN ----------
// float snoise(vec2 p)
const snoise = Fn(([p0]) => {
  const f = fract(p0).toVar();
  const p = floor(p0);
  const v = p.x.add(p.y.mul(1000));
  const r = fract(sin(vec4(v, v.add(1), v.add(1000), v.add(1001)).mul(0.001)).mul(100000));
  f.assign(f.mul(f).mul(f.mul(-2).add(3)));
  return mix(mix(r.x, r.y, f.x), mix(r.z, r.w, f.x), f.y).mul(2).sub(1);
});

// float noise(in vec2 uv)
const noise = (p) => sin(p.x).add(cos(p.y));

const terrainFns = {};
function terrain(p, octaves) {
  terrainFns[octaves] ??= Fn(([uv0]) => {
    const uv = vec2(uv0).toVar();
    const value = float(0).toVar();
    const n1 = float(0).toVar();
    let amplitude = 2 / 3;
    let freq = 0.5;
    for (let i = 0; i < octaves; i++) {
      n1.assign(noise(uv.mul(freq)).sub(n1)); // From Dave_Hoskins
      value.addAssign(n1.mul(amplitude));
      freq *= 2 - amplitude;
      amplitude *= 1 / 3;
      uv.assign(uv.yx.sub(n1.div(freq)));
    }
    return value;
  });
  return terrainFns[octaves](p);
}

const map = (p, octaves) => p.y.sub(terrain(p.xz, octaves));

const castRay = Fn(([ro, rd]) => {
  const prec = 0.001;
  const t = float(0).toVar();
  const h = float(prec * 2).toVar();
  Loop(RAY_STEPS, () => {
    If(abs(h).lessThanEqual(prec).or(t.greaterThanEqual(MAX_T)), () => Break());
    t.addAssign(h);
    h.assign(map(ro.add(rd.mul(t)), GEO_LOD));
  });
  return vec2(t, step(t, MAX_T));
});

// vec3 calcNormal(vec3 p, int octaves)
const calcNormal = Fn(([p]) => {
  const e = 0.002;
  return normalize(vec3(
    map(p.add(vec3(e, 0, 0)), NOR_LOD).sub(map(p.sub(vec3(e, 0, 0)), NOR_LOD)),
    map(p.add(vec3(0, e, 0)), NOR_LOD).sub(map(p.sub(vec3(0, e, 0)), NOR_LOD)),
    map(p.add(vec3(0, 0, e)), NOR_LOD).sub(map(p.sub(vec3(0, 0, e)), NOR_LOD)),
  ));
});

const shadows = Fn(([ro, rd]) => {
  const tMax = 8.0;
  const k = 12.0;
  const res = float(1).toVar();
  const t = float(0.1).toVar();
  Loop(SHADOW_STEPS, () => {
    If(t.greaterThanEqual(tMax), () => Break());
    const h = map(ro.add(rd.mul(t)), GEO_LOD).toVar();
    res.assign(min(res, h.mul(k).div(t)));
    t.addAssign(h);
  });
  return clamp(res, 0.2, 1.0);
});

// ---------- RENDER ----------
// vec3 render(vec3 ro, vec3 rd)  (+ stars at night)
const render = Fn(([rd]) => {
  const t1 = time.mul(FLY_SPEED / 0.5);
  const cXZ = vec2(t1.mul(0.5), sin(t1.mul(0.1)));
  const ro = vec3(cXZ.x, terrain(cXZ, 1).add(2.5), cXZ.y);

  const res = castRay(ro, rd);
  const lPos = SUN;
  const lCol = P('light');
  const pos = ro.add(rd.mul(res.x));

  const sun = clamp(dot(rd, lPos), 0, 1);
  const skyColor = mix(P('skyLow'), P('skyHigh'), smoothstep(-0.05, 0.6, rd.y)).add(lCol.mul(sun.mul(sun)).mul(0.6)).toVar();
  skyColor.addAssign(lCol.mul(sun.pow(24)).mul(SUN_GLOW));

  const cell = floor(rd.mul(220));
  const rand = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))).mul(43758.5453));
  const twinkle = sin(time.mul(3).add(rand.mul(100))).mul(0.35).add(0.65);
  skyColor.addAssign(vec3(step(0.9975, rand).mul(twinkle).mul(smoothstep(0.08, 0.35, rd.y)).mul(night)));

  const color = vec3(skyColor).toVar();

  If(res.y.greaterThan(0.5), () => {
    const nor = calcNormal(pos);

    // mat 0 = Rock / mountain
    color.assign(mix(P('rock'), P('sand'), step(0.9, nor.y)));                         // base rock
    const n = snoise(pos.xy.mul(vec2(2, 15))).add(1).mul(0.5);                          // layer noise
    color.assign(mix(P('layer'), color, n.mul(smoothstep(0, 0.7, nor.y.oneMinus()))));
    color.assign(mix(color, P('sand'), smoothstep(0, 0.2, nor.y.sub(0.8))));            // sand on top

    // lighting and shadows
    const lAmb = clamp(nor.y.mul(0.5).add(0.5), 0, 1);
    const lDif = clamp(dot(nor, lPos), 0, 2).toVar();
    If(lDif.greaterThan(0.05), () => {
      lDif.mulAssign(shadows(pos, lPos));
    });
    color.addAssign(lCol.mul(lAmb.mul(0.4)));
    color.mulAssign(lCol.mul(lDif.mul(1.8)));

    // fog
    const fog = exp(res.x.mul(res.x).mul(-0.003));
    color.assign(mix(skyColor, color, fog));
  });

  return color;
});

// ---------- BACKGROUND + ENVIRONMENT ----------
export function createDesert({ renderer, scene }) {
  scene.background = null;
  scene.backgroundNode = render(normalWorldGeometry);

  const envRT = new THREE.RenderTarget(ENV_SIZE[0], ENV_SIZE[1], { type: THREE.HalfFloatType });
  envRT.texture.mapping = THREE.EquirectangularReflectionMapping;
  envRT.texture.wrapS = THREE.RepeatWrapping;
  const envMat = new THREE.MeshBasicNodeMaterial();
  envMat.colorNode = Fn(() => {
    const theta = uv().x.sub(0.5).mul(Math.PI * 2); // inverse of three's equirectUV
    const lat = uv().y.sub(0.5).mul(Math.PI);
    return render(vec3(cos(lat).mul(cos(theta)), sin(lat), cos(lat).mul(sin(theta))));
  })();
  const quad = new THREE.QuadMesh(envMat);
  scene.environment = envRT.texture;

  let frame = 0;
  let needsEnv = true;

  return {
    envMap: envRT.texture,

    setSunDirection(v) {
      SUN.value.set(v.x, 0, v.z).normalize();
      SUN.value.y = SUN_HEIGHT;
      SUN.value.normalize();
      needsEnv = true;
    },

    setNight(t) {
      night.value = t;
      needsEnv = true;
    },

    update() {
      frame++;
      if (!needsEnv && frame % ENV_EVERY !== 0) return;
      renderer.setRenderTarget(envRT);
      quad.render(renderer);
      renderer.setRenderTarget(null);
      envRT.texture.needsPMREMUpdate = true;
      needsEnv = false;
    },
  };
}
