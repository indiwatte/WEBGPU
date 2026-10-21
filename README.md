# RoosterRojo Experience — how tequila is made

This is my WebGPU project about how tequila is made. I used the tequila factory i  in Blender and put it
in a website. It starts like a normal Rooster Rojo website header, and when you scroll down you go into
the story. In every step you do something yourself: light the fire in the oven, grind the agave with
the stone wheel and fill a round of shots at the tap.

This is a school project, it is not made by or for Rooster Rojo.

## Live version
https://webgpu-gules.vercel.app/

## The Shadertoy shaders I used
I ported these two shaders from Shadertoy (GLSL) to three.js TSL. TSL turns into WGSL, which is the
shader language of WebGPU.

**1. "Flame" by XT95 (anatole duprat), 2013**
https://www.shadertoy.com/view/MdX3zr
- File: `src/flame.js`
- This is the fire in the oven. You click the oven to light it, you drag up or down to make the fire
  bigger or smaller, and when you move your mouse the flame moves with it. This works with uniforms
  (`uOn`, `uHeat`, `uWind`) that I change from JavaScript.

**2. "Eroded sandstone hills" by jarble, 2021** (with a noise trick by Dave_Hoskins)
https://www.shadertoy.com/view/fsK3Rt
- File: `src/desert.js`
- This is the desert in the background. It runs live, so when you look around or scroll, the
  landscape changes with the camera. It also changes colors with the day/night button.

At the top of both files I wrote down what I changed compared to the original.

## My own shaders, made with Claude
For the glass spiral around the bottle I wanted a liquid that fills up while you grind the agave.
I couldn't find a shader on Shadertoy that did what I was looking for, so I tried to make one together
with Claude (an AI assistant). I used this to learn how shader code is written: how you work per
pixel, how uniforms send values from JavaScript to the shader, and how you build it in TSL.

The shaders I made this way:
- the liquid in the glass spiral that fills up while grinding (`src/coil.js`)
- the moving stripes on the conveyor belts
- the neon "shots" sign that flickers
- the stars at night and the sky colors in the desert

## What else is in it
- **three.js with the WebGPURenderer** (if your browser doesn't have WebGPU, it uses WebGL)
- **My own Blender model** with **baked textures** (color, roughness, normal map and ambient occlusion),
  exported as a compressed glTF (Draco)
- **Interactions:**
  - light the fire and make it big or small
  - drag the stone wheel to grind the agave (you hear the stone, the spiral fills up and the piñas
    roll from the oven into the mill)
  - pull the handle of the shots machine: it warms up and shakes, and a glass comes out on the belt
  - turn the tap to fill the glass, close it in time or it spills over
  - after four full glasses, scroll to let two glasses make a toast
  - day/night switch
- **Bloom** so the neon sign, the fire and the lamp glow (stronger at night)
- **Reflections** of the desert on the copper and the glass
- **Simple physics:** spilled drops fall down and make puddles (my own code, no physics library)
- **GSAP** for the scroll intro, the story cards and the toast
- **Sounds** with Web Audio (machine, fire, pouring, clinking glasses) and mariachi music while you play

I used AI (Claude) a lot while making this project. I made the design, the story and the Blender
model myself, and I tried to understand and adjust all the code.

## Credits
- Music: "Classic Mariachi Musica sin Copyright" — **TODO: where I downloaded it**
- Photos on the story cards (`public/storycards/`) — **TODO: where they come from**
- The Rooster Rojo name and logo belong to Rooster Rojo, I only use them for this school project
- Facts about Rooster Rojo: Master of Malt, The Daily Pour, Bottle of Italy

## Run it on your computer
```bash
cd ocho-anos
npm install
npm run dev
```
