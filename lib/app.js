// Wires the real Telegram, the real database and the settings together.

import { createCrier } from './crier.js';
import { createTelegram, botIdFromToken } from './telegram.js';
import { createPgStore } from './store-pg.js';
import { lookupTweet } from './x.js';
import { createAi } from './ai.js';
import facts from '../project-facts.js';
import replySettings from '../crier-settings.js';

const list = (v, fallback) =>
  (v || fallback)
    .split(',')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean);

export function settings() {
  const missing = ['BOT_TOKEN', 'WEBHOOK_SECRET', 'SETUP_KEY'].filter((k) => !process.env[k]);
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) missing.push('DATABASE_URL');
  return {
    missing,
    token: process.env.BOT_TOKEN,
    databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    webhookSecret: process.env.WEBHOOK_SECRET,
    setupKey: process.env.SETUP_KEY,
    cronSecret: process.env.CRON_SECRET,
    aiKey: process.env.ANTHROPIC_API_KEY,
    aiModel: process.env.AI_MODEL || 'claude-haiku-5-5',
    approved: list(process.env.APPROVED_X_ACCOUNTS, 'TheRiftBorn,LegitFomoDaily,Boomer_Au'),
    owners: list(process.env.OWNER_USERNAMES, 'aussieboomer'),
  };
}

export function build() {
  const s = settings();
  if (s.missing.length) throw new Error(`Missing settings: ${s.missing.join(', ')}`);
  const tg = createTelegram(s.token, fetch, process.env.TELEGRAM_API_BASE || undefined);
  const store = createPgStore(s.databaseUrl);
  // No AI key saved = the "Generate reply" button stays hidden. Everything else works.
  const ai = s.aiKey
    ? createAi({ apiKey: s.aiKey, model: s.aiModel, base: process.env.ANTHROPIC_API_BASE || undefined })
    : null;
  const crier = createCrier({
    tg,
    store,
    lookupTweet,
    ai,
    log: (line) => console.log(line),
    config: {
      approved: s.approved,
      owners: s.owners,
      botId: botIdFromToken(s.token),
      pinHours: 24,
      facts,
      ...replySettings,
      getBotUsername: () => store.getSetting('bot_username'),
    },
  });
  return { s, tg, store, crier };
}
