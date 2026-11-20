// Runs every 5 minutes. Unpins posts whose 24 hours are up.

import { build } from '../lib/app.js';

export default async function handler(req, res) {
  let app;
  try {
    app = build();
  } catch (err) {
    return res.status(500).send('not configured');
  }
  const secret = app.s.cronSecret;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).send('no');
  }
  const result = await app.crier.runCron();
  return res.status(200).json(result);
}
