import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, msg, tap, OWNER, ADMIN, MEMBER, BOT_ID, GROUP } from './helpers.js';
import { findTweets, intentLinks, lookupTweet, textFromEmbed } from '../lib/x.js';
import { tallyLine } from '../lib/crier.js';

const TWEET = 'https://x.com/TheRiftBorn/status/1234567890123456789';

test('owner drops an approved tweet with a line: tidy post, five buttons, pinned, original removed', async () => {
  const { tg, crier, store } = await setup();
  const u = msg(OWNER, `${TWEET} What do you see in this one?`);
  assert.equal(await crier.handleUpdate(u), 'posted');

  const [sent] = tg.of('sendMessage');
  assert.equal(sent.chat_id, GROUP);
  assert.equal(sent.text, `What do you see in this one?\n\n${TWEET}`);
  assert.equal(sent.link_preview_options.url, TWEET);

  const rows = sent.reply_markup.inline_keyboard;
  const labels = rows.flat().map((b) => b.text);
  assert.deepEqual(labels, ['❤️ Like', '🔁 Repost', '✍️ Quote', '💬 Comment', "✅ I'm in"]);
  assert.equal(rows[0][0].url, 'https://x.com/intent/like?tweet_id=1234567890123456789');
  assert.equal(rows[0][1].url, 'https://x.com/intent/retweet?tweet_id=1234567890123456789');
  assert.equal(rows[1][0].url, `https://x.com/intent/tweet?url=${encodeURIComponent(TWEET)}`);
  assert.equal(rows[1][1].url, 'https://x.com/intent/tweet?in_reply_to=1234567890123456789');
  assert.equal(rows[2][0].callback_data, 'in');

  assert.deepEqual(tg.of('pinChatMessage'), [{ chat_id: GROUP, message_id: 5000, disable_notification: true }]);
  assert.deepEqual(tg.of('deleteMessage'), [{ chat_id: GROUP, message_id: u.message.message_id }]);
  assert.ok(await store.getPost(GROUP, 5000));
});

test('a group admin can drop a tweet', async () => {
  const { tg, crier } = await setup();
  assert.equal(await crier.handleUpdate(msg(ADMIN, `${TWEET} Thoughts?`)), 'posted');
  assert.equal(tg.of('sendMessage').length, 1);
});

test('an admin posting as the group (anonymous admin) can drop a tweet', async () => {
  const { crier } = await setup();
  const u = msg({ id: 1087968824, username: 'GroupAnonymousBot' }, TWEET, { sender_chat: { id: GROUP } });
  assert.equal(await crier.handleUpdate(u), 'posted');
});

test('an ordinary member dropping a tweet link: The Crier does nothing', async () => {
  const { tg, crier } = await setup();
  assert.equal(await crier.handleUpdate(msg(MEMBER, TWEET)), 'ignored:not-admin');
  assert.equal(tg.of('sendMessage').length, 0);
  assert.equal(tg.of('deleteMessage').length, 0);
});

test('a tweet from an X account off the approved list is ignored', async () => {
  const { tg, crier } = await setup();
  const r = await crier.handleUpdate(msg(OWNER, 'https://x.com/elonmusk/status/1234567890123456789 look'));
  assert.equal(r, 'ignored:not-approved');
  assert.equal(tg.calls.length, 0);
});

test('all three approved accounts work, any letter case, twitter.com too', async () => {
  for (const link of [
    'https://x.com/theriftborn/status/11111111111',
    'https://twitter.com/LegitFomoDaily/status/22222222222?s=20',
    'https://mobile.x.com/BOOMER_AU/status/33333333333',
  ]) {
    const { crier } = await setup();
    assert.equal(await crier.handleUpdate(msg(OWNER, link)), 'posted', link);
  }
});

test('a link that fakes an approved name is caught when X says who really wrote it', async () => {
  const { tg, crier } = await setup({ lookupTweet: async () => ({ author: 'SomeScammer', text: '' }) });
  assert.equal(await crier.handleUpdate(msg(OWNER, TWEET)), 'ignored:not-approved');
  assert.equal(tg.of('sendMessage').length, 0);
});

test('a link with no account name in it works when X confirms an approved author', async () => {
  const { tg, crier } = await setup({ lookupTweet: async () => ({ author: 'Boomer_Au', text: '' }) });
  assert.equal(await crier.handleUpdate(msg(OWNER, 'https://x.com/i/web/status/44444444444')), 'posted');
  assert.match(tg.of('sendMessage')[0].text, /x\.com\/Boomer_Au\/status\/44444444444/);
});

test('a link with no account name is ignored when X cannot be asked', async () => {
  const { crier } = await setup();
  assert.equal(await crier.handleUpdate(msg(OWNER, 'https://x.com/i/web/status/44444444444')), 'ignored:not-approved');
});

test('a tweet link with no line: post has the tweet and the buttons only', async () => {
  const { tg, crier } = await setup();
  await crier.handleUpdate(msg(OWNER, TWEET));
  assert.equal(tg.of('sendMessage')[0].text, TWEET);
});

test('the line can come before the link, and odd characters are kept safe', async () => {
  const { tg, crier } = await setup();
  await crier.handleUpdate(msg(OWNER, `Is 5 < 6 & why? ${TWEET}?s=20&t=abc`));
  assert.equal(tg.of('sendMessage')[0].text, `Is 5 &lt; 6 &amp; why?\n\n${TWEET}`);
});

test('dropping the link as a caption on a picture posts the picture with the buttons', async () => {
  const { tg, crier } = await setup();
  const u = msg(OWNER, undefined, { caption: `${TWEET} Rate it`, photo: [{ file_id: 'small' }, { file_id: 'big' }] });
  assert.equal(await crier.handleUpdate(u), 'posted');
  const [p] = tg.of('sendPhoto');
  assert.equal(p.photo, 'big');
  assert.equal(p.caption, `Rate it\n\n${TWEET}`);
  assert.equal(p.reply_markup.inline_keyboard.flat().length, 5);
});

test('"I\'m in": each member counts once, and the running line updates', async () => {
  const { tg, crier } = await setup();
  await crier.handleUpdate(msg(OWNER, `${TWEET} Go`));

  assert.equal(await crier.handleUpdate(tap(MEMBER, 5000)), 'in:new');
  assert.match(tg.of('editMessageText').at(-1).text, /👥 1 member is in$/);

  assert.equal(await crier.handleUpdate(tap(MEMBER, 5000)), 'in:repeat');
  assert.equal(tg.of('editMessageText').length, 1);
  assert.equal(tg.of('answerCallbackQuery').at(-1).text, "You're already in.");

  assert.equal(await crier.handleUpdate(tap(ADMIN, 5000)), 'in:new');
  const last = tg.of('editMessageText').at(-1);
  assert.equal(last.text, `Go\n\n${TWEET}\n\n👥 2 members are in`);
  assert.equal(last.reply_markup.inline_keyboard.flat().length, 5);
});

test('running line wording', () => {
  assert.equal(tallyLine(0), '');
  assert.equal(tallyLine(1), '👥 1 member is in');
  assert.equal(tallyLine(14), '👥 14 members are in');
});

test('edit feature: admin replies "edit new line" - line changes, tally and buttons stay, reply removed', async () => {
  const { tg, crier } = await setup();
  await crier.handleUpdate(msg(OWNER, `${TWEET} Waht do you see?`));
  await crier.handleUpdate(tap(MEMBER, 5000));

  const reply = msg(ADMIN, 'edit What do you see?', { reply_to_message: { message_id: 5000, from: { id: BOT_ID } } });
  assert.equal(await crier.handleUpdate(reply), 'edited');
  const last = tg.of('editMessageText').at(-1);
  assert.equal(last.text, `What do you see?\n\n${TWEET}\n\n👥 1 member is in`);
  assert.equal(last.reply_markup.inline_keyboard.flat().length, 5);
  assert.equal(tg.of('deleteMessage').at(-1).message_id, reply.message.message_id);
  assert.equal(tg.of('pinChatMessage').length, 1);
  assert.equal(tg.of('unpinChatMessage').length, 0);
});

test('edit feature: an ordinary member cannot edit', async () => {
  const { tg, crier } = await setup();
  await crier.handleUpdate(msg(OWNER, `${TWEET} Original`));
  const reply = msg(MEMBER, 'edit Hacked', { reply_to_message: { message_id: 5000, from: { id: BOT_ID } } });
  assert.equal(await crier.handleUpdate(reply), 'ignored:not-admin');
  assert.equal(tg.of('editMessageText').length, 0);
});

test('edit feature: a normal reply to the post is left alone', async () => {
  const { tg, crier } = await setup();
  await crier.handleUpdate(msg(OWNER, `${TWEET} Original`));
  const reply = msg(MEMBER, 'editing my comment now, love this one', {
    reply_to_message: { message_id: 5000, from: { id: BOT_ID } },
  });
  assert.equal(await crier.handleUpdate(reply), 'ignored:no-tweet');
  assert.equal(tg.of('deleteMessage').length, 1); // only the original drop
});

test('24 hours: still pinned at 23 hours, unpinned after 24, never unpinned twice', async () => {
  const { tg, crier, advanceHours } = await setup();
  await crier.handleUpdate(msg(OWNER, TWEET));

  advanceHours(23);
  assert.deepEqual(await crier.runCron(), { due: 0, unpinned: 0 });

  advanceHours(1);
  assert.deepEqual(await crier.runCron(), { due: 1, unpinned: 1 });
  assert.deepEqual(tg.of('unpinChatMessage'), [{ chat_id: GROUP, message_id: 5000 }]);

  assert.deepEqual(await crier.runCron(), { due: 0, unpinned: 0 });
});

test('if the post was deleted, the unpin timer gives up instead of retrying forever', async () => {
  const { crier, advanceHours } = await setup({
    fail: { unpinChatMessage: { code: 400, description: 'Bad Request: message to unpin not found' } },
  });
  await crier.handleUpdate(msg(OWNER, TWEET));
  advanceHours(25);
  assert.deepEqual(await crier.runCron(), { due: 1, unpinned: 0 });
  assert.deepEqual(await crier.runCron(), { due: 0, unpinned: 0 });
});

test('the "pinned a message" notice for a Crier post is cleaned up', async () => {
  const { tg, crier } = await setup();
  const notice = msg({ id: BOT_ID }, undefined, { pinned_message: { message_id: 5000, from: { id: BOT_ID } } });
  assert.equal(await crier.handleUpdate(notice), 'cleaned-pin-notice');
  assert.equal(tg.of('deleteMessage')[0].message_id, notice.message.message_id);
});

test('if The Crier lacks pin or delete rights, the post still goes up', async () => {
  const { tg, crier } = await setup({
    fail: {
      pinChatMessage: { code: 400, description: 'not enough rights' },
      deleteMessage: { code: 400, description: 'not enough rights' },
    },
  });
  assert.equal(await crier.handleUpdate(msg(OWNER, TWEET)), 'posted');
  assert.equal(tg.of('sendMessage').length, 1);
});

test('groups: added by the owner = switched on; added by anyone else = The Crier leaves', async () => {
  const { tg, crier, store } = await setup({ active: false });
  const added = (from, chatId) => ({
    my_chat_member: { chat: { id: chatId, type: 'supergroup', title: 'G' }, from, new_chat_member: { status: 'member' } },
  });
  assert.equal(await crier.handleUpdate(added(OWNER, -1)), 'activated');
  assert.equal(await store.isChatActive(-1), true);

  assert.equal(await crier.handleUpdate(added(ADMIN, -2)), 'left:not-owner');
  assert.deepEqual(tg.of('leaveChat'), [{ chat_id: -2 }]);
  assert.equal(await store.isChatActive(-2), false);
});

test('in a group that is not switched on, The Crier does nothing, even for an admin', async () => {
  const { tg, crier } = await setup({ active: false });
  assert.equal(await crier.handleUpdate(msg(ADMIN, TWEET)), 'ignored:inactive-chat');
  assert.equal(tg.calls.length, 0);
});

test('the post appears only in the group where the tweet was dropped', async () => {
  const { tg, crier, store } = await setup();
  await store.activateChat(-2002, 'Other group');
  await crier.handleUpdate(msg(OWNER, TWEET));
  assert.deepEqual([...new Set(tg.of('sendMessage').map((p) => p.chat_id))], [GROUP]);
});

test('ordinary chat messages are ignored', async () => {
  const { tg, crier } = await setup();
  assert.equal(await crier.handleUpdate(msg(MEMBER, 'gm everyone')), 'ignored:no-tweet');
  assert.equal(tg.calls.length, 0);
});

test('X link reading and button links', () => {
  assert.deepEqual(findTweets('see https://x.com/Boomer_Au/status/123456789?s=1 ok'), [
    { raw: 'https://x.com/Boomer_Au/status/123456789?s=1', handle: 'Boomer_Au', id: '123456789' },
  ]);
  assert.equal(findTweets('https://x.com/TheRiftBorn').length, 0);
  assert.equal(findTweets('https://notx.com/TheRiftBorn/status/123456789').length, 0);
  assert.equal(intentLinks(TWEET, '5').like, 'https://x.com/intent/like?tweet_id=5');
});

test('asking X about a tweet: reads the author and the words, and copes when X cannot be reached', async () => {
  const html =
    '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Veyra wakes &amp; the Gateway hums<br>Who is ready? <a href="https://t.co/x">pic.twitter.com/x</a></p>&mdash; The Rift Born (@TheRiftBorn) <a href="https://twitter.com/TheRiftBorn/status/1">Nov 20</a></blockquote>';
  const ok = async () => ({ ok: true, json: async () => ({ author_url: 'https://twitter.com/TheRiftBorn', html }) });
  assert.deepEqual(await lookupTweet('1', ok), {
    author: 'TheRiftBorn',
    text: 'Veyra wakes & the Gateway hums\nWho is ready? pic.twitter.com/x',
  });
  assert.equal(textFromEmbed(''), '');
  const down = async () => {
    throw new Error('network');
  };
  assert.equal(await lookupTweet('1', down), null);
  const notFound = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await lookupTweet('1', notFound), null);
});
