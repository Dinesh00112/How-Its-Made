// The picture fed into the pipeline: the visitor's camera, or a generated sample scene.

function drawSample(canvas, t) {
  const w = (canvas.width = 960);
  const h = (canvas.height = 720);
  const g = canvas.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#2d6fd6');
  sky.addColorStop(1, '#f3c99a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  const sx = w * 0.72 + Math.sin(t * 0.4) * 30;
  const sun = g.createRadialGradient(sx, 150, 10, sx, 150, 140);
  sun.addColorStop(0, 'rgba(255,248,220,1)');
  sun.addColorStop(0.35, 'rgba(255,214,140,0.9)');
  sun.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);

  g.fillStyle = '#3c5a3f';
  g.beginPath();
  g.moveTo(0, h * 0.6);
  for (let x = 0; x <= w; x += 20) g.lineTo(x, h * 0.55 - Math.sin(x * 0.008) * 60 - Math.sin(x * 0.021) * 25);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.fill();
  g.fillStyle = '#26402c';
  g.fillRect(0, h * 0.62, w, h);

  // A colour checker: the chart camera engineers tune white balance and colour against.
  const patches = [
    '#735244', '#c29682', '#627a9d', '#576c43', '#8580b1', '#67bdaa',
    '#d67e2c', '#505ba6', '#c15a63', '#5e3c6c', '#9dbc40', '#e0a32e',
    '#383d96', '#469449', '#af363c', '#e7c71f', '#bb5695', '#0885a1',
    '#f3f3f2', '#c8c8c8', '#a0a0a0', '#7a7a79', '#555555', '#343434',
  ];
  const cw = 58, gap = 8, ox = 70, oy = h * 0.64;
  g.fillStyle = '#111';
  g.fillRect(ox - 14, oy - 14, 6 * (cw + gap) + 20, 4 * (cw + gap) + 20);
  patches.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(ox + (i % 6) * (cw + gap), oy + Math.floor(i / 6) * (cw + gap), cw, cw);
  });

  // Fine stripes show off demosaicing, sharpening and JPEG artefacts.
  const bx = w - 330, by = h * 0.66;
  g.fillStyle = '#f2efe8';
  g.fillRect(bx, by, 260, 200);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = '#1a1a1a';
    g.fillRect(bx + 10 + i * 9.5, by + 10, 4 + (i % 3), 110);
  }
  g.fillStyle = '#1a1a1a';
  g.font = 'bold 28px system-ui, sans-serif';
  g.fillText('HOW IT’S MADE', bx + 10, by + 170);
}

export class Source {
  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.sample = document.createElement('canvas');
    drawSample(this.sample, 0);
    this.kind = 'sample';
    this.stream = null;
    this.frozen = false;
  }

  get element() {
    return this.kind === 'camera' ? this.video : this.sample;
  }

  get mirror() {
    return this.kind === 'camera' && this.facing === 'user';
  }

  get size() {
    if (this.kind === 'camera' && this.video.videoWidth) {
      return [this.video.videoWidth, this.video.videoHeight];
    }
    return [this.sample.width, this.sample.height];
  }

  get ready() {
    return this.kind === 'sample' || this.video.readyState >= 2;
  }

  tick(time) {
    if (this.kind === 'sample' && !this.frozen) drawSample(this.sample, time);
  }

  async startCamera(facing = 'user') {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API not available (the page must be served over HTTPS).');
    this.stopCamera();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.facing = facing;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.kind = 'camera';
  }

  stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.kind = 'sample';
  }

  setFrozen(frozen) {
    this.frozen = frozen;
    if (this.kind === 'camera') frozen ? this.video.pause() : this.video.play();
  }
}
