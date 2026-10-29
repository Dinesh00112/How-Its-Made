import { createContext, createProgram, createTexture, createTarget, deleteTarget, useProgram, draw } from './gl.js';
import * as S from './shaders.js';

const JPEG_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const JPEG_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

// IJG quality scaling, the same rule libjpeg uses.
export function quantTable(base, quality) {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  return new Float32Array(base.map((t) => Math.min(255, Math.max(1, Math.floor((t * scale + 50) / 100)))));
}

// Defaults for a fully processed photo; scenes override what they are explaining.
export const ISP_DEFAULTS = {
  exposure: 0.9, noise: 2.2,
  black: 1, shading: 1, defect: 1, denoise: 1,
  wb: 1, ccm: 1, tone: 1, gain: 1, sharp: 0.6,
  stack: 1, jpeg: false, quality: 92, subsample: 1,
};

export class Pipeline {
  constructor(canvas) {
    const ctx = createContext(canvas);
    if (!ctx) throw new Error('WebGL2 is not available');
    this.gl = ctx.gl;
    this.float = ctx.floatTargets;
    const gl = this.gl;
    this.p = {};
    for (const name of ['SRC', 'RAW', 'CLEAN', 'DEMOSAIC', 'COLOR', 'SHARPEN', 'STACK', 'COPY', 'DISPLAY']) {
      this.p[name] = createProgram(gl, S[name]);
    }
    if (this.float) {
      this.p.DCT = createProgram(gl, S.DCT);
      this.p.IDCT = createProgram(gl, S.IDCT);
    }
    this.srcTex = createTexture(gl);
    this.t = {};
    this.w = 0;
    this.h = 0;
    this.frame = 0;
    this.linFrame = -1;
    this.stackCount = 0;
    this.qCache = { quality: -1 };
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    for (const t of Object.values(this.t)) deleteTarget(gl, t);
    this.w = w;
    this.h = h;
    const mk = () => createTarget(gl, w, h, this.float);
    this.t = {
      lin: mk(), raw: mk(), clean: mk(), demosaic: mk(), color: mk(), sharp: mk(),
      stackA: mk(), stackB: mk(), coef: mk(), jpeg: mk(),
      capture: createTarget(gl, w, h, false),
    };
    this.stackCount = 0;
  }

  // Upload the newest camera (or sample) frame. Called once per animation frame.
  upload(source, mirror) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.mirror = mirror;
    this.frame++;
  }

  pass(name, target, uniforms) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.SCISSOR_TEST);
    useProgram(gl, this.p[name], { u_size: [this.w, this.h], ...uniforms });
    draw(gl);
  }

  // Run the pipeline up to `until` with the given ISP settings. Results stay in this.t
  // until the next call, so callers display right after processing.
  process(settings, until = 'sharp') {
    const s = { ...ISP_DEFAULTS, ...settings };
    const t = this.t;
    const order = ['raw', 'clean', 'demosaic', 'color', 'sharp', 'jpeg'];
    const stop = order.indexOf(until);
    if (this.linFrame !== this.frame) {
      this.pass('SRC', t.lin, { u_src: this.srcTex, u_mirror: this.mirror ? 1 : 0 });
      this.linFrame = this.frame;
    }
    this.pass('RAW', t.raw, { u_lin: t.lin.tex, u_time: this.frame * 0.013, u_exposure: s.exposure, u_noise: s.noise });
    if (stop < 1) return t;
    this.pass('CLEAN', t.clean, { u_raw: t.raw.tex, u_black: s.black, u_shading: s.shading, u_defect: s.defect, u_denoise: s.denoise });
    if (stop < 2) return t;
    this.pass('DEMOSAIC', t.demosaic, { u_in: t.clean.tex });
    if (stop < 3) return t;
    this.pass('COLOR', t.color, { u_in: t.demosaic.tex, u_gain: s.gain, u_wb: s.wb, u_ccm: s.ccm, u_tone: s.tone });
    if (stop < 4) return t;
    this.pass('SHARPEN', t.sharp, { u_in: t.color.tex, u_sharp: s.sharp });
    t.final = t.sharp;

    if (s.stack > 1.01) {
      // Average the last ~N frames. The first frame seeds the buffer.
      const alpha = this.stackCount === 0 ? 1 : 1 / s.stack;
      this.pass('STACK', t.stackB, { u_prev: t.stackA.tex, u_cur: t.sharp.tex, u_alpha: alpha });
      [t.stackA, t.stackB] = [t.stackB, t.stackA];
      this.stackCount++;
      t.stacked = t.stackA;
    } else {
      this.stackCount = 0;
      t.stacked = t.sharp;
    }

    if (stop >= 5 && this.float) {
      if (this.qCache.quality !== s.quality) {
        this.qCache = { quality: s.quality, l: quantTable(JPEG_LUMA, s.quality), c: quantTable(JPEG_CHROMA, s.quality) };
      }
      this.pass('DCT', t.coef, { u_in: t.sharp.tex, u_ql: this.qCache.l, u_qc: this.qCache.c, u_sub: s.subsample });
      this.pass('IDCT', t.jpeg, { u_coef: t.coef.tex });
    }
    return t;
  }

  // Draw a view into a rectangle of the page (CSS pixels, from getBoundingClientRect).
  display(rect, dpr, canvasHeight, v) {
    const gl = this.gl;
    const x = Math.round(rect.left * dpr);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    const y = Math.round(canvasHeight - rect.bottom * dpr);
    const slotAspect = w / h;
    const imgAspect = this.w / this.h;
    const cover = slotAspect > imgAspect ? [1, imgAspect / slotAspect] : [slotAspect / imgAspect, 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(x, y, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, w, h);
    useProgram(gl, this.p.DISPLAY, {
      u_texA: v.texA, u_texB: v.texB ?? v.texA,
      u_modeA: v.modeA ?? 0, u_modeB: v.modeB ?? 0,
      u_encA: v.encA ?? 0, u_encB: v.encB ?? 0,
      u_mix: v.mix ?? 0, u_wipe: v.wipe ?? -1,
      u_size: [this.w, this.h], u_slot: [w, h], u_radius: (v.radius ?? 18) * dpr,
      u_zoom: v.zoom ?? 1, u_center: v.center ?? [0.5, 0.5], u_shift: v.shift ?? [0, 0],
      u_grid: v.grid ?? 0, u_gridStep: v.gridStep ?? 1, u_wells: v.wells ?? 0, u_scan: v.scan ?? -1, u_subpix: v.subpix ?? 0,
      u_blur: v.blur ?? 0, u_ir: v.ir ?? 0, u_planes: v.planes ?? 0, u_bright: v.bright ?? 1, u_fade: v.fade ?? 1, u_cover: cover,
    });
    draw(gl);
  }

  // Read a block of texels (bottom-left origin) from a target as floats in 0..1.
  read(target, x, y, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    let out;
    if (target.float) {
      out = new Float32Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
    } else {
      const bytes = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      out = Float32Array.from(bytes, (b) => b / 255);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  // Copy the processed photo into a 2D canvas (top-left origin) for encoding or download.
  capture(source, canvas2d) {
    const gl = this.gl;
    const { w, h } = this;
    this.pass('COPY', this.t.capture, { u_in: source.tex });
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.t.capture.fbo);
    const px = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const img = new ImageData(w, h);
    const row = w * 4;
    for (let yy = 0; yy < h; yy++) img.data.set(px.subarray((h - 1 - yy) * row, (h - yy) * row), yy * row);
    canvas2d.width = w;
    canvas2d.height = h;
    canvas2d.getContext('2d').putImageData(img, 0, 0);
    return canvas2d;
  }
}
