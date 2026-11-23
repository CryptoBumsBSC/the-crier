// Open this page once after the settings are saved:
//   https://YOUR-ADDRESS/api/setup?key=YOUR_SETUP_KEY
// It creates the tables and connects The Crier to Telegram.

import { build, settings } from '../lib/app.js';
import { createAi } from '../lib/ai.js';
import { finishReply, parseAnswer } from '../lib/reply.js';
import facts from '../project-facts.js';
import replySettings from '../crier-settings.js';

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
    if (!s.aiKey) {
      lines.push('7. Generate reply: OFF - the ANTHROPIC_API_KEY setting is missing. Everything else works.');
    } else {
      // Ask the AI for one sample reply, so a wrong key or model name shows up here and not in front of members.
      try {
        const ai = createAi({ apiKey: s.aiKey, model: s.aiModel, base: process.env.ANTHROPIC_API_BASE || undefined });
        const pool = [...replySettings.extraTags, ...replySettings.approvedMentions];
        const raw = await ai.ask({
          facts,
          tweetText: 'Something is stirring at the Gateway tonight.',
          line: 'What do you think is coming through?',
          used: [],
          length: 'one short sentence',
          angle: 'ask the project a genuine, curious question about what the tweet shows or says',
          pool,
        });
        const sample = finishReply(parseAnswer(raw.text), { alwaysTag: replySettings.alwaysTag, pool, extraMax: 0, inline: true });
        lines.push(
          sample
            ? `7. Generate reply: ready (AI model ${s.aiModel}). Sample reply: ${sample}`
            : `7. Generate reply: NOT READY - the AI answered, but not in a form The Crier could use. [stop: ${raw.stopReason}; parts: ${raw.kinds.join(',')}; text: ${raw.text.slice(0, 300)}]`,
        );
      } catch (err) {
        lines.push(`7. Generate reply: NOT READY - ${err.message}`);
      }
    }
    lines.push('', 'The Crier is set up.');
    return res.status(200).send(lines.join('\n'));
  } catch (err) {
    lines.push('', `STOPPED: ${err.message}`);
    return res.status(500).send(lines.join('\n'));
  }
}
