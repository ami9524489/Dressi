'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { chromaKeyToPng } = require('./lib/chroma');
const { geminiImage, geminiJson } = require('./lib/gemini');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// Daily limits per person. They keep one account from running up the bill.
const LIMITS = { garment: 40 };

const CATEGORIES = ['חולצות', 'מכנסיים', 'שמלות וחצאיות', 'שכבה עליונה', 'נעליים', 'אביזרים'];

const CLEAN_PROMPT = [
  'You are preparing a product photo for a digital wardrobe.',
  'Take the single main garment or shoe in this photo and output it as a clean catalog flat-lay, front view, centered,',
  'filling about 85% of the frame, on a perfectly flat solid pure green background (#00FF00), with no shadow on the background.',
  'Keep the exact garment: same color, fabric texture, cut, length, seams, stitching, buttons, prints and logos that are part of the design.',
  'Remove everything that is not the garment: hangers, hands, people, other clothes, price tags, hang tags, care labels, stickers, security tags and loose strings.',
  'Smooth out creases from the way it was lying, but do not change its shape or proportions. Do not add anything. Photorealistic.'
].join(' ');

const TAG_PROMPT = [
  'Describe this clothing item for a Hebrew wardrobe app. Reply with JSON only, no prose.',
  'Fields: name (short Hebrew name, 2-4 words, e.g. "חולצה אוברסייז שחורה"),',
  'category (exactly one of: ' + CATEGORIES.join(', ') + '),',
  'colors (array of 1-3 Hebrew color words), material (Hebrew, or empty string if unclear),',
  'season (one of: קיץ, חורף, מעבר, כל השנה), formality (one of: יומיומי, חצי אלגנטי, אלגנטי, ספורט),',
  'notes (one short Hebrew sentence on what it pairs well with).'
].join(' ');

async function bumpUsage(uid, kind) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = admin.firestore().doc(`users/${uid}/usage/${day}`);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = (snap.exists && snap.data()[kind]) || 0;
    if (used >= LIMITS[kind]) {
      throw new HttpsError('resource-exhausted', 'הגעת למכסה היומית. אפשר להמשיך מחר.');
    }
    tx.set(ref, { [kind]: used + 1 }, { merge: true });
  });
}

/**
 * Turns a raw phone photo of a garment into a clean transparent cut-out and fills in its details.
 * The client uploads users/{uid}/raw/{itemId}.jpg and creates the item document first.
 */
exports.processGarment = onCall(
  { secrets: [GEMINI_API_KEY], memory: '1GiB', timeoutSeconds: 120, enforceAppCheck: false },
  async (req) => {
    const uid = req.auth && req.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'צריך להתחבר קודם.');

    const itemId = String((req.data && req.data.itemId) || '');
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(itemId)) throw new HttpsError('invalid-argument', 'מזהה פריט לא תקין.');

    const db = admin.firestore();
    const itemRef = db.doc(`users/${uid}/items/${itemId}`);
    const item = await itemRef.get();
    if (!item.exists) throw new HttpsError('not-found', 'הפריט לא נמצא.');
    if (item.data().status === 'ready') return { ok: true };

    await bumpUsage(uid, 'garment');
    await itemRef.update({ status: 'processing' });

    const bucket = admin.storage().bucket();
    const rawPath = `users/${uid}/raw/${itemId}.jpg`;
    try {
      const [raw] = await bucket.file(rawPath).download();
      const key = GEMINI_API_KEY.value();

      const [cleanImg, tags] = await Promise.all([
        geminiImage(key, CLEAN_PROMPT, [{ mime: 'image/jpeg', data: raw }], { aspectRatio: '1:1', imageSize: '1K' }),
        geminiJson(key, TAG_PROMPT, [{ mime: 'image/jpeg', data: raw }]).catch((e) => {
          logger.warn('tagging failed', e.message);
          return {};
        })
      ]);

      const png = await chromaKeyToPng(cleanImg);
      const outPath = `users/${uid}/items/${itemId}.png`;
      await bucket.file(outPath).save(png, {
        contentType: 'image/png',
        metadata: { cacheControl: 'private, max-age=31536000' }
      });

      const category = CATEGORIES.includes(tags.category) ? tags.category : 'חולצות';
      await itemRef.update({
        status: 'ready',
        imagePath: outPath,
        name: String(tags.name || 'פריט חדש').slice(0, 40),
        category,
        colors: Array.isArray(tags.colors) ? tags.colors.slice(0, 3).map(String) : [],
        material: String(tags.material || '').slice(0, 30),
        season: String(tags.season || ''),
        formality: String(tags.formality || ''),
        notes: String(tags.notes || '').slice(0, 120),
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true };
    } catch (err) {
      logger.error('processGarment failed', { uid, itemId, msg: err.message });
      await itemRef.update({ status: 'failed' }).catch(() => {});
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'לא הצלחנו לעבד את התמונה. נסה לצלם שוב באור טוב.');
    }
  }
);

/** When a person deletes an item, its photos go with it. */
exports.cleanupItem = onDocumentDeleted('users/{uid}/items/{itemId}', async (event) => {
  const { uid, itemId } = event.params;
  const bucket = admin.storage().bucket();
  await Promise.all([
    bucket.file(`users/${uid}/raw/${itemId}.jpg`).delete({ ignoreNotFound: true }),
    bucket.file(`users/${uid}/items/${itemId}.png`).delete({ ignoreNotFound: true })
  ]);
});
