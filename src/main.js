import './style.css';
import { animate } from 'animejs';
import { Pipeline } from './gl/pipeline.js';
import { Source } from './source.js';
import { buildScenes, driveScenes, scrollProgress } from './scenes.js';

const canvas = document.getElementById('gl');
const note = document.getElementById('camera-note');
const btnCamera = document.getElementById('btn-camera');
const btnSample = document.getElementById('btn-sample');
const btnSource = document.getElementById('btn-source');
const btnFreeze = document.getElementById('btn-freeze');
const hudPhase = document.getElementById('hud-phase');

let pipe;
try {
  pipe = new Pipeline(canvas);
} catch (err) {
  console.error(err);
  note.textContent = 'Your browser does not support WebGL2, so the live processing cannot run here.';
  note.classList.add('is-error');
}

const source = new Source();
const scenes = buildScenes();

// Page-wide progress bar, seeked alongside the scenes.
const progressBar = animate('.progress__bar', { scaleX: [0, 1], ease: 'linear', duration: 1000, autoplay: false });
const main = document.querySelector('main');

// ---------- Camera controls ----------

function updateSourceButton() {
  btnSource.textContent = source.kind === 'camera' ? 'Use sample' : 'Use camera';
}

async function useCamera() {
  note.classList.remove('is-error');
  note.textContent = 'Asking for camera access…';
  try {
    await source.startCamera('user');
    note.textContent = 'Live camera on. Everything is processed on your device. Nothing is uploaded.';
    btnFreeze.setAttribute('aria-pressed', 'false');
  } catch (err) {
    console.warn(err);
    note.textContent = `Couldn't open the camera (${err.message || err.name}). Showing the sample scene instead.`;
    note.classList.add('is-error');
  }
  updateSourceButton();
}

function useSample() {
  source.stopCamera();
  note.classList.remove('is-error');
  note.textContent = 'Showing a generated sample scene. You can switch to your camera at any time.';
  updateSourceButton();
}

btnCamera.addEventListener('click', useCamera);
btnSample.addEventListener('click', () => {
  useSample();
  scrollBy({ top: innerHeight * 0.8, behavior: 'smooth' });
});
btnSource.addEventListener('click', () => (source.kind === 'camera' ? useSample() : useCamera()));
btnFreeze.addEventListener('click', () => {
  const frozen = btnFreeze.getAttribute('aria-pressed') !== 'true';
  btnFreeze.setAttribute('aria-pressed', String(frozen));
  source.setFrozen(frozen);
});
document.getElementById('btn-top').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

document.getElementById('btn-download').addEventListener('click', () => {
  if (!pipe) return;
  const t = pipe.process({});
  const c = pipe.capture(t.final, document.createElement('canvas'));
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'how-its-made-photo.jpg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/jpeg', 0.92);
});

// ---------- Real JPEG size from the browser's encoder ----------

const jpegCanvas = document.createElement('canvas');
const jpegState = { busy: false, last: 0, quality: -1 };
function encodeJpeg(target, quality, done) {
  const now = performance.now();
  if (jpegState.busy || (quality === jpegState.quality && now - jpegState.last < 1500) || now - jpegState.last < 250) return;
  jpegState.busy = true;
  jpegState.last = now;
  jpegState.quality = quality;
  pipe.capture(target, jpegCanvas).toBlob((blob) => {
    jpegState.busy = false;
    if (blob) done(blob.size);
  }, 'image/jpeg', quality / 100);
}

// ---------- Render loop ----------

let frame = 0;
let lastActive = null;
const hud = document.querySelector('.hud');
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function processingSize() {
  const [sw, sh] = source.size;
  const maxW = matchMedia('(max-width: 860px)').matches ? 640 : 800;
  const w = Math.min(maxW, sw - (sw % 16));
  const h = Math.round((w * sh) / sw / 16) * 16;
  return [w, h];
}

let lastNow = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.25, (now - (lastNow || now)) / 1000);
  lastNow = now;
  driveScenes(scenes, dt);
  progressBar.seek(scrollProgress(main) * 1000);
  if (!pipe || !source.ready) return;
  const time = now / 1000;
  frame++;
  resize();
  source.tick(time);

  const [w, h] = processingSize();
  if (w !== pipe.w || h !== pipe.h) {
    pipe.resize(w, h);
    document.documentElement.style.setProperty('--src-aspect', `${w} / ${h}`);
    document.documentElement.style.setProperty('--src-aspect-num', (w / h).toFixed(4));
  }
  if (!source.frozen || source.kind === 'sample') pipe.upload(source.element, source.mirror);

  const gl = pipe.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.SCISSOR_TEST);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const focus = source.kind === 'camera' ? [0.5, 0.56] : [0.3, 0.22];
  const vh = innerHeight;
  let active = null;
  let best = 0;
  for (const s of scenes) {
    const sr = s.el.getBoundingClientRect();
    const overlap = Math.min(sr.bottom, vh) - Math.max(sr.top, 0);
    if (overlap > best) {
      best = overlap;
      active = s;
    }
    if (!s.slot) continue;
    const rect = s.slot.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > vh || rect.width < 2) continue;
    s.def.render({
      pipe,
      el: s.el,
      time,
      focus,
      draw: (v) => pipe.display(rect, dpr, canvas.height, v),
      readEvery: (n, fn) => frame % n === 0 && fn(),
      encodeJpeg,
    }, s.params);
  }
  if (active && active !== lastActive) {
    lastActive = active;
    hudPhase.textContent = active.def.label;
    hud.dataset.phase = active.el.dataset.phase || '';
  }
}

requestAnimationFrame(loop);
