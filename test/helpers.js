import { createCrier } from '../lib/crier.js';
import { createMemoryStore } from '../lib/store-memory.js';

export const BOT_ID = 999;
export const GROUP = -1001;
export const OWNER = { id: 1, username: 'AussieBoomer' };
export const ADMIN = { id: 2, username: 'someadmin' };
export const MEMBER = { id: 3, username: 'member' };

// A fake Telegram that records every call the bot makes.
export function fakeTelegram({ admins = [ADMIN.id], fail = {}, gone = [] } = {}) {
  const calls = [];
  let nextId = 5000;
  return {
    calls,
    of: (method) => calls.filter((c) => c.method === method).map((c) => c.params),
    async call(method, params) {
      calls.push({ method, params });
      if (fail[method]) {
        const err = new Error(`${method}: ${fail[method].description}`);
        err.code = fail[method].code;
        err.description = fail[method].description;
        throw err;
      }
      if (method === 'getChatMember') {
        if ((gone || []).includes(params.user_id)) return { status: 'left' };
        return { status: admins.includes(params.user_id) ? 'administrator' : 'member' };
      }
      if (method === 'sendMessage' || method === 'sendPhoto') return { message_id: nextId++ };
      return true;
    },
  };
}

export async function setup(opts = {}) {
  const tg = fakeTelegram(opts);
  const store = opts.store || createMemoryStore();
  let clock = new Date('2026-11-20T00:00:00Z');
  const crier = createCrier({
    tg,
    store,
    lookupTweet: opts.lookupTweet || (async () => null),
    ai: opts.ai ?? null,
    ...(opts.rand ? { rand: opts.rand } : {}),
    now: () => clock,
    config: {
      approved: ['TheRiftBorn', 'LegitFomoDaily', 'Boomer_Au'],
      owners: ['aussieboomer'],
      botId: BOT_ID,
      pinHours: 24,
      facts: '- Test facts.',
      alwaysTag: '#TheRiftBorn',
      extraTags: ['#TheRiftNFTs', '#DigiNFTs', '#Boomerverse'],
      approvedMentions: [],
      repliesPerMemberPerTweet: 3,
      repliesPerDay: opts.perDay ?? 300,
      getBotUsername: async () => opts.botUsername ?? null,
    },
  });
  if (opts.active !== false) await store.activateChat(opts.chatId ?? GROUP, 'Test group');
  return {
    tg,
    store,
    crier,
    advanceHours: (h) => {
      clock = new Date(clock.getTime() + h * 3600 * 1000);
    },
  };
}

let mid = 100;
export function msg(from, text, extra = {}) {
  return { message: { message_id: mid++, chat: { id: GROUP, type: 'supergroup', title: 'Test group' }, from, text, ...extra } };
}
export const tap = (from, messageId, data = 'in') => ({
  callback_query: { id: `cb${mid++}`, from, data, message: { message_id: messageId, chat: { id: GROUP, type: 'supergroup' } } },
});

export const dm = (from, text) => ({ message: { message_id: mid++, chat: { id: from.id, type: 'private' }, from, text } });
export const dmTap = (from, data) => ({
  callback_query: { id: `cb${mid++}`, from, data, message: { message_id: mid++, chat: { id: from.id, type: 'private' } } },
});
