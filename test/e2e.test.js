// End-to-end test: the real web pages (api/*.js), a real Postgres database,
// and a stand-in Telegram server. Runs only when E2E_DATABASE_URL is set.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const DB = process.env.E2E_DATABASE_URL;
const skip = !DB && 'set E2E_DATABASE_URL to run';

const TOKEN = '999:TESTTOKEN';
const GROUP = -100777;
const TWEET = 'https://x.com/TheRiftBorn/status/1234567890123456789';

function fakeTelegramServer() {
  const calls = [];
  const aiCalls = [];
  let nextId = 7000;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const params = body ? JSON.parse(body) : {};
      if (req.url === '/v1/messages') {
        // Stand-in AI: the first two answers are the same on purpose.
        // The setup page's own sample request is answered apart and not counted.
        const isSetupSample = JSON.stringify(params).includes('Something is stirring at the Gateway');
        const n = isSetupSample ? 99 : aiCalls.push(params);
        const reply = isSetupSample ? 'Setup sample.' : n <= 2 ? 'Same words for two people.' : `Fresh words number ${n}.`;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ reply, tags: ['#DigiNFTs', '#Boomerverse'] }) }] }));
      }
      const method = req.url.split('/').pop();
      calls.push({ method, params });
      let result = true;
      if (method === 'getMe') result = { id: 999, first_name: 'The Crier', username: 'RiftCrierBot' };
      if (method === 'getChatMember') result = { status: params.user_id === 2 ? 'administrator' : 'member' };
      if (method === 'sendMessage') result = { message_id: nextId++ };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ calls, aiCalls, of: (m) => calls.filter((c) => c.method === m).map((c) => c.params), server, port: server.address().port }),
    ),
  );
}

function fakeRes() {
  const r = { code: 0, body: undefined, headers: {} };
  r.setHeader = (k, v) => (r.headers[k] = v);
  r.status = (c) => ((r.code = c), r);
  r.send = (b) => ((r.body = b), r);
  r.json = (b) => ((r.body = b), r);
  return r;
}

test('end to end: setup page, drop, I\'m in, edit, unpin timer, wrong secrets refused', { skip }, async () => {
  const fake = await fakeTelegramServer();
  Object.assign(process.env, {
    BOT_TOKEN: TOKEN,
    DATABASE_URL: DB,
    WEBHOOK_SECRET: 'hook-secret',
    SETUP_KEY: 'setup-key',
    CRON_SECRET: 'cron-secret',
    TELEGRAM_API_BASE: `http://127.0.0.1:${fake.port}`,
    ANTHROPIC_API_KEY: 'test-ai-key',
    ANTHROPIC_API_BASE: `http://127.0.0.1:${fake.port}`,
  });
  const { default: setupPage } = await import('../api/setup.js');
  const { default: webhook } = await import('../api/telegram.js');
  const { default: cron } = await import('../api/cron.js');
  const { createPgStore } = await import('../lib/store-pg.js');
  const store = createPgStore(DB);

  const hook = async (update, secret = 'hook-secret') => {
    const res = fakeRes();
    await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body: update }, res);
    return res;
  };

  // Clear rows left by an earlier run, but keep the old tables so the upgrade path is tested.
  const pgm = await import('pg');
  const wipe = new pgm.default.Client({ connectionString: DB });
  await wipe.connect();
  for (const t of ['crier_posts', 'crier_ins', 'crier_replies']) {
    await wipe.query(`delete from ${t} where chat_id = $1`, [GROUP]).catch(() => {});
  }
  await wipe.end();

  try {
    // Setup page: wrong key refused, right key creates tables and connects Telegram.
    let res = fakeRes();
    await setupPage({ query: { key: 'nope' }, headers: { host: 'crier.example' } }, res);
    assert.equal(res.code, 401);

    res = fakeRes();
    await setupPage({ query: { key: 'setup-key' }, headers: { host: 'crier.example' } }, res);
    assert.equal(res.code, 200, res.body);
    assert.match(res.body, /The Crier is set up\./);
    assert.match(res.body, /@RiftCrierBot/);
    assert.match(res.body, /7\. Generate reply: ready \(AI model claude-haiku-5-5\)\. Sample reply: Setup sample\. #TheRiftBorn #DigiNFTs #Boomerverse/);
    const [wh] = fake.of('setWebhook');
    assert.equal(wh.url, 'https://crier.example/api/telegram');
    assert.equal(wh.secret_token, 'hook-secret');
    assert.deepEqual(wh.allowed_updates, ['message', 'callback_query', 'my_chat_member']);

    // Running setup twice is safe.
    res = fakeRes();
    await setupPage({ query: { key: 'setup-key' }, headers: { host: 'crier.example' } }, res);
    assert.equal(res.code, 200, res.body);

    // Start clean for this test group.
    await store.deactivateChat(GROUP);

    // Wrong webhook secret is refused.
    assert.equal((await hook({ update_id: 1 }, 'wrong')).code, 401);

    // Owner adds The Crier to the group.
    await hook({
      update_id: 2,
      my_chat_member: {
        chat: { id: GROUP, type: 'supergroup', title: 'E2E' },
        from: { id: 1, username: 'aussieboomer' },
        new_chat_member: { status: 'administrator' },
      },
    });
    assert.equal(await store.isChatActive(GROUP), true);

    // Admin drops a tweet.
    const chat = { id: GROUP, type: 'supergroup', title: 'E2E' };
    await hook({ update_id: 3, message: { message_id: 50, chat, from: { id: 2, username: 'adm' }, text: `${TWEET} What do you see?` } });
    const sent = fake.of('sendMessage').at(-1);
    assert.equal(sent.text, `What do you see?\n\n${TWEET}`);
    const postId = 7000;
    const saved = await store.getPost(GROUP, postId);
    assert.equal(saved.tweet_url, TWEET);
    assert.equal(saved.line, 'What do you see?');
    assert.equal(saved.unpinned, false);
    const hoursPinned = (saved.pinned_until - Date.now()) / 3600000;
    assert.ok(hoursPinned > 23.9 && hoursPinned <= 24, `pinned for ${hoursPinned} hours`);

    // The post now carries the sixth button, pointing at the bot's private chat.
    const sixth = fake.of('editMessageReplyMarkup').at(-1).reply_markup.inline_keyboard[2][0];
    assert.equal(sixth.text, '✨ Generate reply');
    assert.equal(sixth.url, `https://t.me/RiftCrierBot?start=r${Math.abs(GROUP)}_${postId}`);

    // Two members tap Generate reply at the same moment and the AI gives both the same words.
    // Only one of them may keep those words; the other gets fresh ones.
    const startBy = (id, n) =>
      hook({ update_id: n, message: { message_id: 900 + n, chat: { id, type: 'private' }, from: { id }, text: `/start r${Math.abs(GROUP)}_${postId}` } });
    await Promise.all([startBy(501, 60), startBy(502, 61)]);
    const given = await store.recentReplies(GROUP, postId, 10);
    assert.equal(given.length, 2);
    assert.equal(new Set(given).size, 2);
    assert.equal(given.filter((g) => g.startsWith('Same words for two people.')).length, 1);
    for (const g of given) assert.match(g, / #TheRiftBorn #DigiNFTs #Boomerverse$/);
    assert.equal(fake.aiCalls[0].model, 'claude-haiku-5-5');
    assert.equal(await store.countRepliesBy(GROUP, postId, 501), 1);
    assert.equal(await store.countRepliesSince(new Date(Date.now() - 60000)), 2);

    // Three taps from two members = 2.
    const tapBy = (id, n) =>
      hook({ update_id: n, callback_query: { id: `c${n}`, from: { id }, data: 'in', message: { message_id: postId, chat } } });
    await tapBy(10, 4);
    await tapBy(10, 5);
    await tapBy(11, 6);
    assert.equal(await store.countIn(GROUP, postId), 2);
    assert.match(fake.of('editMessageText').at(-1).text, /👥 2 members are in$/);

    // Ten members tapping at the same moment are all counted once each.
    await Promise.all(Array.from({ length: 10 }, (_, i) => tapBy(100 + i, 20 + i)));
    assert.equal(await store.countIn(GROUP, postId), 12);

    // Edit feature.
    await hook({
      update_id: 40,
      message: { message_id: 51, chat, from: { id: 2 }, text: 'edit New line here', reply_to_message: { message_id: postId, from: { id: 999 } } },
    });
    assert.equal((await store.getPost(GROUP, postId)).line, 'New line here');
    assert.match(fake.of('editMessageText').at(-1).text, /^New line here\n\n.*\n\n👥 12 members are in$/s);

    // Unpin timer: wrong secret refused; nothing due yet; due after 24 hours.
    res = fakeRes();
    await cron({ headers: { authorization: 'Bearer wrong' } }, res);
    assert.equal(res.code, 401);

    res = fakeRes();
    await cron({ headers: { authorization: 'Bearer cron-secret' } }, res);
    assert.deepEqual(res.body, { due: 0, unpinned: 0 });

    const pgmod = await import('pg');
    const direct = new pgmod.default.Client({ connectionString: DB });
    await direct.connect();
    await direct.query(`update crier_posts set pinned_until = now() - interval '1 minute' where chat_id = $1`, [GROUP]);
    await direct.end();

    res = fakeRes();
    await cron({ headers: { authorization: 'Bearer cron-secret' } }, res);
    assert.deepEqual(res.body, { due: 1, unpinned: 1 });
    assert.deepEqual(fake.of('unpinChatMessage'), [{ chat_id: GROUP, message_id: postId }]);
    assert.equal((await store.getPost(GROUP, postId)).unpinned, true);
  } finally {
    await store.close();
    fake.server.close();
  }
});
