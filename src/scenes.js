// Each scene: a scroll-synced anime.js timeline that animates its copy, its SVG and a plain
// params object, plus a render function that turns those params into pipeline settings and a view.
// The timeline runs on a 0..1000 scale; scroll position inside the pinned section maps to it.

import { createTimeline, createDrawable, stagger } from 'animejs';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// How fast a timeline catches up with the scroll position (per second). Higher = tighter.
const CATCH_UP = reducedMotion ? Infinity : 9;
const mobile = () => matchMedia('(max-width: 860px)').matches;

const $ = (el, sel) => el.querySelector(sel);
const $$ = (el, sel) => el.querySelectorAll(sel);
const zoomOf = (lz) => Math.pow(2, lz);
const setText = (node, text) => {
  if (node && node.textContent !== text) node.textContent = text;
};

// Timelines are paused and seeked from the render loop (see driveScenes), so scroll position
// is the playhead: scrolling plays, stopping freezes, scrolling back rewinds.
function timeline() {
  return createTimeline({ defaults: { ease: 'inOutSine', duration: 100 }, autoplay: false });
}

// Reveal the copy's steps at the given timeline positions, dimming (or on phones hiding) earlier ones.
function revealSteps(tl, el, at) {
  const steps = [...$$(el, '.step')];
  // On phones the steps share one spot, so the old one fades out before the new one fades in.
  const stacked = mobile();
  steps.forEach((s, i) => {
    const delay = stacked && i > 0 ? 35 : 0;
    tl.add(s, { opacity: [stacked ? 0 : 0.12, 1], translateY: [14, 0], duration: 70, ease: 'outQuad' }, at[i] + delay);
    if (i > 0) tl.add(steps[i - 1], { opacity: stacked ? 0 : 0.36, translateY: stacked ? -10 : 0, duration: stacked ? 35 : 60 }, at[i]);
  });
}

function end(tl) {
  tl.call(() => {}, 1000);
}

// Bayer channel of a texel at bottom-left-origin coordinates (matches the shaders).
const bayer = (x, y) => ((x & 1) === 0 && (y & 1) === 0 ? 'r' : (x & 1) === 1 && (y & 1) === 1 ? 'b' : 'g');

export const scenes = {
  intro: {
    label: 'Start',
    params: {},
    build(tl, el) {
      tl.add($$(el, '.copy > *'), { opacity: [1, 0], translateY: [0, -30], duration: 300, delay: stagger(20) }, 650);
      end(tl);
    },
    render({ pipe, draw }) {
      const t = pipe.process({});
      draw({ texA: t.final.tex });
    },
  },

  lens: {
    label: 'Optics · Lens',
    params: { blur: 1 },
    build(tl, el, p) {
      const rays = createDrawable($$(el, '.ray'));
      const lenses = $$(el, '.lens-el');
      tl.add(rays, { draw: ['0 0', '0 1'], duration: 260, delay: stagger(25), ease: 'inOutQuad' }, 0);
      tl.add(lenses, { translateX: stagger([-70, 70]), duration: 200, ease: 'inOutCubic' }, 300);
      tl.add(lenses, { translateX: 0, duration: 180, ease: 'inOutCubic' }, 500);
      tl.add($(el, '#lens-group'), { translateX: [-26, 8, 0], duration: 320, ease: 'inOutSine' }, 640);
      tl.add(p, { blur: [1, 0.25, 0], duration: 320, ease: 'inOutSine' }, 640);
      revealSteps(tl, el, [0, 300, 620]);
      end(tl);
    },
    render({ pipe, draw }, p) {
      const t = pipe.process({});
      draw({ texA: t.final.tex, blur: p.blur });
    },
  },

  ois: {
    label: 'Optics · Stabiliser',
    params: { ir: 1, shake: 0, ois: 0 },
    build(tl, el, p) {
      tl.add($(el, '#ir-filter'), { translateY: [-60, 0], opacity: [0, 1], duration: 200, ease: 'outCubic' }, 60);
      tl.add(p, { ir: [1, 0], duration: 200 }, 80);
      tl.add(p, { shake: [0, 1], duration: 150 }, 330);
      tl.add(p, { ois: [0, 1], duration: 220 }, 660);
      revealSteps(tl, el, [0, 330, 640]);
      end(tl);
    },
    render({ pipe, draw, time, el }, p) {
      const amt = p.shake * (1 - 0.9 * p.ois);
      const sx = (Math.sin(time * 9.1) + Math.sin(time * 23.7) * 0.6 + Math.sin(time * 4.3) * 0.8) * 0.012 * amt;
      const sy = (Math.sin(time * 7.7 + 1) + Math.sin(time * 19.3) * 0.6 + Math.sin(time * 3.1) * 0.8) * 0.01 * amt;
      const lens = $(el, '#ois-lens');
      const k = p.shake * p.ois * 900;
      lens.setAttribute('transform', `translate(${(-sx * k).toFixed(2)} ${(sy * k).toFixed(2)})`);
      setText($(el, '#chip-ir'), p.ir < 0.5 ? 'IR filter: on' : 'IR filter: off');
      setText($(el, '#chip-ois'), p.ois > 0.5 ? 'OIS: on' : 'OIS: off');
      $(el, '#chip-ir').classList.toggle('is-on', p.ir < 0.5);
      $(el, '#chip-ois').classList.toggle('is-on', p.ois > 0.5);
      const t = pipe.process({});
      draw({ texA: t.final.tex, ir: p.ir, shift: [sx, sy], blur: amt * 0.18 });
    },
  },

  photosites: {
    label: 'Sensor · Photosites',
    params: { lz: 0, wells: 0, fill: 1 },
    build(tl, el, p) {
      tl.add(p, { lz: [0, 5], duration: 330, ease: 'inOutQuad' }, 20);
      tl.add(p, { wells: [0, 1], duration: 160 }, 380);
      tl.add(p, { fill: [1, 0], duration: 60 }, 640);
      tl.add(p, { fill: [0, 1], duration: 300, ease: 'linear' }, 700);
      revealSteps(tl, el, [0, 380, 650]);
      end(tl);
    },
    render({ pipe, draw, focus, el, readEvery }, p) {
      const t = pipe.process({}, 'raw');
      draw({ texA: t.lin.tex, modeA: 3, encA: 1, zoom: zoomOf(p.lz), center: focus, wells: p.wells, grid: 0.5, bright: p.fill });
      readEvery(4, () => {
        const x = Math.floor(focus[0] * pipe.w), y = Math.floor(focus[1] * pipe.h);
        const v = pipe.read(t.lin, x, y, 1, 1);
        const lum = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
        setText($(el, '#well-e'), Math.round(lum * 0.9 * 6000 * p.fill).toLocaleString('en-US'));
      });
    },
  },

  bayer: {
    label: 'Sensor · Bayer filter',
    params: { lz: 5, mosaic: 0, wells: 1, grid: 0.5 },
    build(tl, el, p) {
      tl.add(p, { mosaic: [0, 1], duration: 230 }, 20);
      tl.add($(el, '.bayer-key'), { opacity: [0, 1], scale: [0.8, 1], duration: 120 }, 300);
      tl.add(p, { wells: [1, 0], duration: 150 }, 300);
      tl.add(p, { lz: [5, 0], duration: 320, ease: 'inOutQuad' }, 330);
      tl.add(p, { lz: [0, 3.6], duration: 280, ease: 'inOutQuad' }, 700);
      revealSteps(tl, el, [0, 300, 650]);
      end(tl);
    },
    render({ pipe, draw, focus }, p) {
      const t = pipe.process({}, 'raw');
      draw({
        texA: t.lin.tex, modeA: 3, encA: 1,
        texB: t.raw.tex, modeB: 2, encB: 1, mix: p.mosaic,
        zoom: zoomOf(p.lz), center: focus, wells: p.wells, grid: p.grid,
      });
    },
  },

  adc: {
    label: 'Sensor · Readout + ADC',
    params: { scan: 0, lz: 0, grid: 0.6 },
    build(tl, el, p) {
      tl.add(p, { scan: [0, 1], duration: 330, ease: 'linear' }, 0);
      tl.add(p, { lz: [0, 4.6], duration: 260, ease: 'inOutQuad' }, 360);
      tl.add($(el, '.adc'), { opacity: [0, 1], translateY: [20, 0], duration: 140, ease: 'outCubic' }, 620);
      revealSteps(tl, el, [0, 350, 640]);
      end(tl);
    },
    setup(el) {
      const grid = $(el, '#adc-grid');
      grid.innerHTML = Array.from({ length: 36 }, () => '<span></span>').join('');
    },
    render({ pipe, draw, focus, el, readEvery }, p) {
      const t = pipe.process({}, 'raw');
      draw({ texA: t.raw.tex, modeA: 2, encA: 1, scan: p.scan, zoom: zoomOf(p.lz), center: focus, grid: p.grid });
      if (p.lz < 3) return;
      readEvery(4, () => {
        const cx = Math.floor(focus[0] * pipe.w) - 3, cy = Math.floor(focus[1] * pipe.h) - 3;
        const v = pipe.read(t.raw, cx, cy, 6, 6);
        const cells = $$(el, '#adc-grid span');
        for (let row = 0; row < 6; row++) {
          const y = 5 - row; // top row on screen is the highest y
          for (let x = 0; x < 6; x++) {
            const cell = cells[row * 6 + x];
            cell.textContent = Math.round(v[(y * 6 + x) * 4] * 1023);
            cell.className = bayer(cx + x, cy + y);
          }
        }
        const centre = Math.round(v[(3 * 6 + 3) * 4] * 1023);
        setText($(el, '#adc-val'), String(centre));
        setText($(el, '#adc-bin'), centre.toString(2).padStart(10, '0'));
      });
    },
  },

  mipi: {
    label: 'Transfer · MIPI CSI-2',
    params: { scan: 0 },
    setup(el) {
      const ns = 'http://www.w3.org/2000/svg';
      const laneY = [99, 133, 167, 201];
      const packets = $(el, '#packets');
      for (let j = 0; j < 4; j++) {
        for (let lane = 0; lane < 4; lane++) {
          const g = document.createElementNS(ns, 'g');
          g.setAttribute('class', 'pkt');
          g.dataset.lane = lane;
          g.dataset.seq = j;
          g.innerHTML = `<rect x="0" y="${laneY[lane] - 8}" width="74" height="16" rx="3"/><text x="37" y="${laneY[lane] + 3.5}" text-anchor="middle">····</text>`;
          g.style.opacity = 0;
          packets.appendChild(g);
        }
      }
      const msgs = $(el, '#i2c-msgs');
      ['EXP 1/120s', 'GAIN 2.0×', 'FPS 30'].forEach((m) => {
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'msg');
        g.innerHTML = `<rect x="0" y="254" width="76" height="16" rx="3"/><text x="38" y="265.5" text-anchor="middle">${m}</text>`;
        g.style.opacity = 0;
        msgs.appendChild(g);
      });
    },
    build(tl, el, p) {
      for (const g of $$(el, '.pkt')) {
        const at = 30 + Number(g.dataset.seq) * 150 + Number(g.dataset.lane) * 22;
        tl.add(g, { translateX: [130, 436], duration: 200, ease: 'linear' }, at);
        tl.add(g, { opacity: [0, 1], duration: 20 }, at);
        tl.add(g, { opacity: [1, 0], duration: 20 }, at + 180);
      }
      tl.add(p, { scan: [0, 1], duration: 780, ease: 'linear' }, 30);
      tl.add($$(el, '.pk'), { opacity: [0, 1], translateY: [8, 0], duration: 60, delay: stagger(18) }, 290);
      $$(el, '.msg').forEach((g, i) => {
        const at = 540 + i * 90;
        tl.add(g, { translateX: [434, 130], duration: 200, ease: 'linear' }, at);
        tl.add(g, { opacity: [0, 1], duration: 20 }, at);
        tl.add(g, { opacity: [1, 0], duration: 20 }, at + 180);
      });
      revealSteps(tl, el, [0, 290, 540, 800]);
      end(tl);
    },
    render({ pipe, draw, el, readEvery }, p) {
      const t = pipe.process({}, 'raw');
      draw({ texA: t.raw.tex, modeA: 2, encA: 1, scan: p.scan, radius: 12 });
      readEvery(6, () => {
        // Read the row currently being "sent" and pack its first pixels as RAW10.
        const row = Math.max(0, Math.min(pipe.h - 1, Math.floor((1 - p.scan) * pipe.h)));
        const v = pipe.read(t.raw, 0, row, 16, 1);
        const px = Array.from({ length: 16 }, (_, i) => Math.round(v[i * 4] * 1023));
        const bytes = [];
        for (let i = 0; i < 8; i += 4) {
          const q = px.slice(i, i + 4);
          bytes.push(...q.map((n) => n >> 2), q.reduce((acc, n, k) => acc | ((n & 3) << (k * 2)), 0));
        }
        const hex = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'));
        setText($(el, '#pk-data'), hex.join(' ') + ' …');
        setText($(el, '#pk-wc'), `${(pipe.w * 10) / 8} B`);
        $$(el, '.pkt text').forEach((tx, i) => setText(tx, `${hex[(i * 2) % 10]} ${hex[(i * 2 + 1) % 10]} ${hex[(i * 2 + 2) % 10]}`));
      });
    },
  },

  clean: {
    label: 'ISP · Clean-up',
    params: { black: 0, shading: 0, defect: 0, denoise: 0, lz: 0 },
    build(tl, el, p) {
      tl.add(p, { black: [0, 1], duration: 170 }, 60);
      tl.add(p, { shading: [0, 1], duration: 170 }, 310);
      tl.add(p, { lz: [0, 1.4], duration: 140 }, 540);
      tl.add(p, { defect: [0, 1], duration: 100 }, 620);
      tl.add(p, { denoise: [0, 1], duration: 150 }, 820);
      revealSteps(tl, el, [0, 270, 540, 780]);
      end(tl);
    },
    render({ pipe, draw, focus, el }, p) {
      const t = pipe.process({ noise: 3.4, black: p.black, shading: p.shading, defect: p.defect, denoise: p.denoise }, 'clean');
      const on = [p.black, p.shading, p.defect, p.denoise];
      $$(el, '[data-chip]').forEach((c, i) => c.classList.toggle('is-on', on[i] > 0.5));
      draw({ texA: t.clean.tex, modeA: 1, encA: 1, zoom: zoomOf(p.lz), center: focus });
    },
  },

  demosaic: {
    label: 'ISP · Demosaic',
    params: { lz: 0, mix: 0, grid: 0.6 },
    build(tl, el, p) {
      tl.add(p, { lz: [0, 3.8], duration: 290, ease: 'inOutQuad' }, 10);
      tl.add(p, { mix: [0, 1], duration: 230 }, 330);
      tl.add(p, { lz: [3.8, 0], duration: 300, ease: 'inOutQuad' }, 620);
      revealSteps(tl, el, [0, 330, 640]);
      end(tl);
    },
    render({ pipe, draw, focus }, p) {
      const t = pipe.process({}, 'demosaic');
      draw({
        texA: t.clean.tex, modeA: 2, encA: 1,
        texB: t.demosaic.tex, modeB: 0, encB: 1, mix: p.mix,
        zoom: zoomOf(p.lz), center: focus, grid: p.grid,
      });
    },
  },

  color: {
    label: 'ISP · Colour',
    params: { wb: 0, ccm: 0, tone: 0, sharp: 0, lz: 0 },
    build(tl, el, p) {
      tl.add(p, { wb: [0, 1], duration: 220 }, 30);
      tl.add(p, { ccm: [0, 1], duration: 220 }, 290);
      tl.add(p, { tone: [0, 1], duration: 220 }, 530);
      tl.add(p, { lz: [0, 1.6], duration: 140 }, 760);
      tl.add(p, { sharp: [0, 1], duration: 160 }, 800);
      revealSteps(tl, el, [0, 270, 510, 750]);
      end(tl);
    },
    render({ pipe, draw, focus, el }, p) {
      const t = pipe.process({ wb: p.wb, ccm: p.ccm, tone: p.tone, sharp: p.sharp * 1.2 });
      draw({ texA: t.final.tex, zoom: zoomOf(p.lz), center: focus });
      setText($(el, '#wb-r'), `R ×${(1 + (1 / 0.52 - 1) * p.wb).toFixed(2)}`);
      setText($(el, '#wb-b'), `B ×${(1 + (1 / 0.66 - 1) * p.wb).toFixed(2)}`);
      let d = '';
      for (let i = 0; i <= 20; i++) {
        const x = i / 20;
        const y = x + (x * x * (3 - 2 * x) - x) * 0.45 * p.tone;
        d += `${i ? 'L' : 'M'}${(x * 100).toFixed(1)} ${(100 - y * 100).toFixed(1)}`;
      }
      $(el, '#tone-path').setAttribute('d', d);
    },
  },

  stack: {
    label: 'Computational · Multi-frame',
    params: { dim: 0, n: 1, wipe: 0 },
    build(tl, el, p) {
      tl.add(p, { dim: [0, 1], duration: 240 }, 20);
      tl.add($(el, '.wipe-labels'), { opacity: [0, 1], duration: 80 }, 300);
      tl.add(p, { wipe: [0, 0.5], duration: 200, ease: 'outCubic' }, 300);
      tl.add(p, { n: [1, 16], duration: 300, ease: 'inQuad' }, 320);
      revealSteps(tl, el, [0, 300, 640]);
      end(tl);
    },
    render({ pipe, draw, el }, p) {
      const n = Math.max(1, Math.round(p.n));
      const t = pipe.process({
        exposure: 0.9 - 0.75 * p.dim, gain: 1 + 4 * p.dim, noise: 2.2 + 1.2 * p.dim,
        denoise: 1 - 0.7 * p.dim, stack: n,
      });
      setText($(el, '#stack-n'), String(n));
      draw({ texA: t.final.tex, texB: t.stacked.tex, wipe: p.wipe > 0.001 ? p.wipe : -1 });
    },
  },

  jpeg: {
    label: 'Encoding · JPEG',
    params: { planes: 0, sub: 0, coef: 0, q: 92, lz: 0, blocks: 0 },
    build(tl, el, p) {
      tl.add(p, { planes: [0, 1], duration: 160 }, 30);
      tl.add(p, { sub: [0, 1], duration: 40 }, 300);
      tl.add(p, { planes: [1, 0], duration: 120 }, 420);
      tl.add(p, { lz: [0, 2.6], blocks: [0, 1], duration: 140 }, 450);
      tl.add(p, { coef: [0, 1], duration: 80 }, 480);
      tl.add(p, { coef: [1, 0], duration: 60 }, 600);
      tl.add(p, { q: [92, 6], duration: 180, ease: 'inQuad' }, 620);
      tl.add(p, { lz: [2.6, 0], blocks: [1, 0], q: [6, 80], duration: 120 }, 830);
      tl.add($(el, '#exif'), { opacity: [0, 1], duration: 60 }, 850);
      tl.add($(el, '.storage'), { opacity: [0, 1], duration: 60 }, 880);
      tl.add($(el, '#storage-file'), { translateX: [-60, 0], duration: 100, ease: 'outBack' }, 890);
      revealSteps(tl, el, [0, 230, 440, 600, 830]);
      end(tl);
    },
    render({ pipe, draw, focus, el, encodeJpeg }, p) {
      const q = Math.round(p.q);
      const t = pipe.process({ jpeg: true, quality: q, subsample: p.sub > 0.5 ? 1 : 0 }, 'jpeg');
      const shown = pipe.float ? t.jpeg : t.final;
      draw({
        texA: shown.tex, texB: pipe.float ? t.coef.tex : shown.tex, modeB: 4, mix: pipe.float ? p.coef : 0,
        planes: p.planes, zoom: zoomOf(p.lz), center: focus, grid: p.blocks, gridStep: 8,
      });
      setText($(el, '#jpeg-q'), String(q));
      setText($(el, '#raw-size'), formatBytes((pipe.w * pipe.h * 10) / 8));
      encodeJpeg(t.final, q, (bytes) => setText($(el, '#jpeg-size'), formatBytes(bytes)));
      const now = new Date();
      const stamp = `${now.getFullYear()}:${String(now.getMonth() + 1).padStart(2, '0')}:${String(now.getDate()).padStart(2, '0')} ${now.toTimeString().slice(0, 8)}`;
      setText($(el, '#exif'), `EXIF · DateTime ${stamp} · ${pipe.w}×${pipe.h} · ColorSpace sRGB`);
    },
  },

  display: {
    label: 'Display · Gallery',
    params: { lz: 0, subpix: 0 },
    build(tl, el, p) {
      tl.add(p, { lz: [0, 5], duration: 360, ease: 'inQuad' }, 560);
      tl.add(p, { subpix: [0, 1], duration: 120 }, 640);
      revealSteps(tl, el, [0, 300, 620]);
      end(tl);
    },
    render({ pipe, draw, focus }, p) {
      const t = pipe.process({});
      draw({ texA: t.final.tex, zoom: zoomOf(p.lz), center: focus, subpix: p.subpix, radius: 6 });
    },
  },
};

function formatBytes(n) {
  return n > 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${Math.round(n / 1000)} KB`;
}

export function buildScenes() {
  const list = [];
  for (const el of document.querySelectorAll('.scene')) {
    const def = scenes[el.dataset.scene];
    if (!def) continue;
    const params = { ...def.params };
    def.setup?.(el);
    const tl = timeline();
    def.build(tl, el, params);
    tl.seek(0);
    list.push({ el, def, params, slot: el.querySelector('[data-slot]'), tl, progress: 0 });
  }
  return list;
}

// Progress of a pinned section: 0 when its top reaches the top of the viewport,
// 1 when its bottom reaches the bottom.
export function scrollProgress(el) {
  const r = el.getBoundingClientRect();
  const span = r.height - innerHeight;
  return span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : r.top < 0 ? 1 : 0;
}

// Ease each timeline towards its scroll position. Frame-rate independent, so it stays
// smooth on 120 Hz screens and still lands on time on slow devices.
export function driveScenes(list, dt) {
  const k = CATCH_UP === Infinity ? 1 : 1 - Math.exp(-CATCH_UP * dt);
  for (const s of list) {
    const target = scrollProgress(s.el);
    const diff = target - s.progress;
    if (Math.abs(diff) < 1e-5) continue;
    s.progress = Math.abs(diff) < 5e-4 ? target : s.progress + diff * k;
    s.tl.seek(s.progress * s.tl.duration);
  }
}
