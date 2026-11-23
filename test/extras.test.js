// Tests for the three extras: the reminder, Generate quote and the owner report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, msg, dm, dmTap, tap, OWNER, MEMBER, ADMIN, GROUP } from './helpers.js';
import { finishReply, buildPrompt, QUOTE_LIMIT, QUOTE_ANGLES } from '../lib/reply.js';
import { reminderLine } from '../lib/crier.js';

const TWEET = 'https://x.com/TheRiftBorn/status/1234567890123456789';
const START_REPLY = `/start r${Math.abs(GROUP)}_5000`;
const START_QUOTE = `/start q${Math.abs(GROUP)}_5000`;

function fakeAi(answers) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async writeReply(input) {
      calls.push(input);
      return answers[Math.min(i++, answers.length - 1)];
    },
  };
}
const A = (reply, tags = ['#DigiNFTs', '#Boomerverse']) => ({ reply, tags });

async function dropped(opts = {}) {
  const ctx = await setup({ botUsername: 'RiftCrierBot', lookupTweet: async () => ({ author: 'TheRiftBorn', text: 'Veyra wakes.' }), ...opts });
  await ctx.crier.handleUpdate(msg(OWNER, `${TWEET} What do you see?`));
  return ctx;
}

// ---------- 1. The reminder ----------

test('reminder: the wording for 0, 1 and many members', () => {
  assert.equal(reminderLine(0), '⏰ No one is in yet. Still time to be the first.');
  assert.equal(reminderLine(1), '⏰ 1 member is in. Still time to join.');
  assert.equal(reminderLine(14), '⏰ 14 members are in. Still time to join.');
});

test('reminder: nothing before 18 hours, one line at 18 hours, never a second one', async () => {
  const { tg, crier, advanceHours } = await setup();
  await crier.handleUpdate(msg(OWNER, TWEET));
  await crier.handleUpdate(tap(MEMBER, 5000));
  await crier.handleUpdate(tap(ADMIN, 5000));
  const before = tg.of('sendMessage').length;

  advanceHours(17.9);
  assert.deepEqual(await crier.runCron(), { due: 0, unpinned: 0, reminded: 0 });
  assert.equal(tg.of('sendMessage').length, before);

  advanceHours(0.2);
  assert.deepEqual(await crier.runCron(), { due: 0, unpinned: 0, reminded: 1 });
  const reminder = tg.of('sendMessage').at(-1);
  assert.equal(reminder.chat_id, GROUP);
  assert.equal(reminder.text, '⏰ 2 members are in. Still time to join.');
  assert.deepEqual(reminder.reply_parameters, { message_id: 5000 });

  advanceHours(1);
  assert.deepEqual(await crier.runCron(), { due: 0, unpinned: 0, reminded: 0 });
  assert.equal(tg.of('sendMessage').length, before + 1);
});

test('reminder: it is taken away when the post is unpinned', async () => {
  const { tg, crier, advanceHours } = await setup();
  await crier.handleUpdate(msg(OWNER, TWEET));
  advanceHours(19);
  await crier.runCron();
  const deletesBefore = tg.of('deleteMessage').length;
  advanceHours(5);
  assert.deepEqual(await crier.runCron(), { due: 1, unpinned: 1, reminded: 0 });
  // 5000 is the post, 5001 is the reminder.
  assert.deepEqual(tg.of('deleteMessage').slice(deletesBefore), [{ chat_id: GROUP, message_id: 5001 }]);
});

test('reminder: a post in a topic gets its reminder in the same topic', async () => {
  const { tg, crier, advanceHours } = await setup();
  await crier.handleUpdate(msg(OWNER, TWEET, { is_topic_message: true, message_thread_id: 77 }));
  advanceHours(18);
  await crier.runCron();
  assert.equal(tg.of('sendMessage').at(-1).message_thread_id, 77);
});

test('reminder: if the timer was down past the 24 hours, no late reminder is sent', async () => {
  const { tg, crier, advanceHours } = await setup();
  await crier.handleUpdate(msg(OWNER, TWEET));
  const before = tg.of('sendMessage').length;
  advanceHours(30);
  assert.deepEqual(await crier.runCron(), { due: 1, unpinned: 1, reminded: 0 });
  assert.equal(tg.of('sendMessage').length, before);
});

test('reminder: if Telegram refuses it for good, The Crier does not keep trying, and still unpins', async () => {
  const { crier, advanceHours, tg, store } = await setup();
  await crier.handleUpdate(msg(OWNER, TWEET));
  advanceHours(19);
  const real = tg.call;
  tg.call = async (method, params) => {
    if (method === 'sendMessage') {
      const err = new Error('sendMessage: Bad Request: message to be replied not found');
      err.code = 400;
      throw err;
    }
    return real.call(tg, method, params);
  };
  assert.deepEqual(await crier.runCron(), { due: 0, unpinned: 0, reminded: 0 });
  assert.equal((await store.getPost(GROUP, 5000)).reminded, true);
  assert.deepEqual(await crier.runCron(), { due: 0, unpinned: 0, reminded: 0 });
  advanceHours(5);
  assert.deepEqual(await crier.runCron(), { due: 1, unpinned: 1, reminded: 0 });
});

// ---------- 2. Generate quote ----------

test('quote: the tidy post carries "Generate quote" beside "Generate reply"', async () => {
  const { tg } = await dropped({ ai: fakeAi([A('x')]) });
  const row = tg.of('editMessageReplyMarkup').at(-1).reply_markup.inline_keyboard[2];
  assert.equal(row[0].text, '✨ Generate reply');
  assert.equal(row[1].text, '✨ Generate quote');
  assert.equal(row[1].url, `https://t.me/RiftCrierBot?start=q${Math.abs(GROUP)}_5000`);
});

test('quote: a member gets a quote, with the tags, and a button that opens a quote of the tweet on X', async () => {
  const ai = fakeAi([A('Have a look at what is waking up at the Gateway.')]);
  const { tg, crier } = await dropped({ ai });
  assert.equal(await crier.handleUpdate(dm(MEMBER, START_QUOTE)), 'generate-quote:sent');
  assert.equal(ai.calls[0].kind, 'quote');
  assert.ok(QUOTE_ANGLES.includes(ai.calls[0].angle));
  const sent = tg.of('sendMessage').at(-1);
  assert.equal(sent.chat_id, MEMBER.id);
  assert.match(sent.text, /^Your quote\. Tap it to copy:/);
  assert.match(sent.text, /Have a look at what is waking up at the Gateway\. #TheRiftBorn #DigiNFTs<\/code>/);
  assert.match(sent.text, /Quotes left for this tweet: 2$/);
  const [postBtn] = sent.reply_markup.inline_keyboard[0];
  assert.equal(postBtn.text, '✍️ Post this quote on X');
  const url = new URL(postBtn.url);
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/tweet');
  assert.equal(url.searchParams.get('url'), TWEET);
  assert.equal(url.searchParams.get('text'), 'Have a look at what is waking up at the Gateway. #TheRiftBorn #DigiNFTs');
  assert.equal(url.searchParams.get('in_reply_to'), null);
  assert.equal(sent.reply_markup.inline_keyboard[1][0].callback_data, `gq:${GROUP}:5000`);
});

test('quote: "Give me another" under a quote gives another quote, not a reply', async () => {
  const ai = fakeAi([A('First one.'), A('Second one.')]);
  const { tg, crier } = await dropped({ ai });
  await crier.handleUpdate(dm(MEMBER, START_QUOTE));
  assert.equal(await crier.handleUpdate(dmTap(MEMBER, `gq:${GROUP}:5000`)), 'generate-quote:sent');
  assert.match(tg.of('sendMessage').at(-1).text, /^Your quote\./);
  assert.equal(ai.calls[1].kind, 'quote');
});

test('quote: 3 quotes and 3 replies per member per tweet, counted apart', async () => {
  const ai = fakeAi([A('One.'), A('Two.'), A('Three.'), A('Four.'), A('Five.'), A('Six.'), A('Seven.')]);
  const { tg, crier, store } = await dropped({ ai });
  for (let i = 0; i < 3; i++) assert.equal(await crier.handleUpdate(dm(MEMBER, START_QUOTE)), 'generate-quote:sent');
  assert.equal(await crier.handleUpdate(dm(MEMBER, START_QUOTE)), 'generate:member-limit');
  assert.match(tg.of('sendMessage').at(-1).text, /^You have had your 3 quotes for this tweet\./);
  // Replies are still open to the same member.
  for (let i = 0; i < 3; i++) assert.equal(await crier.handleUpdate(dm(MEMBER, START_REPLY)), 'generate:sent');
  assert.equal(await crier.handleUpdate(dm(MEMBER, START_REPLY)), 'generate:member-limit');
  assert.equal(await store.countRepliesBy(GROUP, 5000, MEMBER.id, 'quote'), 3);
  assert.equal(await store.countRepliesBy(GROUP, 5000, MEMBER.id, 'reply'), 3);
  assert.equal(await store.countRepliesBy(GROUP, 5000, MEMBER.id), 3);
});

test('quote: a quote is never the same words as a reply someone already has', async () => {
  const ai = fakeAi([A('Same words.'), A('Same words.'), A('New words.')]);
  const { crier, store } = await dropped({ ai });
  await crier.handleUpdate(dm(MEMBER, START_REPLY));
  await crier.handleUpdate(dm(ADMIN, START_QUOTE));
  const given = await store.recentReplies(GROUP, 5000, 10);
  assert.equal(given.length, 2);
  assert.match(given[0], /^Same words\./);
  assert.match(given[1], /^New words\./);
});

test('quote: quotes count toward the same daily cap as replies', async () => {
  const ai = fakeAi([A('One.'), A('Two.'), A('Three.')]);
  const { tg, crier } = await dropped({ ai, perDay: 2 });
  await crier.handleUpdate(dm(MEMBER, START_REPLY));
  await crier.handleUpdate(dm(MEMBER, START_QUOTE));
  assert.equal(await crier.handleUpdate(dm(ADMIN, START_QUOTE)), 'generate:day-limit');
  assert.match(tg.of('sendMessage').at(-1).text, /Please write this quote in your own words\.$/);
});

test('quote: the words plus the tags leave room for the tweet link on X', () => {
  const long = 'word '.repeat(80).trim() + '.';
  const out = finishReply({ reply: long, tags: ['#DigiNFTs', '#Boomerverse'] }, {
    alwaysTag: '#TheRiftBorn',
    pool: ['#DigiNFTs', '#Boomerverse'],
    limit: QUOTE_LIMIT,
  });
  assert.ok(out.length <= 256, `length ${out.length}`);
  assert.match(out, / #TheRiftBorn #DigiNFTs #Boomerverse$/);
});

test('quote: the AI is told it is writing a quote, and the reply instructions are unchanged', () => {
  const base = { facts: '- f', tweetText: 't', line: '', used: [], length: 'x', angle: 'y', pool: ['#A'] };
  assert.match(buildPrompt({ ...base, kind: 'quote' }).system, /^You write one short line .* quote/);
  assert.match(buildPrompt(base).system, /^You write one reply that a real community member will post on X under a tweet/);
});

test('quote: with the AI switched off there is no "Generate quote" button', async () => {
  const { tg } = await dropped({ ai: null });
  const labels = tg.of('sendMessage')[0].reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(!labels.includes('✨ Generate quote'));
});

// ---------- 5. The owner report ----------

test('report: the owner gets the numbers in the private chat', async () => {
  const ai = fakeAi([A('One.'), A('Two.'), A('Three.')]);
  const { tg, crier, advanceHours } = await dropped({ ai });
  await crier.handleUpdate(tap(MEMBER, 5000));
  await crier.handleUpdate(tap(ADMIN, 5000));
  await crier.handleUpdate(tap(ADMIN, 5000));
  await crier.handleUpdate(dm(MEMBER, START_REPLY));
  await crier.handleUpdate(dm(MEMBER, START_REPLY));
  await crier.handleUpdate(dm(ADMIN, START_QUOTE));
  advanceHours(1);

  assert.equal(await crier.handleUpdate(dm(OWNER, '/crier report')), 'report');
  const sent = tg.of('sendMessage').at(-1);
  assert.equal(sent.chat_id, OWNER.id);
  assert.equal(
    sent.text,
    [
      'The Crier report',
      '',
      'Last 7 days',
      '• Tweets dropped: 1',
      '• "I\'m in" taps: 2',
      '• Replies written: 2',
      '• Quotes written: 1',
      '',
      'Last 24 hours',
      '• Replies and quotes written: 3 of 300',
      '',
      'Groups The Crier is on in: 1',
    ].join('\n'),
  );
});

test('report: things older than 7 days drop out; the 24-hour line only counts the last day', async () => {
  const ai = fakeAi([A('One.')]);
  const { tg, crier, advanceHours } = await dropped({ ai });
  await crier.handleUpdate(tap(MEMBER, 5000));
  await crier.handleUpdate(dm(MEMBER, START_REPLY));
  advanceHours(25);
  await crier.handleUpdate(dm(OWNER, '/crier report'));
  assert.match(tg.of('sendMessage').at(-1).text, /Replies written: 1\n/);
  assert.match(tg.of('sendMessage').at(-1).text, /written: 0 of 300/);
  advanceHours(24 * 7);
  await crier.handleUpdate(dm(OWNER, '/crier report'));
  const text = tg.of('sendMessage').at(-1).text;
  assert.match(text, /Tweets dropped: 0\n/);
  assert.match(text, /taps: 0\n/);
  assert.match(text, /Replies written: 0\n/);
});

test('report: nobody but the owner can get it, and it is never sent in a group', async () => {
  const { tg, crier } = await dropped();
  const before = tg.of('sendMessage').length;
  assert.equal(await crier.handleUpdate(dm(MEMBER, '/crier report')), 'private');
  assert.equal(await crier.handleUpdate(dm(ADMIN, '/crier report')), 'private');
  assert.equal(await crier.handleUpdate(msg(OWNER, '/crier report')), 'ignored:no-tweet');
  assert.equal(tg.of('sendMessage').length, before);
});

// ---------- Fewer tags ----------

const TAGS = { alwaysTag: '#TheRiftBorn', pool: ['#DigiNFTs', '#Boomerverse', '#TheRiftNFTs'] };
const tagsIn = (s) => s.match(/[#@]\w+/g) || [];

test('fewer tags: a reply carries #TheRiftBorn only, never a second tag', () => {
  const out = finishReply({ reply: 'That stare could stop a road train.', tags: ['#DigiNFTs', '#Boomerverse'] }, { ...TAGS, extraMax: 0, inline: true });
  assert.equal(out, 'That stare could stop a road train. #TheRiftBorn');
});

test('fewer tags: about 8 replies in 10 carry the tag, the rest carry none', () => {
  const cfg = { ...TAGS, extraMax: 0, tagChance: 0.8, inline: true };
  assert.equal(finishReply({ reply: 'Ripper.', tags: [] }, { ...cfg, rand: () => 0.79 }), 'Ripper. #TheRiftBorn');
  assert.equal(finishReply({ reply: 'Ripper.', tags: [] }, { ...cfg, rand: () => 0.81 }), 'Ripper.');
  let withTag = 0;
  for (let i = 0; i < 2000; i++) if (tagsIn(finishReply({ reply: 'Ripper.', tags: [] }, cfg)).length) withTag++;
  assert.ok(withTag > 1500 && withTag < 1700, `${withTag} of 2000`);
});

test('fewer tags: when the words say "the Rift Born", those words become the tag and nothing is added at the end', () => {
  const cfg = { ...TAGS, extraMax: 0, inline: true };
  assert.equal(finishReply({ reply: 'Can not wait to see what the Rift Born do next.', tags: [] }, cfg), 'Can not wait to see what #TheRiftBorn do next.');
  assert.equal(finishReply({ reply: 'Rift Born never miss.', tags: [] }, cfg), '#TheRiftBorn never miss.');
  assert.equal(finishReply({ reply: 'Only the first one changes: the Rift Born, the Rift Born.', tags: [] }, cfg), 'Only the first one changes: #TheRiftBorn, the Rift Born.');
  // "my Rift Born" would read wrongly as a tag, so the tag goes at the end.
  assert.equal(finishReply({ reply: 'Proud of my Rift Born today.', tags: [] }, cfg), 'Proud of my Rift Born today. #TheRiftBorn');
  // A reply that carries no tag is left as the AI wrote it.
  assert.equal(finishReply({ reply: 'What the Rift Born do next is anyone\'s guess.', tags: [] }, { ...cfg, tagChance: 0.8, rand: () => 0.9 }), "What the Rift Born do next is anyone's guess.");
});

test('fewer tags: a quote always carries #TheRiftBorn, plus one extra tag half the time, never two', () => {
  const cfg = { ...TAGS, extraMax: 1, extraChance: 0.5, inline: true, limit: QUOTE_LIMIT };
  const a = { reply: 'Have a look at this one.', tags: ['#DigiNFTs', '#Boomerverse'] };
  assert.equal(finishReply(a, { ...cfg, rand: () => 0.4 }), 'Have a look at this one. #TheRiftBorn #DigiNFTs');
  assert.equal(finishReply(a, { ...cfg, rand: () => 0.6 }), 'Have a look at this one. #TheRiftBorn');
  assert.equal(finishReply({ reply: 'The Rift Born are stirring again.', tags: ['#Boomerverse'] }, { ...cfg, rand: () => 0.4 }), '#TheRiftBorn are stirring again. #Boomerverse');
  for (let i = 0; i < 500; i++) {
    const t = tagsIn(finishReply(a, cfg));
    assert.ok(t.includes('#TheRiftBorn') && t.length <= 2, t.join(' '));
  }
});

test('fewer tags: the 280 limit still holds, with and without the tag in the words', () => {
  const long = 'The Rift Born ' + 'word '.repeat(80).trim() + '.';
  for (const cfg of [{ extraMax: 0 }, { extraMax: 1, limit: QUOTE_LIMIT }]) {
    const out = finishReply({ reply: long, tags: ['#DigiNFTs'] }, { ...TAGS, inline: true, ...cfg });
    assert.ok(out.length <= (cfg.limit || 280), `length ${out.length}`);
    assert.ok(out.startsWith('#TheRiftBorn word'));
  }
});

test('fewer tags: through the bot, a reply has one tag and a quote has at most two', async () => {
  const ai = fakeAi([A('Veyra is awake and so am I.'), A('Worth a look, this.')]);
  const { tg, crier } = await dropped({ ai });
  await crier.handleUpdate(dm(MEMBER, START_REPLY));
  assert.match(tg.of('sendMessage').at(-1).text, /<code>Veyra is awake and so am I\. #TheRiftBorn<\/code>/);
  await crier.handleUpdate(dm(MEMBER, START_QUOTE));
  assert.match(tg.of('sendMessage').at(-1).text, /<code>Worth a look, this\. #TheRiftBorn #DigiNFTs<\/code>/);
});
