// The Crier: the rules agreed in the plan, in one place.
//
// 1. You or a group admin drops a tweet link from an approved X account.
// 2. The Crier replaces it with a tidy post: the tweet, your line, five buttons.
// 3. "I'm in" shows a running line. Each member counts once per post.
// 4. The edit feature: reply to the tidy post with "edit" and the new line.
// 5. The post stays pinned for 24 hours, then The Crier unpins it.
// 6. The Crier only works in groups that the owner added it to.
// 7. "Generate reply": in a private chat, The Crier writes one unique reply for
//    that member, ending with the always-tag plus two more tags.

import { findTweets, canonicalUrl, intentLinks } from './x.js';
import { LENGTHS, ANGLES, pick, normalize, finishReply } from './reply.js';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function tallyLine(count) {
  if (count <= 0) return '';
  return count === 1 ? '👥 1 member is in' : `👥 ${count} members are in`;
}

export function renderPost(post, count) {
  const max = post.is_photo ? 700 : 3000;
  const line = (post.line || '').slice(0, max);
  const parts = [];
  if (line) parts.push(esc(line));
  parts.push(esc(post.tweet_url));
  const tally = tallyLine(count);
  if (tally) parts.push(tally);
  return parts.join('\n\n');
}

// The private-chat link behind the "Generate reply" button.
export function generateLink(botUsername, post) {
  return `https://t.me/${botUsername}?start=r${Math.abs(post.chat_id)}_${post.message_id}`;
}

export function buttons(post, botUsername) {
  const links = intentLinks(post.tweet_url, post.tweet_id);
  const rows = [
    [
      { text: '❤️ Like', url: links.like },
      { text: '🔁 Repost', url: links.repost },
    ],
    [
      { text: '✍️ Quote', url: links.quote },
      { text: '💬 Comment', url: links.comment },
    ],
  ];
  if (botUsername && post.message_id) {
    rows.push([{ text: '✨ Generate reply', url: generateLink(botUsername, post) }]);
  }
  rows.push([{ text: "✅ I'm in", callback_data: 'in' }]);
  return { inline_keyboard: rows };
}

export function createCrier({ tg, store, config, lookupTweet, ai = null, now = () => new Date(), log = () => {}, rand = Math.random }) {
  const approved = new Set(config.approved.map((h) => h.toLowerCase()));
  const owners = new Set(config.owners.map((h) => h.toLowerCase()));
  const pinMs = (config.pinHours ?? 24) * 60 * 60 * 1000;

  const replyCfg = {
    facts: config.facts || '',
    alwaysTag: config.alwaysTag || '#TheRiftBorn',
    pool: [...(config.extraTags || []), ...(config.approvedMentions || [])],
    perMember: config.repliesPerMemberPerTweet ?? 3,
    perDay: config.repliesPerDay ?? 300,
  };
  // The "Generate reply" button only shows when the AI is switched on.
  const botName = async () => (ai && config.getBotUsername ? await config.getBotUsername() : null);

  const isOwner = (user) => !!user?.username && owners.has(user.username.toLowerCase());

  async function soft(method, params) {
    try {
      return await tg.call(method, params);
    } catch (err) {
      log(`soft-fail ${err.message}`);
      return null;
    }
  }

  async function canDrop(m) {
    // An admin posting as the group itself ("anonymous admin").
    if (m.sender_chat && m.sender_chat.id === m.chat.id) return true;
    if (!m.from) return false;
    if (isOwner(m.from)) return true;
    try {
      const member = await tg.call('getChatMember', { chat_id: m.chat.id, user_id: m.from.id });
      return member.status === 'creator' || member.status === 'administrator';
    } catch {
      return false;
    }
  }

  async function redraw(post) {
    const count = await store.countIn(post.chat_id, post.message_id);
    const base = {
      chat_id: post.chat_id,
      message_id: post.message_id,
      parse_mode: 'HTML',
      reply_markup: buttons(post, await botName()),
    };
    try {
      if (post.is_photo) {
        await tg.call('editMessageCaption', { ...base, caption: renderPost(post, count) });
      } else {
        await tg.call('editMessageText', {
          ...base,
          text: renderPost(post, count),
          link_preview_options: { url: post.tweet_url, prefer_large_media: true },
        });
      }
    } catch (err) {
      if (!/not modified/i.test(err.description || err.message)) throw err;
    }
    return count;
  }

  // Pick the first tweet link in the message that is from an approved X account.
  async function pickApproved(text) {
    for (const t of findTweets(text)) {
      const urlOk = t.handle && approved.has(t.handle.toLowerCase());
      // A link that names a handle off the list is ignored without asking X.
      if (t.handle && !urlOk) continue;
      const found = await lookupTweet(t.id);
      const author = found?.author || t.handle;
      if (!author || !approved.has(author.toLowerCase())) continue;
      return { ...t, author, text: found?.text || '' };
    }
    return null;
  }

  async function onDrop(m, text) {
    const chosen = await pickApproved(text);
    if (!chosen) return 'ignored:not-approved';

    const line = text.replace(chosen.raw, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const photo = Array.isArray(m.photo) && m.photo.length ? m.photo[m.photo.length - 1].file_id : null;
    const post = {
      chat_id: m.chat.id,
      message_id: null,
      tweet_id: chosen.id,
      tweet_url: canonicalUrl(chosen.author, chosen.id),
      tweet_text: chosen.text,
      line,
      is_photo: !!photo,
    };
    const common = {
      chat_id: m.chat.id,
      parse_mode: 'HTML',
      // The "Generate reply" button needs the post's number, so it is added just below.
      reply_markup: buttons(post, null),
      ...(m.is_topic_message && m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}),
    };
    const sent = photo
      ? await tg.call('sendPhoto', { ...common, photo, caption: renderPost(post, 0) })
      : await tg.call('sendMessage', {
          ...common,
          text: renderPost(post, 0),
          link_preview_options: { url: post.tweet_url, prefer_large_media: true },
        });

    post.message_id = sent.message_id;
    post.pinned_until = new Date(now().getTime() + pinMs);
    await store.createPost(post);

    const name = await botName();
    if (name) {
      await soft('editMessageReplyMarkup', {
        chat_id: post.chat_id,
        message_id: post.message_id,
        reply_markup: buttons(post, name),
      });
    }

    await soft('pinChatMessage', { chat_id: m.chat.id, message_id: sent.message_id, disable_notification: true });
    await soft('deleteMessage', { chat_id: m.chat.id, message_id: m.message_id });
    return 'posted';
  }

  async function onEdit(m, newLine) {
    const post = await store.getPost(m.chat.id, m.reply_to_message.message_id);
    if (!post) return 'ignored:not-a-crier-post';
    if (!(await canDrop(m))) return 'ignored:not-admin';
    post.line = newLine;
    await store.updateLine(post.chat_id, post.message_id, newLine);
    await redraw(post);
    await soft('deleteMessage', { chat_id: m.chat.id, message_id: m.message_id });
    return 'edited';
  }

  async function onMessage(m) {
    const text = m.text ?? m.caption ?? '';

    if (m.chat.type === 'private') {
      const gen = /^\/start\s+r(\d+)_(\d+)\s*$/i.exec(text);
      if (gen && m.from) return onGenerate(m.from, -Number(gen[1]), Number(gen[2]));
      if (/^\/start\b/i.test(text)) {
        await soft('sendMessage', {
          chat_id: m.chat.id,
          text: 'I am The Crier. I call out new tweets in the groups my owner has added me to.',
        });
      }
      return 'private';
    }
    if (m.chat.type !== 'group' && m.chat.type !== 'supergroup') return 'ignored:chat-type';

    if (!(await store.isChatActive(m.chat.id))) {
      // Backup switch in case Telegram never told us about being added.
      if (isOwner(m.from) && /^\/crier(@\w+)?\s+on\b/i.test(text)) {
        await store.activateChat(m.chat.id, m.chat.title || '');
        await soft('sendMessage', { chat_id: m.chat.id, text: 'The Crier is on in this group.' });
        return 'activated';
      }
      return 'ignored:inactive-chat';
    }

    // Tidy up the "pinned a message" notice for our own posts.
    if (m.pinned_message) {
      if (m.pinned_message.from?.id === config.botId) {
        await soft('deleteMessage', { chat_id: m.chat.id, message_id: m.message_id });
        return 'cleaned-pin-notice';
      }
      return 'ignored:pin-notice';
    }
    if (m.from?.id === config.botId) return 'ignored:self';

    const reply = m.reply_to_message;
    if (reply && reply.from?.id === config.botId) {
      const em = /^\/?edit\b[:\s]*([\s\S]*)$/i.exec(text.trim());
      if (em) return onEdit(m, em[1].trim());
    }

    if (!findTweets(text).length) return 'ignored:no-tweet';
    if (!(await canDrop(m))) return 'ignored:not-admin';
    return onDrop(m, text);
  }

  const say = (userId, text, extra = {}) => soft('sendMessage', { chat_id: userId, text, ...extra });

  // "Generate reply": one unique reply for this member, for this tweet.
  async function onGenerate(user, chatId, messageId) {
    const post = await store.getPost(chatId, messageId);
    if (!post || !ai) {
      await say(user.id, 'That tweet is no longer active. Please use the newest post in the group.');
      return 'generate:unknown-post';
    }
    let status = 'left';
    try {
      status = (await tg.call('getChatMember', { chat_id: chatId, user_id: user.id })).status;
    } catch {}
    if (status === 'left' || status === 'kicked') {
      await say(user.id, 'Generate reply is for members of the group.');
      return 'generate:not-member';
    }
    const mine = await store.countRepliesBy(chatId, messageId, user.id);
    if (mine >= replyCfg.perMember) {
      await say(user.id, `You have had your ${replyCfg.perMember} replies for this tweet. Write the next one in your own words.`);
      return 'generate:member-limit';
    }
    const since = new Date(now().getTime() - 24 * 60 * 60 * 1000);
    if ((await store.countRepliesSince(since)) >= replyCfg.perDay) {
      await say(user.id, 'The Crier has written its limit for today. Please write this reply in your own words.');
      return 'generate:day-limit';
    }

    const used = await store.recentReplies(chatId, messageId, 40);
    const usedNorm = new Set(used.map(normalize));
    let reply = null;
    for (let attempt = 0; attempt < 3 && !reply; attempt++) {
      let answer = null;
      try {
        answer = await ai.writeReply({
          facts: replyCfg.facts,
          tweetText: post.tweet_text || '',
          line: post.line || '',
          used,
          length: pick(LENGTHS, rand),
          angle: pick(ANGLES, rand),
          pool: replyCfg.pool,
        });
      } catch (err) {
        log(`ai ${err.message}`);
      }
      const text = finishReply(answer, { alwaysTag: replyCfg.alwaysTag, pool: replyCfg.pool, rand });
      if (!text || usedNorm.has(normalize(text))) continue;
      // The database refuses a reply that another member was given a moment ago.
      if (await store.saveReply(chatId, messageId, user.id, text, normalize(text))) reply = text;
    }
    if (!reply) {
      await say(user.id, 'I could not write a reply just now. Please try again in a minute.');
      return 'generate:failed';
    }

    const left = replyCfg.perMember - mine - 1;
    const postUrl = `https://x.com/intent/tweet?in_reply_to=${post.tweet_id}&text=${encodeURIComponent(reply)}`;
    const rows = [[{ text: '💬 Post this reply on X', url: postUrl }]];
    if (left > 0) rows.push([{ text: '🔄 Give me another', callback_data: `g:${chatId}:${messageId}` }]);
    await tg.call('sendMessage', {
      chat_id: user.id,
      parse_mode: 'HTML',
      text:
        `Your reply. Tap it to copy:\n\n<code>${esc(reply)}</code>\n\n` +
        `Change a word or two to make it yours.\nReplies left for this tweet: ${left}`,
      reply_markup: { inline_keyboard: rows },
      link_preview_options: { is_disabled: true },
    });
    return 'generate:sent';
  }

  async function onCallback(q) {
    const msg = q.message;
    const again = /^g:(-?\d+):(\d+)$/.exec(q.data || '');
    if (again && msg?.chat?.type === 'private') {
      await soft('answerCallbackQuery', { callback_query_id: q.id });
      return onGenerate(q.from, Number(again[1]), Number(again[2]));
    }
    if (q.data !== 'in' || !msg) {
      await soft('answerCallbackQuery', { callback_query_id: q.id });
      return 'ignored:callback';
    }
    const post = await store.getPost(msg.chat.id, msg.message_id);
    if (!post) {
      await soft('answerCallbackQuery', { callback_query_id: q.id, text: 'This post is no longer active.' });
      return 'ignored:unknown-post';
    }
    const isNew = await store.addIn(post.chat_id, post.message_id, q.from.id);
    if (isNew) await redraw(post);
    await soft('answerCallbackQuery', {
      callback_query_id: q.id,
      text: isNew ? "You're in. Thank you!" : "You're already in.",
    });
    return isNew ? 'in:new' : 'in:repeat';
  }

  async function onMembership(u) {
    const chat = u.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return 'ignored:chat-type';
    const status = u.new_chat_member?.status;
    if (status === 'left' || status === 'kicked') {
      await store.deactivateChat(chat.id);
      return 'deactivated';
    }
    if (status !== 'member' && status !== 'administrator') return 'ignored:status';
    if (await store.isChatActive(chat.id)) return 'already-active';
    if (isOwner(u.from)) {
      await store.activateChat(chat.id, chat.title || '');
      return 'activated';
    }
    // Added by someone who is not the owner: leave.
    await soft('leaveChat', { chat_id: chat.id });
    return 'left:not-owner';
  }

  async function handleUpdate(update) {
    if (update.my_chat_member) return onMembership(update.my_chat_member);
    if (update.callback_query) return onCallback(update.callback_query);
    if (update.message) return onMessage(update.message);
    return 'ignored:update-type';
  }

  // Unpin every post whose 24 hours are up.
  async function runCron() {
    const due = await store.duePosts(now());
    let done = 0;
    for (const p of due) {
      try {
        await tg.call('unpinChatMessage', { chat_id: p.chat_id, message_id: p.message_id });
        await store.markUnpinned(p.chat_id, p.message_id);
        done++;
      } catch (err) {
        // Telegram said no for good (post deleted, already unpinned): stop trying.
        if (err.code >= 400 && err.code < 500 && err.code !== 429) {
          await store.markUnpinned(p.chat_id, p.message_id);
        }
        log(`unpin ${err.message}`);
      }
    }
    return { due: due.length, unpinned: done };
  }

  return { handleUpdate, runCron };
}
