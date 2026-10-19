import * as THREE from 'three/webgpu';

// mariachi soundtrack for the interactions: every interaction calls music.activity(), the music fades
// in softly and keeps playing a few seconds after the last one. Pouring makes it louder, an overflowing
// glass speeds it up (and makes it higher).
const MUSIC_URL = '/sounds/mariachi.mp3';
const VOLUME = 0.8;      // overall volume
const BACKGROUND = 0.4;  // level during interactions (part of VOLUME)
const HOLD = 5;          // seconds it keeps playing after the last interaction

const audio = new Audio(MUSIC_URL);
audio.loop = true;
audio.volume = 0;
audio.preservesPitch = false; // so a faster playbackRate also sounds higher

let volume = 0;
let activeUntil = 0;
let pour = 0;
let overflowing = false;

// browsers only allow audio after the user did something: start it silently on the first click
window.addEventListener('pointerdown', () => {
  if (audio.paused && volume === 0) audio.play().then(() => volume === 0 && audio.pause()).catch(() => {});
}, { capture: true, once: true });

export const music = {
  // an interaction happened: keep (or start) the music for a while
  activity(hold = HOLD) {
    activeUntil = Math.max(activeUntil, performance.now() / 1000 + hold);
  },

  // the tap: 0..1 how far it's open, and whether the glass is overflowing
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
    if (volume <= 0.01 && !audio.paused) audio.pause(); // keeps its place, continues from there next time
  },
};
