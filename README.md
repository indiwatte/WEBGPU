# Ocho Años — an interactive Rooster Rojo story

An interactive WebGPU experience about how tequila is made, built around my own Blender model of a
tequila machine. It starts as a website header; scrolling leads into the story, where every step of
the process is something you do yourself: light the oven fire, grind the agave with the stone wheel,
and fill a round of shots at the tap.

School project · not affiliated with Rooster Rojo.

## Live demo
https://webgpu-gules.vercel.app/

## Original shaders (Shadertoy)
All three are ported from GLSL to Three.js TSL, which compiles to WGSL for WebGPU.

| Shader | Original | Used in | Responds to |
|---|---|---|---|
| "Flame" by XT95 (anatole duprat), 2013, CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MdX3zr | `src/flame.js` — the oven fire | click the oven to light it, drag up/down to resize it, mouse position bends it (uniforms `uOn`, `uHeat`, `uWind`) |
| Glass blobs (raymarched SDF spheres + torus) — **TODO: name, author** | **TODO: Shadertoy URL** | `src/liquid.js` — the tequila in the shot glasses | fill level from the tap, rendered from the real camera |
| Desert canyon (terrain raymarching, soft shadows, fog) — **TODO: name, author**; noise trick by Dave_Hoskins | **TODO: Shadertoy URL** | `src/desert.js` — the live background | the camera (orbit / scroll), the day/night switch |

The changes made to each shader are listed at the top of its file.

## What's in it
- **Three.js `WebGPURenderer`** (falls back to WebGL when WebGPU isn't available), all shaders written in **TSL**
- **My own Blender model** with **baked textures** (color, roughness, normal, ambient occlusion), Draco-compressed glTF
- **My own TSL shaders**: the glass coil that fills with juice, moving belt seams, stars and an emissive flickering neon sign
- **Post-processing**: bloom (`RenderPipeline` + `BloomNode`), stronger at night
- **Render-to-texture**: the background shader is rendered into a small panorama for reflections on the copper and glass
- **Interactions**: light and resize the fire · drag the tahona to grind (sound, the coil fills, piñas roll in on the mini belt) · pull the machine handle (warm-up shake and hum, glasses come out on the belt) · turn the tap to fill each glass (overflow spills into puddles) · scroll to make two glasses toast · day/night switch
- **Simple physics**: spilled drops fall with gravity and land in puddles (my own code, no physics engine)
- **GSAP** (ScrollTrigger, ScrollTo, Observer) for the scroll intro, story cards and the toast
- **Web Audio**: synthesized machine hum, fire, pouring and clink sounds

## Credits
- Music: "Classic Mariachi Musica sin Copyright" — **TODO: source / link**
- Story card photos (`public/storycards/`) — **TODO: source**
- Rooster Rojo name and logo belong to their owner; used here only for a non-commercial school project
- Facts about Rooster Rojo from retailer and press pages (Master of Malt, The Daily Pour, Bottle of Italy)

## Run locally
```bash
cd ocho-anos
npm install
npm run dev
```
