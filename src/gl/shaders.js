// Fragment shaders for the simulated camera pipeline.
// Every pass runs at the processing resolution and addresses pixels with texelFetch,
// so the Bayer pattern (RGGB, origin at the bottom-left texel) lines up across passes.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
`;

const COMMON = `
const float BL = 64.0 / 1023.0;              // sensor black level (10-bit)
const vec3 SENSOR = vec3(0.52, 1.0, 0.66);   // relative R/G/B sensitivity of the silicon + filters
const float CROSSTALK = 0.72;                // colour filters overlap, so raw colour is washed out
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Roughly unit-variance gaussian noise from four uniforms.
float gauss(vec2 p, float seed) {
  float s = hash(p + seed) + hash(p + seed * 1.7 + 11.3) + hash(p + seed * 2.3 + 27.1) + hash(p + seed * 3.1 + 41.9);
  return (s - 2.0) * 1.732;
}
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// 0 = red, 1 = green, 2 = blue for an RGGB mosaic.
int bayer(ivec2 p) {
  int x = p.x & 1, y = p.y & 1;
  return (x == 0 && y == 0) ? 0 : (x == 1 && y == 1) ? 2 : 1;
}
vec3 bayerTint(int ch) {
  return ch == 0 ? vec3(1.0, 0.12, 0.1) : ch == 1 ? vec3(0.15, 1.0, 0.25) : vec3(0.15, 0.35, 1.0);
}
// Lens shading: light falls off towards the corners (cos^4 law, roughly).
float shading(vec2 uv, vec2 size) {
  float aspect = size.x / size.y;
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  d /= length(vec2(aspect, 1.0)) * 0.5;
  return 1.0 - 0.55 * dot(d, d);
}
`;

// Camera frame (already processed by the device) -> linear light.
export const SRC = HEAD + COMMON + `
uniform sampler2D u_src;
uniform float u_mirror;
void main() {
  vec2 uv = v_uv;
  if (u_mirror > 0.5) uv.x = 1.0 - uv.x;
  o = vec4(toLinear(texture(u_src, uv).rgb), 1.0);
}`;

// Linear light -> what the sensor records: one colour per photosite, shading, noise,
// black level, a few hot pixels, quantised to 10 bits.
export const RAW = HEAD + COMMON + `
uniform sampler2D u_lin;
uniform vec2 u_size;
uniform float u_time;
uniform float u_exposure;
uniform float u_noise;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 lin = texelFetch(u_lin, p, 0).rgb;
  float l = dot(lin, LUMA);
  vec3 s = (l + (lin - l) * CROSSTALK) * SENSOR;
  int ch = bayer(p);
  float v = ch == 0 ? s.r : ch == 1 ? s.g : s.b;
  v *= u_exposure * shading((vec2(p) + 0.5) / u_size, u_size);

  // Photon shot noise and read noise, in electrons (full well = 6000 e-).
  float e = max(v, 0.0) * 6000.0;
  float seed = fract(u_time * 0.618) * 97.0;
  e += u_noise * (sqrt(e) * gauss(vec2(p), seed) + 4.0 * gauss(vec2(p).yx, seed + 5.0));
  v = BL + (e / 6000.0) * (1.0 - BL);

  // Hot / stuck pixels are fixed defects of a given sensor.
  if (hash(vec2(p) * 1.37 + 0.5) > 0.9993) v = 0.85 + 0.15 * hash(vec2(p.yx));

  v = clamp(floor(v * 1023.0 + 0.5) / 1023.0, 0.0, 1.0);
  o = vec4(v, v, v, 1.0);
}`;

const SAME_COLOUR = `
uniform vec2 u_size;
// Clamp a neighbour to the image while keeping it on the same colour of the mosaic.
ivec2 clampSame(ivec2 q) {
  ivec2 m = ivec2(u_size) - 1;
  if (q.x < 0) q.x += 2 * ((1 - q.x) / 2);
  if (q.y < 0) q.y += 2 * ((1 - q.y) / 2);
  if (q.x > m.x) q.x -= 2 * ((q.x - m.x + 1) / 2);
  if (q.y > m.y) q.y -= 2 * ((q.y - m.y + 1) / 2);
  return q;
}
`;

// ISP front end: black level, lens shading correction, defect pixel correction, denoise.
export const CLEAN = HEAD + COMMON + SAME_COLOUR + `
uniform sampler2D u_raw;
uniform float u_black;
uniform float u_shading;
uniform float u_defect;
uniform float u_denoise;
float corr(ivec2 q) {
  q = clampSame(q);
  float v = texelFetch(u_raw, q, 0).r;
  float bl = u_black * BL;
  v = (v - bl) / (1.0 - bl);
  return v / mix(1.0, shading((vec2(q) + 0.5) / u_size, u_size), u_shading);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float c = corr(p);
  float n[8];
  n[0] = corr(p + ivec2(2, 0));  n[1] = corr(p + ivec2(-2, 0));
  n[2] = corr(p + ivec2(0, 2));  n[3] = corr(p + ivec2(0, -2));
  n[4] = corr(p + ivec2(2, 2));  n[5] = corr(p + ivec2(-2, -2));
  n[6] = corr(p + ivec2(2, -2)); n[7] = corr(p + ivec2(-2, 2));
  float mx = n[0], sum = 0.0;
  for (int i = 0; i < 8; i++) { mx = max(mx, n[i]); sum += n[i]; }
  float avg = sum / 8.0;

  // A pixel far brighter than all its same-colour neighbours is a defect.
  float defect = step(mx * 1.3 + 0.05, c);
  c = mix(c, avg, defect * u_defect);

  // Edge-preserving (bilateral) average of same-colour neighbours.
  float sigma = 0.012 + 0.05 * sqrt(max(c, 0.0));
  float wsum = 1.0, acc = c;
  for (int i = 0; i < 8; i++) {
    float d = n[i] - c;
    float w = exp(-d * d / (2.0 * sigma * sigma));
    acc += n[i] * w;
    wsum += w;
  }
  c = mix(c, acc / wsum, u_denoise);
  o = vec4(c, c, c, 1.0);
}`;

// Bilinear demosaic: fill in the two missing colours at every photosite from its neighbours.
export const DEMOSAIC = HEAD + COMMON + SAME_COLOUR + `
uniform sampler2D u_in;
float f(ivec2 q) {
  ivec2 m = ivec2(u_size) - 1;
  return texelFetch(u_in, clamp(q, ivec2(0), m), 0).r;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float c = f(p);
  float orth = (f(p + ivec2(1, 0)) + f(p + ivec2(-1, 0)) + f(p + ivec2(0, 1)) + f(p + ivec2(0, -1))) * 0.25;
  float diag = (f(p + ivec2(1, 1)) + f(p + ivec2(-1, -1)) + f(p + ivec2(1, -1)) + f(p + ivec2(-1, 1))) * 0.25;
  float hor = (f(p + ivec2(1, 0)) + f(p + ivec2(-1, 0))) * 0.5;
  float ver = (f(p + ivec2(0, 1)) + f(p + ivec2(0, -1))) * 0.5;
  int x = p.x & 1, y = p.y & 1;
  vec3 rgb;
  if (x == 0 && y == 0) rgb = vec3(c, orth, diag);        // red site
  else if (x == 1 && y == 1) rgb = vec3(diag, orth, c);   // blue site
  else if (y == 0) rgb = vec3(hor, c, ver);               // green in a red row
  else rgb = vec3(ver, c, hor);                           // green in a blue row
  o = vec4(rgb, 1.0);
}`;

// Colour: digital gain, white balance, colour correction matrix, gamma + tone curve.
export const COLOR = HEAD + COMMON + `
uniform sampler2D u_in;
uniform float u_gain;
uniform float u_wb;
uniform float u_ccm;
uniform float u_tone;
void main() {
  vec3 c = texelFetch(u_in, ivec2(gl_FragCoord.xy), 0).rgb * u_gain;
  c *= mix(vec3(1.0), 1.0 / SENSOR, u_wb);
  float l = dot(c, LUMA);
  c = mix(c, l + (c - l) / CROSSTALK, u_ccm);
  vec3 e = toSRGB(max(c, 0.0));
  e = mix(e, e * e * (3.0 - 2.0 * e), 0.45 * u_tone);
  o = vec4(e, 1.0);
}`;

// Unsharp mask.
export const SHARPEN = HEAD + `
uniform sampler2D u_in;
uniform vec2 u_size;
uniform float u_sharp;
vec3 f(ivec2 q) { return texelFetch(u_in, clamp(q, ivec2(0), ivec2(u_size) - 1), 0).rgb; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = f(p);
  vec3 blur = (f(p + ivec2(1, 0)) + f(p + ivec2(-1, 0)) + f(p + ivec2(0, 1)) + f(p + ivec2(0, -1))) * 0.125
            + (f(p + ivec2(1, 1)) + f(p + ivec2(-1, -1)) + f(p + ivec2(1, -1)) + f(p + ivec2(-1, 1))) * 0.0625
            + c * 0.25;
  o = vec4(clamp(c + u_sharp * 1.4 * (c - blur), 0.0, 1.0), 1.0);
}`;

// Running average of frames (multi-frame noise reduction).
export const STACK = HEAD + `
uniform sampler2D u_prev;
uniform sampler2D u_cur;
uniform float u_alpha;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  o = vec4(mix(texelFetch(u_prev, p, 0).rgb, texelFetch(u_cur, p, 0).rgb, u_alpha), 1.0);
}`;

const JPEG_COMMON = `
const float PI = 3.14159265;
uniform vec2 u_size;
float C(int k) { return k == 0 ? 0.70710678 : 1.0; }
`;

// Forward DCT of every 8x8 block of Y, Cb, Cr, quantised with JPEG tables.
// Each output texel holds coefficient (u, v) of its block.
export const DCT = HEAD + JPEG_COMMON + `
uniform sampler2D u_in;
uniform float u_ql[64];
uniform float u_qc[64];
uniform float u_sub;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 b = p - (p & 7);
  int u = p.x & 7, v = p.y & 7;
  ivec2 m = ivec2(u_size) - 1;
  vec3 F = vec3(0.0);
  for (int x = 0; x < 8; x++) {
    float cx = cos(float(2 * x + 1) * float(u) * PI / 16.0);
    for (int y = 0; y < 8; y++) {
      ivec2 q = clamp(b + ivec2(x, y), ivec2(0), m);
      vec3 rgb = texelFetch(u_in, q, 0).rgb * 255.0;
      // 4:2:0 subsampling: chroma comes from the average of each 2x2 group.
      vec3 rgbc = u_sub > 0.5 ? texture(u_in, (vec2(q - (q & 1)) + 1.0) / u_size).rgb * 255.0 : rgb;
      float Y = dot(rgb, vec3(0.299, 0.587, 0.114)) - 128.0;
      float Cb = dot(rgbc, vec3(-0.168736, -0.331264, 0.5));
      float Cr = dot(rgbc, vec3(0.5, -0.418688, -0.081312));
      float basis = cx * cos(float(2 * y + 1) * float(v) * PI / 16.0);
      F += vec3(Y, Cb, Cr) * basis;
    }
  }
  F *= 0.25 * C(u) * C(v);
  int i = v * 8 + u;
  vec3 Q = vec3(u_ql[i], u_qc[i], u_qc[i]);
  o = vec4(floor(F / Q + 0.5) * Q, 1.0);
}`;

// Inverse DCT back to RGB: what a viewer decodes from the JPEG.
export const IDCT = HEAD + JPEG_COMMON + `
uniform sampler2D u_coef;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 b = p - (p & 7);
  int x = p.x & 7, y = p.y & 7;
  ivec2 m = ivec2(u_size) - 1;
  vec3 f = vec3(0.0);
  for (int u = 0; u < 8; u++) {
    float cu = C(u) * cos(float(2 * x + 1) * float(u) * PI / 16.0);
    for (int v = 0; v < 8; v++) {
      vec3 F = texelFetch(u_coef, clamp(b + ivec2(u, v), ivec2(0), m), 0).rgb;
      f += F * cu * C(v) * cos(float(2 * y + 1) * float(v) * PI / 16.0);
    }
  }
  f *= 0.25;
  float Y = f.x + 128.0;
  vec3 rgb = vec3(Y + 1.402 * f.z, Y - 0.344136 * f.y - 0.714136 * f.z, Y + 1.772 * f.y);
  o = vec4(clamp(rgb / 255.0, 0.0, 1.0), 1.0);
}`;

export const COPY = HEAD + `
uniform sampler2D u_in;
void main() { o = vec4(texelFetch(u_in, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }`;

// Draws a stage of the pipeline into a slot on the page, with all the visual aids:
// zoom, pixel grid, microlens wells, rolling readout, subpixels, focus blur, IR cast, YCbCr planes.
export const DISPLAY = HEAD + COMMON + `
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform float u_modeA;     // 0 rgb, 1 raw grey, 2 raw mosaic, 3 luminance, 4 DCT coefficients
uniform float u_modeB;
uniform float u_encA;      // 1 = values are linear, encode for display
uniform float u_encB;
uniform float u_mix;
uniform float u_wipe;      // < 0 = off, else screen x of a before/after split
uniform vec2 u_size;
uniform vec2 u_slot;
uniform float u_radius;
uniform float u_zoom;
uniform vec2 u_center;
uniform vec2 u_shift;
uniform float u_grid;
uniform float u_gridStep;  // 1 = pixel grid, 8 = JPEG block grid
uniform float u_wells;
uniform float u_scan;      // < 0 = off, else fraction of rows read out
uniform float u_subpix;
uniform float u_blur;
uniform float u_ir;
uniform float u_planes;
uniform float u_bright;
uniform float u_fade;
uniform vec2 u_cover;     // crop so the image fills the slot without stretching

vec3 view(sampler2D tex, float mode, float enc, vec2 uv) {
  ivec2 t = ivec2(floor(clamp(uv, 0.0, 0.9999) * u_size));
  bool nearest = u_zoom > 2.0 || mode == 2.0 || mode == 4.0;
  vec3 c;
  if (u_blur > 0.001 && !nearest) {
    c = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996;
      float r = sqrt((float(i) + 0.5) / 16.0) * u_blur * 0.035;
      c += texture(tex, uv + vec2(cos(a), sin(a)) * r * vec2(u_size.y / u_size.x, 1.0)).rgb;
    }
    c /= 16.0;
  } else {
    c = nearest ? texelFetch(tex, t, 0).rgb : texture(tex, uv).rgb;
  }
  if (mode == 1.0) c = vec3(c.r);
  else if (mode == 2.0) c = c.r * bayerTint(bayer(t));
  else if (mode == 3.0) c = vec3(dot(c, LUMA));
  else if (mode == 4.0) c = vec3(log(1.0 + abs(c.r)) / log(1.0 + 600.0));
  if (enc > 0.5) c = toSRGB(c);
  return c;
}

vec3 planes(vec2 suv) {
  // Y, Cb, Cr side by side, each a third of the slot.
  float i = floor(suv.x * 3.0);
  vec2 uv = vec2(fract(suv.x * 3.0), (suv.y - 1.0 / 3.0) * 3.0);
  if (uv.y < 0.0 || uv.y > 1.0) return vec3(0.03);
  uv = (uv - 0.5) * 1.04 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.03);
  vec3 c = view(u_texA, 0.0, u_encA, uv);
  float Y = dot(c, vec3(0.299, 0.587, 0.114));
  float Cb = dot(c, vec3(-0.168736, -0.331264, 0.5));
  float Cr = dot(c, vec3(0.5, -0.418688, -0.081312));
  if (i < 0.5) return vec3(Y);
  if (i < 1.5) return clamp(vec3(0.5 - 0.344 * Cb, 0.5 - 0.344 * Cb, 0.5 + 1.772 * Cb) * 0.9 + 0.05, 0.0, 1.0);
  return clamp(vec3(0.5 + 1.402 * Cr, 0.5 - 0.714 * Cr, 0.5) * 0.9 + 0.05, 0.0, 1.0);
}

void main() {
  // Keep the zoomed window inside the image so it never shows empty borders.
  vec2 halfView = 0.5 * u_cover / u_zoom;
  vec2 center = clamp(u_center, min(halfView, vec2(0.5)), max(1.0 - halfView, vec2(0.5)));
  vec2 uv = center + (v_uv - 0.5) * u_cover / u_zoom + u_shift;
  vec3 col;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    col = vec3(0.02);
  } else {
    vec3 a = view(u_texA, u_modeA, u_encA, uv);
    vec3 b = u_mix > 0.001 || u_wipe >= 0.0 ? view(u_texB, u_modeB, u_encB, uv) : a;
    float m = u_wipe >= 0.0 ? 1.0 - step(u_wipe, v_uv.x) : u_mix;
    col = mix(a, b, m);

    vec2 px = uv * u_size;
    vec2 f = fract(px);
    float texelOnScreen = u_slot.x * u_zoom / (u_size.x * u_cover.x);
    float detail = smoothstep(4.0, 10.0, texelOnScreen);

    if (u_wells > 0.001) {
      float r = length(f - 0.5);
      float dome = smoothstep(0.5, 0.4, r);
      float spec = smoothstep(0.22, 0.0, length(f - vec2(0.36, 0.64)));
      vec3 w = col * dome * (0.55 + 0.9 * (0.5 - r)) + spec * 0.25 * dome;
      col = mix(col, w, u_wells * detail);
    }
    if (u_subpix > 0.001) {
      float s = floor(f.x * 3.0);
      float fx = fract(f.x * 3.0);
      float gap = smoothstep(0.0, 0.12, fx) * smoothstep(1.0, 0.88, fx) * smoothstep(0.0, 0.06, f.y) * smoothstep(1.0, 0.94, f.y);
      vec3 sp = (s < 0.5 ? vec3(col.r, 0.0, 0.0) : s < 1.5 ? vec3(0.0, col.g, 0.0) : vec3(0.0, 0.0, col.b)) * 1.6 * gap;
      col = mix(col, sp, u_subpix * detail);
    }
    float cell = texelOnScreen * u_gridStep;
    if (u_grid > 0.001 && cell > 6.0) {
      vec2 fg = fract(px / u_gridStep);
      vec2 d = min(fg, 1.0 - fg) * cell;
      float line = 1.0 - smoothstep(0.0, 1.2, min(d.x, d.y));
      col = mix(col, u_gridStep > 1.5 ? vec3(1.0, 0.5, 0.75) : vec3(0.0), line * u_grid * smoothstep(6.0, 14.0, cell));
    }
    if (u_scan >= 0.0) {
      float row = 1.0 - uv.y;
      float done = step(row, u_scan);
      col *= mix(0.07, 1.0, done);
      float glow = exp(-abs(row - u_scan) * 160.0) * step(u_scan, 0.999) * step(0.001, u_scan);
      col += vec3(0.35, 0.9, 1.0) * glow;
    }
    col = mix(col, col * vec3(1.18, 0.78, 1.12) + vec3(0.09, 0.0, 0.07), u_ir);
  }
  if (u_planes > 0.001) col = mix(col, planes(v_uv), u_planes);
  if (u_wipe >= 0.0) {
    float d = abs(v_uv.x - u_wipe) * u_slot.x;
    col = mix(col, vec3(1.0), 1.0 - smoothstep(0.5, 1.5, d));
  }
  col *= u_bright;

  // Rounded corners.
  vec2 q = abs(v_uv * u_slot - u_slot * 0.5) - (u_slot * 0.5 - u_radius);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
  float alpha = clamp(0.5 - sd, 0.0, 1.0);
  o = vec4(col * alpha, alpha) * u_fade;
}`;
