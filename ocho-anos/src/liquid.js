// Based on a Shadertoy glass-blob shader, ported to TSL and adapted to sit inside the bottle

import * as THREE from 'three/webgpu';
import {
    Fn, vec2, vec3, vec4, float, uniform, time, positionLocal, cameraPosition, modelWorldMatrixInverse,
    texture, equirectUV, sin, cos, abs, mix, max, pow, dot, length, normalize, clamp,
    smoothstep, reflect, refract, Loop, If, Break, Discard,
} from 'three/tsl';

// ---------- SETTINGS ----------
const GLASS_CLARITY = 0.56;
const COLORS_ENABLED = true;
const Ni1 = 1.0;    // air
const Ni2 = 1.42;   // glass
const EXCHANGE_SPEED = 0.2;
const LIGHT_POS = vec3(-25.0, 19.5, -20.0);

const MAX_STEPS = 200;
const EPS = 0.0001;
const NORMAL_EPS = 0.01;  // smaller is noisy in 32-bit
const MAX_DIST = 60.0;

// ---------- UNIFORMS ----------
export const liquidUniforms = {
    uHeight: uniform(1),
    uTint: uniform(new THREE.Color('#ffa24a')),
};
const { uHeight, uTint } = liquidUniforms;

const SCALE = uHeight.div(55); // fit the scene in the bottle

// reflections use the scene HDR, handed over from main.js once it has loaded
let envMap = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); // grey until then
envMap.needsUpdate = true;
const envNodes = [];

export function setLiquidEnvironment(tex) {
  envMap = tex;
  envNodes.forEach((node) => (node.value = tex));
}

// blob space → bottle space before sampling
const environment = Fn(([dir]) => {
  const node = texture(envMap, equirectUV(normalize(dir.yxz)));
  envNodes.push(node);
  return node.xyz;
});

// ---------- SDFs ----------
// https://iquilezles.org/articles/smin
const smin = Fn(([a, b, k]) => {
    const h = clamp(b.sub(a).div(k).mul(0.5).add(0.5), 0, 1);
    return mix(b, a, h).sub(k.mul(h).mul(h.oneMinus()));
});

const SphereSDF = Fn(([p, r]) => length(p).sub(r));

const TorusSDF = Fn(([p, R, r]) => {
    const xy = length(p.xy).sub(R);
    return length(vec2(xy, p.z)).sub(r);
});

const CombineSDF = Fn(([p]) => {
    const sph1Pos = p.add(vec3(14, sin(time.mul(0.63)).mul(6).sub(8), 0));
    const sd = SphereSDF(sph1Pos, 5).toVar();
    const sph2Pos = p.add(vec3(-14, cos(time.mul(0.63)).mul(6).sub(8), 0));
    const sph2 = SphereSDF(sph2Pos, 5);
    const interT = smoothstep(0, 1, abs(sin(time.mul(EXCHANGE_SPEED))));
    const torPos = mix(sph1Pos, sph2Pos, interT);
    const sph3 = TorusSDF(torPos, 7, 2);
    sd.assign(smin(sd, sph2, float(5)));
    sd.assign(smin(sph3, sd, float(5)));
    return sd;
});

const GetNormal = Fn(([p]) => {
    const e = vec2(NORMAL_EPS, 0);
    return normalize(vec3(
        CombineSDF(p.add(e.xyy)).sub(CombineSDF(p.sub(e.xyy))),
        CombineSDF(p.add(e.yxy)).sub(CombineSDF(p.sub(e.yxy))),
        CombineSDF(p.add(e.yyx)).sub(CombineSDF(p.sub(e.yyx))),
    ));
});

// x = diffuse, y = specular
const PhongModel = Fn(([L, V, N]) => {
    const diff = max(0, dot(N, L));
    const R = normalize(reflect(L, N));
    const spec = max(0.01, pow(max(0, dot(R, V)), 180)); // clamp: pow of a negative is undefined
    return vec2(diff, spec);
});

// ---------- MAIN ----------
const liquidColor = Fn(() => {
    // ray from the camera, in the mesh's local space
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    const dirLocal = normalize(positionLocal.sub(camLocal));

    // to blob space: swap x/y so it stands upright, center and scale
    const centered = positionLocal.sub(vec3(0, uHeight.mul(0.5), 0));
    const org = centered.yxz.div(SCALE).add(vec3(0, 8, 0));
    const dir = dirLocal.yxz;

    // trace
    const t = float(0).toVar();
    const hit = float(0).toVar();
    Loop(MAX_STEPS, () => {
        const sd = CombineSDF(org.add(dir.mul(t))).toVar();
        If(sd.lessThan(EPS), () => {
            hit.assign(1);
            Break();
        });
        t.addAssign(sd);
        If(t.greaterThan(MAX_DIST), () => {
            Break();
        });
    });

    If(hit.lessThan(0.5), () => {
        Discard();
    });

    const hitAt = org.add(dir.mul(t));
    const lDir = normalize(LIGHT_POS.sub(hitAt));
    const N = GetNormal(hitAt);
    const dCoeff = PhongModel(lDir, dir, N);

    // Schlick
    const rZero = Math.pow((Ni1 - Ni2) / (Ni1 + Ni2), 2);
    const cosTheta = dot(N, dir);
    const reflWeight = pow(cosTheta.oneMinus(), 10).mul(1 - rZero).add(rZero)
        .mul(dCoeff.y).mul(0.1);

    const reflCol = environment(reflect(dir, N));
    const refrCol = environment(refract(dir, N, Ni1 / Ni2)).mul(uTint);

    const col = reflCol.mul(reflWeight).add(refrCol.mul(0.9)).mul(GLASS_CLARITY).toVar();

    if (COLORS_ENABLED) {
        const wave = hitAt.x.add(time.mul(2));
        col.addAssign(vec3(cos(wave), 0, sin(wave)).mul(0.15).mul(reflWeight).mul(abs(sin(time.mul(0.15)))));
    }

    return col; // no gamma, three.js handles output
});

// ---------- MATERIAL ----------
export function createLiquidMaterial() {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = liquidColor();
    material.side = THREE.FrontSide;
    return material;
}
