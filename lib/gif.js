// Encode PNG frame buffers into an animated GIF (sharp for decoding/resizing, gifenc for encoding).
const sharp = require('sharp');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

async function framesToGif(pngs, { width = 270, delay = 160, crossfade = 0 } = {}) {
  const raws = [];
  let w, h;
  for (const p of pngs) {
    const { data, info } = await sharp(p).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    w = info.width; h = info.height; raws.push(new Uint8Array(data));
  }
  let seq = raws;
  if (crossfade > 0 && raws.length > 1) { // blend frames for smoother slideshow-style GIFs
    seq = [];
    for (let i = 0; i < raws.length; i++) {
      const a = raws[i], b = raws[(i + 1) % raws.length];
      seq.push(a);
      for (let k = 1; k <= crossfade; k++) {
        const t = k / (crossfade + 1), m = new Uint8Array(a.length);
        for (let j = 0; j < a.length; j++) m[j] = a[j] * (1 - t) + b[j] * t;
        seq.push(m);
      }
    }
  }
  // Global palette from a sample of frames keeps colours stable (no flicker).
  const sample = new Uint8Array(w * h * 4 * Math.min(seq.length, 4));
  for (let i = 0; i < Math.min(seq.length, 4); i++) sample.set(seq[Math.floor((i * seq.length) / Math.min(seq.length, 4))], i * w * h * 4);
  const palette = quantize(sample, 256);
  const gif = GIFEncoder();
  for (const f of seq) gif.writeFrame(applyPalette(f, palette), w, h, { palette, delay });
  gif.finish();
  return Buffer.from(gif.bytes());
}

module.exports = { framesToGif };
