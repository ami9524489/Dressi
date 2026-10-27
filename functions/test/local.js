'use strict';
// Local check of the chroma-key step: puts a real garment cut-out on a green
// backdrop (as the model is asked to return), keys it out, and checks the result.
const path = require('path');
const sharp = require('sharp');
const { chromaKeyToPng } = require('../lib/chroma');

(async () => {
  const garment = process.argv[2];
  const outFile = process.argv[3] || path.join(__dirname, 'out.png');
  const g = await sharp(garment).resize(800, 800, { fit: 'inside' }).png().toBuffer();
  const onGreen = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 0, g: 255, b: 0 } } })
    .composite([{ input: g, gravity: 'center' }]).jpeg({ quality: 90 }).toBuffer();
  const png = await chromaKeyToPng(onGreen);
  await sharp(png).toFile(outFile);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let transparent = 0, greenish = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) transparent++;
    else if (data[o + 1] > Math.max(data[o], data[o + 2]) + 30) greenish++;
  }
  console.log(JSON.stringify({ size: [info.width, info.height], transparentShare: +(transparent / (info.width * info.height)).toFixed(3), greenishVisiblePixels: greenish }));
})().catch((e) => { console.error(e); process.exit(1); });
