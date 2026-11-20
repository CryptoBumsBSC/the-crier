// Telegram sends every event here.

import { build } from '../lib/app.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only');
  let app;
  try {
    app = build();
  } catch (err) {
    console.error(err.message);
    return res.status(500).send('not configured');
  }
  if (req.headers['x-telegram-bot-api-secret-token'] !== app.s.webhookSecret) {
    return res.status(401).send('no');
  }
  try {
    const result = await app.crier.handleUpdate(req.body || {});
    console.log(`update ${req.body?.update_id}: ${result}`);
  } catch (err) {
    // Always answer 200 so Telegram does not resend the same event forever.
    console.error(`update ${req.body?.update_id} failed: ${err.message}`);
  }
  return res.status(200).json({ ok: true });
}
