import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// parts = Blender names (without _01), dir = camera direction from the part, zoom = distance × part size
const CHAPTERS = [
  {
    kicker: 'El agave',
    title: 'Blue Weber agave',
    text: 'Every bottle starts with 100% Blue Weber agave from Los Altos de Jalisco and the Tequila valley. The plant grows for years before the jimadores cut away its leaves and harvest the heart: the piña.',
    hint: 'Drag to look around, scroll to zoom.',
    parts: ['agave'],
    dir: [-0.4, 0.45, 1],
    zoom: 2.6,
  },
  {
    kicker: 'El horno',
    title: 'Cooking the piñas',
    text: 'The piñas are cut in half and slow-cooked with steam for about 10 hours. The heat turns the agave starch into sweet sugars. Here it is a fire oven, at the distillery steam autoclaves do the job.',
    hint: 'Hold the mouse down on the scene to turn up the heat.',
    parts: ['oven', 'pina'],
    dir: [0.2, 0.4, 1],
    zoom: 1.8,
  },
  {
    kicker: 'La molienda',
    title: 'Crushing & fermenting',
    text: 'The cooked agave is crushed to release its juice. Then a proprietary yeast is added and the juice ferments for up to 72 hours, a recipe kept by the master distiller.',
    hint: 'Drag the stone wheel (the tahona) and watch the juice fill the glass coil.',
    parts: ['mill', 'tahona_wheel', 'tahona_arm'],
    dir: [-0.3, 0.7, 1],
    zoom: 1.9,
  },
  {
    kicker: 'La destilación',
    title: 'Distilled twice',
    text: 'The fermented juice is distilled two times in pot stills. Each run concentrates the aromas and makes the spirit cleaner and smoother.',
    hint: 'Follow the coil from the still to the bottle.',
    parts: ['still', 'coil'],
    dir: [0.5, 0.35, 1],
    zoom: 1.7,
  },
  {
    kicker: 'El reposo',
    title: 'Resting in oak',
    text: 'The Reposado rests in oak barrels for at least two months, which gives it its golden color and a rounder taste. The brand filters its water through Mexican silver for a softer finish.',
    hint: 'Watch the liquid move inside the bottle.',
    parts: ['bottle'],
    dir: [0.1, 0.3, 1],
    zoom: 1.6,
  },
  {
    kicker: '¡Salud!',
    title: 'Ready to pour',
    text: 'From the agave field to the shot glass. Serve it with a slice of lime and enjoy it responsibly.',
    hint: 'Turn the red tap handle to fill the empty glass, close it in time, then pull the machine handle down.',
    parts: ['glass', 'lime', 'panel_shots', 'tap'],
    dir: [0.4, 0.5, 1],
    zoom: 1.5,
  },
];

export function createStory({ camera, controls }) {
  const el = {
    intro: document.querySelector('#intro'),
    start: document.querySelector('#start'),
    story: document.querySelector('#story'),
    brand: document.querySelector('.brand-bar'),
    content: document.querySelector('.story-content'),
    kicker: document.querySelector('.story-kicker'),
    title: document.querySelector('.story-title'),
    text: document.querySelector('.story-text'),
    hint: document.querySelector('.story-hint'),
    dots: document.querySelector('.dots'),
    prev: document.querySelector('#prev'),
    next: document.querySelector('#next'),
  };

  let machine = null;
  let center = new THREE.Vector3();
  let size = 1;
  let mode = 'intro';
  let index = 0;
  const intro = { t: 0 }; // 0 = wide shot, 1 = hero framing

  controls.enabled = false; // so the wheel scrolls the page

  // ---------- INTRO ----------
  gsap.from('.hero > *', { y: 40, opacity: 0, duration: 1, stagger: 0.12, ease: 'power3.out' });

  const tl = gsap.timeline({
    scrollTrigger: { trigger: el.intro, start: 'top top', end: 'bottom bottom', scrub: 1 },
  });
  tl.to(intro, { t: 1, ease: 'none', duration: 1 }, 0)
    .to('.hero', { opacity: 0, y: -80, duration: 0.25 }, 0.05)
    .fromTo('.origin', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.2 }, 0.3)
    .to('.origin', { opacity: 0, y: -60, duration: 0.2 }, 0.6)
    .fromTo('.start-panel', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.15 }, 0.82);

  el.start.addEventListener('click', start);

  // ---------- STORY ----------
  CHAPTERS.forEach(() => {
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.dots.appendChild(dot);
  });

  el.prev.addEventListener('click', () => goTo(index - 1));
  el.next.addEventListener('click', () => (index === CHAPTERS.length - 1 ? goTo(0) : goTo(index + 1)));
  window.addEventListener('keydown', (e) => {
    if (mode !== 'story') return;
    if (e.key === 'ArrowRight') goTo(index + 1);
    if (e.key === 'ArrowLeft') goTo(index - 1);
  });

  // feedback from the shots machine in the last chapter
  function lastHint(text) {
    if (mode !== 'story' || index !== CHAPTERS.length - 1) return;
    el.hint.textContent = text;
    gsap.fromTo(el.hint, { scale: 0.8 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
  }
  window.addEventListener('machine-start', () => lastHint('The light is on, warming up…'));
  window.addEventListener('round-served', () => lastHint('¡Salud! 🥃 Pull the handle again for a fresh round.'));
  window.addEventListener('shots-reset', () => lastHint('Fresh round! Pull the handle to send them off.'));
  window.addEventListener('tap-full', () => lastHint('Full! Drag the tap handle back to close it.'));
  window.addEventListener('tap-overflow', () => lastHint("It's overflowing! Close the tap!"));
  window.addEventListener('tap-spill', () => lastHint("There's no glass under the tap, it's spilling!"));
  window.addEventListener('tap-closed-full', () => lastHint('Perfect pour! Now pull the machine handle down.'));

  function start() {
    mode = 'story';
    tl.scrollTrigger.kill();
    tl.kill();

    document.body.classList.add('is-story');
    gsap.to(el.intro, {
      autoAlpha: 0,
      duration: 0.6,
      onComplete: () => {
        el.intro.remove();
        window.scrollTo(0, 0);
      },
    });
    gsap.to([el.story, el.brand], { autoAlpha: 1, duration: 0.6, delay: 0.4 });

    controls.enabled = true;
    controls.enablePan = false;
    goTo(0);
  }

  function goTo(i) {
    index = THREE.MathUtils.clamp(i, 0, CHAPTERS.length - 1);
    const ch = CHAPTERS[index];

    // text
    gsap.timeline()
      .to(el.content, { autoAlpha: 0, y: 10, duration: 0.2 })
      .call(() => {
        el.kicker.textContent = `${String(index + 1).padStart(2, '0')} / ${String(CHAPTERS.length).padStart(2, '0')} · ${ch.kicker}`;
        el.title.textContent = ch.title;
        el.text.textContent = ch.text;
        el.hint.textContent = ch.hint;
      })
      .to(el.content, { autoAlpha: 1, y: 0, duration: 0.4 });

    [...el.dots.children].forEach((d, n) => d.classList.toggle('active', n === index));
    el.prev.disabled = index === 0;
    el.next.textContent = index === CHAPTERS.length - 1 ? 'Restart ↺' : 'Next →';

    // camera
    if (!machine) return;
    const { target, position } = framing(ch);
    gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, duration: 1.6, ease: 'power3.inOut', overwrite: true });
    gsap.to(camera.position, { x: position.x, y: position.y, z: position.z, duration: 1.6, ease: 'power3.inOut', overwrite: true });
  }

  // camera target + position around the chapter's parts
  function framing(ch) {
    const box = new THREE.Box3();
    machine.traverse((obj) => {
      if (!obj.isMesh) return;
      // meshes of a multi-material object are named after the mesh, the Blender name is on the parent
      const name = obj.userData.name !== undefined ? obj.name : obj.parent.name;
      if (ch.parts.includes(name.replace(/_\d+$/, ''))) box.expandByObject(obj);
    });
    if (box.isEmpty()) box.setFromObject(machine);

    const target = box.getCenter(new THREE.Vector3());
    const dist = Math.max(box.getSize(new THREE.Vector3()).length() * ch.zoom, size * 0.3);
    const position = target.clone().add(new THREE.Vector3(...ch.dir).normalize().multiplyScalar(dist));
    return { target, position };
  }

  return {
    setModel(object) {
      machine = object;
      const box = new THREE.Box3().setFromObject(object);
      box.getCenter(center);
      size = box.getSize(new THREE.Vector3()).length();
      if (mode === 'story') goTo(index);
    },

    // call every frame: during the intro the scroll drives the camera
    update() {
      if (mode !== 'intro' || !machine) return;
      const t = intro.t;
      const angle = THREE.MathUtils.lerp(-1.1, 0.55, t);
      const dist = size * THREE.MathUtils.lerp(2.0, 1.1, t);
      const height = size * THREE.MathUtils.lerp(0.9, 0.35, t);
      camera.position.set(center.x + Math.sin(angle) * dist, center.y + height, center.z + Math.cos(angle) * dist);
      controls.target.copy(center);
      camera.lookAt(center);
    },
  };
}
