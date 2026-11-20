// Postgres store. Every table name starts with "crier_" so The Crier
// can share a database without touching anything that is already there.

import pg from 'pg';

let pool;

function getPool(connectionString) {
  if (!pool) {
    const local = /localhost|127\.0\.0\.1|\/tmp\//.test(connectionString);
    pool = new pg.Pool({
      connectionString,
      max: 2,
      ssl: local ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function createPgStore(connectionString) {
  const db = getPool(connectionString);
  const q = (text, params) => db.query(text, params);
  const row = (r) =>
    r && {
      chat_id: Number(r.chat_id),
      message_id: Number(r.message_id),
      tweet_id: r.tweet_id,
      tweet_url: r.tweet_url,
      tweet_text: r.tweet_text,
      line: r.line,
      is_photo: r.is_photo,
      pinned_until: r.pinned_until,
      unpinned: r.unpinned,
    };

  return {
    async init() {
      await q(`create table if not exists crier_chats (
        chat_id bigint primary key,
        title text not null default '',
        added_at timestamptz not null default now()
      )`);
      await q(`create table if not exists crier_posts (
        chat_id bigint not null,
        message_id bigint not null,
        tweet_id text not null,
        tweet_url text not null,
        line text not null default '',
        is_photo boolean not null default false,
        pinned_until timestamptz not null,
        unpinned boolean not null default false,
        created_at timestamptz not null default now(),
        primary key (chat_id, message_id)
      )`);
      await q(`create table if not exists crier_ins (
        chat_id bigint not null,
        message_id bigint not null,
        user_id bigint not null,
        created_at timestamptz not null default now(),
        primary key (chat_id, message_id, user_id)
      )`);
      await q(`alter table crier_posts add column if not exists tweet_text text not null default ''`);
      await q(`create table if not exists crier_replies (
        id bigserial primary key,
        chat_id bigint not null,
        message_id bigint not null,
        user_id bigint not null,
        body text not null,
        norm text not null,
        created_at timestamptz not null default now(),
        unique (chat_id, message_id, norm)
      )`);
      await q(`create index if not exists crier_replies_created on crier_replies (created_at)`);
      await q(`create table if not exists crier_settings (
        name text primary key,
        value text not null
      )`);
      // Keep these tables private if the database also serves a public API.
      for (const t of ['crier_chats', 'crier_posts', 'crier_ins', 'crier_replies', 'crier_settings']) {
        await q(`alter table ${t} enable row level security`);
      }
    },
    async isChatActive(chatId) {
      const r = await q('select 1 from crier_chats where chat_id = $1', [chatId]);
      return r.rowCount > 0;
    },
    async activateChat(chatId, title) {
      await q(
        `insert into crier_chats (chat_id, title) values ($1, $2)
         on conflict (chat_id) do update set title = excluded.title`,
        [chatId, title],
      );
    },
    async deactivateChat(chatId) {
      await q('delete from crier_chats where chat_id = $1', [chatId]);
    },
    async createPost(p) {
      await q(
        `insert into crier_posts (chat_id, message_id, tweet_id, tweet_url, tweet_text, line, is_photo, pinned_until)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [p.chat_id, p.message_id, p.tweet_id, p.tweet_url, p.tweet_text || '', p.line, p.is_photo, p.pinned_until],
      );
    },
    async getPost(chatId, messageId) {
      const r = await q('select * from crier_posts where chat_id = $1 and message_id = $2', [chatId, messageId]);
      return row(r.rows[0]) || null;
    },
    async updateLine(chatId, messageId, line) {
      await q('update crier_posts set line = $3 where chat_id = $1 and message_id = $2', [chatId, messageId, line]);
    },
    async addIn(chatId, messageId, userId) {
      const r = await q(
        `insert into crier_ins (chat_id, message_id, user_id) values ($1, $2, $3)
         on conflict do nothing`,
        [chatId, messageId, userId],
      );
      return r.rowCount === 1;
    },
    async countIn(chatId, messageId) {
      const r = await q('select count(*)::int as n from crier_ins where chat_id = $1 and message_id = $2', [
        chatId,
        messageId,
      ]);
      return r.rows[0].n;
    },
    async duePosts(now) {
      const r = await q('select * from crier_posts where not unpinned and pinned_until <= $1', [now]);
      return r.rows.map(row);
    },
    async markUnpinned(chatId, messageId) {
      await q('update crier_posts set unpinned = true where chat_id = $1 and message_id = $2', [chatId, messageId]);
    },
    async saveReply(chatId, messageId, userId, body, norm) {
      const r = await q(
        `insert into crier_replies (chat_id, message_id, user_id, body, norm) values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [chatId, messageId, userId, body, norm],
      );
      return r.rowCount === 1;
    },
    async countRepliesBy(chatId, messageId, userId) {
      const r = await q(
        'select count(*)::int as n from crier_replies where chat_id = $1 and message_id = $2 and user_id = $3',
        [chatId, messageId, userId],
      );
      return r.rows[0].n;
    },
    async countRepliesSince(since) {
      const r = await q('select count(*)::int as n from crier_replies where created_at >= $1', [since]);
      return r.rows[0].n;
    },
    async recentReplies(chatId, messageId, limit) {
      const r = await q(
        'select body from crier_replies where chat_id = $1 and message_id = $2 order by id desc limit $3',
        [chatId, messageId, limit],
      );
      return r.rows.map((x) => x.body).reverse();
    },
    async getSetting(name) {
      const r = await q('select value from crier_settings where name = $1', [name]);
      return r.rows[0]?.value ?? null;
    },
    async setSetting(name, value) {
      await q(
        `insert into crier_settings (name, value) values ($1, $2)
         on conflict (name) do update set value = excluded.value`,
        [name, value],
      );
    },
    async close() {
      await db.end();
      pool = undefined;
    },
  };
}
