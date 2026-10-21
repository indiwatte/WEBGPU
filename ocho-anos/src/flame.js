// Based on "Flame" by XT95 (https://www.shadertoy.com/view/MdX3zr), ported to TSL
// Changes: uniforms for heat, wind and on/off, zoomed out with soft edges so a big flame isn't cut off

import * as THREE from 'three/webgpu';
import {
    Fn, vec2, vec3, vec4, float, uniform, uv, time,
    floor, dot, cos, sin, mix, length, abs, min, normalize, pow, Loop, If, smoothstep,
} from 'three/tsl';

const ZOOM = 1.3;

// ---------- UNIFORMS ----------
export const flameUniforms = {
    uHeat: uniform(0.5),   // 0 small, 1 big
    uWind: uniform(0),     // -1 to 1
    uAspect: uniform(1),   // plane width / height
    uOn: uniform(0),       // 0 = out, 1 = burning (lit by the user)
};
const { uHeat, uWind, uAspect, uOn } = flameUniforms;

// ---------- NOISE ----------
const noise = Fn(([p]) => {
    const i = floor(p);
    const a = vec4(dot(i, vec3(1, 57, 21))).add(vec4(0, 57, 21, 78)).toVar();
    const f = cos(p.sub(i).mul(Math.PI)).mul(-0.5).add(0.5);
    a.assign(mix(sin(cos(a).mul(a)), sin(cos(a.add(1)).mul(a.add(1))), f.x));
    const b = mix(a.xz, a.yw, f.y);
    return mix(b.x, b.y, f.z);
});

// ---------- SHAPES ----------
const sphere = Fn(([p, spr]) => length(spr.xyz.sub(p)).sub(spr.w));

const fire = Fn(([p]) => {
    // wind bends the top more than the base
    const pw = p.sub(vec3(uWind.mul(p.y.add(2)).mul(0.3), 0, 0));
    const radius = uHeat.mul(0.2).add(0.9).mul(uOn); // grows from nothing when lit
    const d = sphere(pw.mul(vec3(1, 0.5, 1)), vec4(0, -1, 0, radius));
    const n = noise(pw.add(vec3(0, time.mul(2), 0))).add(noise(pw.mul(3)).mul(0.5));
    return d.add(n.mul(0.25).mul(pw.y));
});

const scene = Fn(([p]) => min(float(100).sub(length(p)), abs(fire(p))));

// ---------- RAYMARCHING ----------
const raymarch = Fn(([org, dir]) => {
    const p = vec3(org).toVar();
    const glow = float(0).toVar();
    const glowed = float(0).toVar(); // bool as float
    const eps = float(0.02);

    Loop(64, ({ i }) => {
        const d = scene(p).add(eps).toVar(); // toVar: evaluate before p moves
        p.addAssign(d.mul(dir));
        If(d.greaterThan(eps), () => {
            If(fire(p).lessThan(0), () => {
                glowed.assign(1);
            });
            If(glowed.greaterThan(0.5), () => {
                glow.assign(float(i).div(64));
            });
        });
    });

    return vec4(p, glow);
});

// ---------- MAIN ----------
const flameColor = (flipY) => Fn(() => {
    const y = flipY ? uv().y.oneMinus() : uv().y;
    const v0 = vec2(uv().x, y).mul(2).sub(1);
    const v = vec2(v0.x.mul(uAspect), v0.y).mul(ZOOM);
    const org = vec3(0, -2, 4);
    const dir = normalize(vec3(v.x.mul(1.6), v.y.negate(), -1.5));
    const r = raymarch(org, dir);
    const glow = r.w;
    const col = mix(vec3(1, 0.5, 0.1), vec3(0.1, 0.5, 1), r.y.mul(0.02).add(0.4));
    const brightness = uHeat.mul(0.8).add(0.6);
    const edges = smoothstep(0, 0.15, y.oneMinus()).mul(smoothstep(0, 0.1, uv().x)).mul(smoothstep(0, 0.1, uv().x.oneMinus()));
    return mix(vec3(0), col, pow(glow.mul(2), 4)).mul(brightness).mul(uOn).mul(edges);
})();

// ---------- MATERIAL ----------
export function createFlameMaterial({ flipY = true } = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = flameColor(flipY);
    material.side = THREE.DoubleSide;
    // additive: black drops out
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    return material;
}
