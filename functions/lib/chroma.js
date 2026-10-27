'use strict';

const sharp = require('sharp');

/**
 * Removes a solid green backdrop and returns a tightly cropped transparent PNG.
 * Green spill on the garment's edges is pulled back toward neutral.
 */
async function chromaKeyToPng(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = width * height;
  const out = Buffer.alloc(px * 4);

  for (let i = 0; i < px; i++) {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    // How much greener than the other channels this pixel is.
    const spill = g - Math.max(r, b);
    let a;
    if (spill > 90) a = 0;
    else if (spill > 25) a = Math.round(255 * (1 - (spill - 25) / 65));
    else a = 255;
    // Despill: never let green exceed the stronger of red and blue.
    const g2 = spill > 0 ? Math.max(r, b) : g;
    out[o] = r; out[o + 1] = g2; out[o + 2] = b; out[o + 3] = a;
  }

  return sharp(out, { raw: { width, height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = { chromaKeyToPng };
