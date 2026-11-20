// Open this page once after the settings are saved:
//   https://YOUR-ADDRESS/api/setup?key=YOUR_SETUP_KEY
// It creates the tables and connects The Crier to Telegram.

import { build, settings } from '../lib/app.js';

export default async function handler(req, res) {
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  const s = settings();
  if (!s.setupKey || req.query?.key !== s.setupKey) return res.status(401).send('Wrong key.');
  if (s.missing.length) return res.status(500).send(`Missing settings: ${s.missing.join(', ')}`);

  const lines = [];
  try {
    const app = build();
    await app.store.init();
    lines.push('1. Database tables: ready.');

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = `https://${host}/api/telegram`;
    await app.tg.call('setWebhook', {
      url,
      secret_token: s.webhookSecret,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: true,
    });
    lines.push(`2. Telegram connection: ready (${url}).`);

    const me = await app.tg.call('getMe');
    await app.store.setSetting('bot_username', me.username);
    lines.push(`3. Bot: ${me.first_name} (@${me.username}).`);
    lines.push(`4. Approved X accounts: ${s.approved.map((h) => '@' + h).join(', ')}.`);
    lines.push(`5. Owner: ${s.owners.map((h) => '@' + h).join(', ')}.`);
    lines.push(`6. Unpin timer: ${s.cronSecret ? 'ready.' : 'NOT READY - the CRON_SECRET setting is missing.'}`);
    lines.push(`7. Generate reply: ${s.aiKey ? `ready (AI model ${s.aiModel}).` : 'OFF - the ANTHROPIC_API_KEY setting is missing. Everything else works.'}`);
    lines.push('', 'The Crier is set up.');
    return res.status(200).send(lines.join('\n'));
  } catch (err) {
    lines.push('', `STOPPED: ${err.message}`);
    return res.status(500).send(lines.join('\n'));
  }
}
