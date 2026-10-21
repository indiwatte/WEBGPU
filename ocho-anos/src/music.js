import * as THREE from 'three/webgpu';

const MUSIC_URL = '/sounds/mariachi.mp3';
const VOLUME = 0.8;      // overall volume
const BACKGROUND = 0.4;
const HOLD = 5;

const audio = new Audio(MUSIC_URL);
audio.loop = true;
audio.volume = 0;
audio.preservesPitch = false;

let volume = 0;
let activeUntil = 0;
let pour = 0;
let overflowing = false;

window.addEventListener('pointerdown', () => {
  if (audio.paused && volume === 0) audio.play().then(() => volume === 0 && audio.pause()).catch(() => {});
}, { capture: true, once: true });

export const music = {
  activity(hold = HOLD) {
    activeUntil = Math.max(activeUntil, performance.now() / 1000 + hold);
  },

  setPour(amount, isOverflowing) {
    pour = amount;
    overflowing = isOverflowing;
    if (amount > 0) this.activity();
  },

  // call every frame
  update(dt) {
    const now = performance.now() / 1000;
    const background = now < activeUntil ? BACKGROUND : 0;
    const pouring = pour > 0 ? 0.35 + 0.65 * pour : 0;
    const target = Math.max(background, pouring) * VOLUME;

    volume += (target - volume) * Math.min(dt * (target > volume ? 3 : 1.2), 1); // fades out slower than in
    audio.volume = THREE.MathUtils.clamp(volume, 0, 1);
    audio.playbackRate += ((overflowing ? 1.35 : 1) - audio.playbackRate) * Math.min(dt * 3, 1);

    if (volume > 0.01 && audio.paused) audio.play().catch(() => {});
    if (volume <= 0.01 && !audio.paused) audio.pause();
  },
};
