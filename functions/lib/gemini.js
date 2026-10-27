'use strict';

// Model names live here so switching models or providers touches one file.
const IMAGE_MODEL = process.env.DRESSI_IMAGE_MODEL || 'gemini-nano-banana-2.1';
const TEXT_MODEL = process.env.DRESSI_TEXT_MODEL || 'gemini-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

async function call(key, model, body) {
  const res = await fetch(`${BASE}${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `HTTP ${res.status}`;
    throw new Error(`Gemini ${model}: ${msg}`);
  }
  return json;
}

function parts(prompt, images) {
  return [
    { text: prompt },
    ...images.map((im) => ({ inline_data: { mime_type: im.mime, data: Buffer.from(im.data).toString('base64') } }))
  ];
}

/** Returns the first image the model sends back, as a Buffer. */
async function geminiImage(key, prompt, images, imageConfig) {
  const json = await call(key, IMAGE_MODEL, {
    contents: [{ role: 'user', parts: parts(prompt, images) }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig }
  });
  const out = (json.candidates || [])
    .flatMap((c) => (c.content && c.content.parts) || [])
    .find((p) => p.inlineData || p.inline_data);
  if (!out) {
    const reason = json.candidates && json.candidates[0] && json.candidates[0].finishReason;
    throw new Error(`Gemini returned no image (${reason || 'no candidates'})`);
  }
  return Buffer.from((out.inlineData || out.inline_data).data, 'base64');
}

/** Returns the model's JSON answer as an object. */
async function geminiJson(key, prompt, images) {
  const json = await call(key, TEXT_MODEL, {
    contents: [{ role: 'user', parts: parts(prompt, images) }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
  });
  const text = (json.candidates || [])
    .flatMap((c) => (c.content && c.content.parts) || [])
    .map((p) => p.text || '')
    .join('');
  return JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
}

module.exports = { geminiImage, geminiJson, IMAGE_MODEL, TEXT_MODEL };
