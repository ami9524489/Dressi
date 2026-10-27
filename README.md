# Dressi

A Hebrew digital wardrobe with an AI stylist and a virtual try-on stage.

## Layout
- `public/` – the app (single-file PWA, Hebrew RTL), served by Firebase Hosting.
- `functions/` – server functions (Node 20). `processGarment` turns a phone photo into a clean transparent cut-out and tags it.
- `firestore.rules`, `storage.rules` – every user can only reach their own data.
- `.github/workflows/deploy.yml` – every push to `main` deploys to Firebase project `dressi-5f536`.

## Secrets (GitHub → Settings → Secrets and variables → Actions)
- `FIREBASE_SERVICE_ACCOUNT` – JSON key of the deploy service account.
- `GEMINI_API_KEY` – copied into Firebase Secret Manager on each deploy; never shipped to the browser.

## Local check
`cd functions && npm install && node test/local.js <garment.png>` keys a garment off a green backdrop.
