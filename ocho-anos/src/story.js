import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

const HERO_SHIFT = 0.22;

const CHAPTERS = [
  {
    kicker: 'El agave',
    title: 'Blue Weber agave',
    text: 'Every bottle starts with 100% Blue Weber agave from Los Altos de Jalisco and the Tequila valley. The plant grows for years before the jimadores cut away its leaves and harvest the heart: the piña.',
    hint: 'Drag to look around, scroll to zoom.',
    hintAt: 'agave',
    parts: ['agave'],
    dir: [-0.4, 0.45, 1],
    zoom: 2.6,
  },
  {
    kicker: 'El horno',
    title: 'Cooking the piñas',
    text: 'The piñas are cut in half and slow-cooked with steam for about 10 hours. The heat turns the agave starch into sweet sugars. Here it is a fire oven, at the distillery steam autoclaves do the job.',
    hint: 'Click the oven to light the fire.',
    hintAt: 'oven',
    parts: ['oven', 'pina'],
    dir: [0.2, 0.4, 1],
    zoom: 1.8,
  },
  {
    kicker: 'La molienda',
    title: 'Crushing & fermenting',
    text: 'The cooked agave is crushed to release its juice. Then a proprietary yeast is added and the juice ferments for up to 72 hours, a recipe kept by the master distiller.',
    hint: 'Drag the stone wheel (the tahona) and watch the juice fill the glass coil.',
    hintAt: 'tahona_wheel',
    parts: ['mill', 'tahona_wheel', 'tahona_arm'],
    photo: '/storycards/story-photo1.png',
    caption: 'a tahona at work',
    dir: [-0.3, 0.7, 1],
    zoom: 1.9,
  },
  {
    kicker: 'La destilación',
    title: 'Distilled twice',
    text: 'The fermented juice is distilled two times in pot stills. Each run concentrates the aromas and makes the spirit cleaner and smoother.',
    hint: null, // informative step, nothing to do here
    hintAt: 'coil',
    parts: ['still', 'coil'],
    photo: '/storycards/story-photo2.png',
    caption: 'a still, the horno behind',
    dir: [0.5, 0.35, 1],
    zoom: 1.7,
  },
  {
    kicker: 'El reposo',
    title: 'Resting in oak',
    text: 'The Reposado rests in oak barrels for at least two months, which gives it its golden color and a rounder taste. The brand filters its water through Mexican silver for a softer finish.',
    hint: null, // informative step, nothing to do here
    hintAt: 'bottle',
    parts: ['bottle'],
    dir: [0.1, 0.3, 1],
    zoom: 1.6,
  },
  {
    kicker: '¡Salud!',
    title: 'Ready to pour',
    text: 'From the agave field to the shot glass. Serve it with a slice of lime and enjoy it responsibly.',
    hint: 'Pull the machine handle down to start the filling line.',
    hintAt: 'machine_lever',
    parts: ['glass', 'lime', 'panel_shots', 'tap'],
    dir: [0.4, 0.5, 1],
    zoom: 1.5,
  },
];

export function createStory({ camera, controls }) {
  const el = {
    intro: document.querySelector('#intro'),
    readMore: document.querySelector('#read-more'),
    story: document.querySelector('#story'),
    stack: document.querySelector('.card-stack'),
    body: document.querySelector('.postcard-body'),
    photo: document.querySelector('.postcard-photo img'),
    caption: document.querySelector('.postcard-photo figcaption'),
    greeting: document.querySelector('.greeting-big'),
    postmark: document.querySelector('.postmark-num'),
    kicker: document.querySelector('.story-kicker'),
    title: document.querySelector('.story-title'),
    text: document.querySelector('.story-text'),
    hint: document.querySelector('.scene-hint-text'),
    sceneHint: document.querySelector('.scene-hint'),
    dots: document.querySelector('.dots'),
    prev: document.querySelector('#prev'),
    next: document.querySelector('#next'),
  };

  let machine = null;
  let center = new THREE.Vector3();
  let size = 1;
  let mode = 'intro';
  let index = 0;
  const intro = { t: 0 };

  controls.enabled = false; // so the wheel scrolls the page

  // ---------- INTRO ----------
  // page load: the header drops in, then the hero text
  gsap.from('.site-header', { y: -80, duration: 0.8, ease: 'power3.out' });
  gsap.from('.hero > *', { y: 40, opacity: 0, duration: 1, stagger: 0.12, delay: 0.2, ease: 'power3.out' });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: el.intro,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1,
      onUpdate: (self) => self.progress > 0.995 && mode === 'intro' && start(), // end of the scroll → story
    },
  });
  tl.to(intro, { t: 1, ease: 'none', duration: 1 }, 0)
    .to('.hero', { opacity: 0, x: -80, duration: 0.25 }, 0.05)
    .fromTo('.origin', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.2 }, 0.3)
    .to('.origin', { opacity: 0, y: -60, duration: 0.2 }, 0.6)
    .fromTo('.start-panel', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.15 }, 0.8);

  // READ MORE glides all the way down into the story
  el.readMore.addEventListener('click', (e) => {
    e.preventDefault();
    gsap.to(window, { scrollTo: { y: 'max' }, duration: 3, ease: 'power2.inOut' });
  });

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

  // ---------- HINT IN THE SCENE ----------
  let hintAnchor = null; // world position the hint points at
  const projected = new THREE.Vector3();

  function setHint(text, objectName) {
    el.hint.textContent = text;
    hintAnchor = null;
    const obj = machine?.getObjectByName(objectName);
    if (!obj) return;
    const meshes = obj.isMesh ? [obj] : obj.children.filter((c) => c.isMesh && c.userData.name === undefined);
    const box = new THREE.Box3();
    (meshes.length ? meshes : [obj]).forEach((m) => box.expandByObject(m));
    hintAnchor = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  }

  function positionHint() {
    if (mode !== 'story' || !hintAnchor) {
      el.sceneHint.style.visibility = 'hidden';
      return;
    }
    projected.copy(hintAnchor).project(camera);
    const behind = projected.z > 1;
    const x = THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * window.innerWidth, 16, window.innerWidth - 280);
    const y = THREE.MathUtils.clamp((-projected.y * 0.5 + 0.5) * window.innerHeight, 90, window.innerHeight - 40);
    el.sceneHint.style.transform = `translate(${x - 7}px, ${y}px) translate(0, -50%)`; // dot centered on the part
    el.sceneHint.style.visibility = behind ? 'hidden' : 'visible'; // opacity does the fading (gsap)
  }

  function stepHint(step, text, objectName) {
    if (mode !== 'story' || index !== step) return;
    setHint(text, objectName);
    gsap.fromTo(el.sceneHint, { scale: 0.85 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
  }
  const lastHint = (text, objectName) => stepHint(CHAPTERS.length - 1, text, objectName);

  window.addEventListener('fire-lit', () => stepHint(1, 'Drag up or down on the fire to make it bigger or smaller.', 'oven'));
  window.addEventListener('machine-start', () => lastHint('The light is on, warming up…', 'machine_lever'));
  window.addEventListener('tap-full', () => lastHint('Full! Drag the tap handle back to close it.', 'tap'));
  window.addEventListener('tap-overflow', () => lastHint("It's overflowing! Close the tap!", 'tap'));
  window.addEventListener('tap-spill', () => lastHint("There's no glass under the tap, it's spilling!", 'tap'));
  window.addEventListener('tap-closed-short', () => lastHint('Not full yet, open the tap a bit more.', 'tap'));
  window.addEventListener('glass-filled', (e) => lastHint(`Glass ${e.detail.filled} of ${e.detail.total} is full! Pull the handle for the next one.`, 'machine_lever'));
  window.addEventListener('glass-not-full', () => lastHint('Fill the glass under the tap first.', 'tap'));
  window.addEventListener('glass-ready', (e) => lastHint(e.detail.count === 1
    ? 'Here comes your first glass! Turn the red tap handle to fill it.'
    : 'Next glass! Turn the tap.', 'tap'));
  window.addEventListener('all-filled', () => lastHint('All four are full! Scroll to raise a toast. 🥂', 'belt'));
  window.addEventListener('salud', () => lastHint('¡Salud! 🥃 Pull the handle for a new round.', 'machine_lever'));
  window.addEventListener('shots-reset', () => lastHint('The glasses are back in the machine. Pull the handle for a new round.', 'machine_lever'));

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
    gsap.killTweensOf(window);
    gsap.to(el.story, { autoAlpha: 1, duration: 0.6, delay: 0.4 });
    camera.clearViewOffset(); // the machine moves back to the middle

    controls.enabled = true;
    controls.enablePan = false;
    goTo(0);
  }

  let cardsShown = false;

  function swapCards(fill, dir) {
    if (!cardsShown) {
      cardsShown = true;
      fill();
      gsap.fromTo(el.stack, { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: 'back.out(1.3)' });
      return;
    }

    const old = el.stack.cloneNode(true);
    old.classList.add('card-stack-leaving');
    old.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    old.setAttribute('aria-hidden', 'true');
    el.stack.after(old);
    fill();

    const [front, back] = old.querySelectorAll('.card');
    gsap.timeline({ onComplete: () => old.remove() })
      .to(back, {
        x: -dir * 520, y: -60, rotation: `${-dir * 16}`, rotationY: -dir * 35, transformPerspective: 900,
        autoAlpha: 0, duration: 0.75, ease: 'power2.inOut',
      }, 0)
      .to(front, {
        x: -dir * 460, y: -120, rotation: `${-dir * 22}`, rotationY: -dir * 35, transformPerspective: 900,
        autoAlpha: 0, duration: 0.75, ease: 'power2.inOut',
      }, 0.08);

    gsap.fromTo(el.stack,
      { y: 14, scale: 0.97, autoAlpha: 0.4 },
      { y: 0, scale: 1, autoAlpha: 1, duration: 0.6, delay: 0.1, ease: 'power2.out', overwrite: true });
  }

  function goTo(i) {
    const nextIndex = THREE.MathUtils.clamp(i, 0, CHAPTERS.length - 1);
    const dir = nextIndex >= index ? 1 : -1;
    index = nextIndex;
    const ch = CHAPTERS[index];

    // postcards
    const num = String(index + 1).padStart(2, '0');
    swapCards(() => {
      el.kicker.textContent = `Paso ${num} de ${String(CHAPTERS.length).padStart(2, '0')} · ${ch.kicker}`;
      el.title.textContent = ch.title;
      el.text.textContent = ch.text;
      el.postmark.textContent = num;

      el.greeting.textContent = ch.kicker;
      el.body.classList.toggle('no-photo', !ch.photo);
      if (ch.photo) el.photo.src = ch.photo;
      el.photo.alt = ch.caption ?? '';
      el.caption.textContent = ch.caption ?? '';
    }, dir);

    if (ch.hint) {
      setHint(ch.hint, ch.hintAt);
      gsap.fromTo(el.sceneHint, { opacity: 0 }, { opacity: 1, duration: 0.5, delay: 1.2, overwrite: true });
    } else {
      hintAnchor = null; // informative step: no instruction
      gsap.to(el.sceneHint, { opacity: 0, duration: 0.3, overwrite: true });
    }

    [...el.dots.children].forEach((d, n) => d.classList.toggle('active', n === index));
    el.prev.disabled = index === 0;
    el.next.textContent = index === CHAPTERS.length - 1 ? 'restart ↺' : 'next →';

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

    update() {
      if (mode === 'story') positionHint();
      if (mode !== 'intro' || !machine) return;
      const t = intro.t;
      const e = t * t * (3 - 2 * t); // smoothstep, eases in and out

      const angle = THREE.MathUtils.lerp(0.18, -0.3, e);
      const dist = size * THREE.MathUtils.lerp(0.95, 0.72, e);
      const height = size * THREE.MathUtils.lerp(0.16, 0.38, e);
      camera.position.set(center.x + Math.sin(angle) * dist, center.y + height, center.z + Math.cos(angle) * dist);
      controls.target.copy(center);
      camera.lookAt(center);

      const shift = (window.innerWidth > 800 ? HERO_SHIFT : 0) * (1 - e);
      const w = window.innerWidth, h = window.innerHeight;
      camera.setViewOffset(w, h, -shift * w, 0, w, h);
    },
  };
}
