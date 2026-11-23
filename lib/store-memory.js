// In-memory store. Used by the automated tests only.

export function createMemoryStore() {
  const chats = new Map();
  const posts = new Map();
  const ins = new Map();
  const replies = [];
  const settings = new Map();
  const key = (c, m) => `${c}:${m}`;
  return {
    async init() {},
    async isChatActive(chatId) {
      return chats.has(chatId);
    },
    async activateChat(chatId, title) {
      chats.set(chatId, title);
    },
    async deactivateChat(chatId) {
      chats.delete(chatId);
    },
    async createPost(p) {
      posts.set(key(p.chat_id, p.message_id), {
        ...p,
        unpinned: false,
        reminded: false,
        reminder_message_id: null,
        created_at: p.created_at || new Date(),
      });
    },
    async getPost(chatId, messageId) {
      const p = posts.get(key(chatId, messageId));
      return p ? { ...p } : null;
    },
    async updateLine(chatId, messageId, line) {
      posts.get(key(chatId, messageId)).line = line;
    },
    async addIn(chatId, messageId, userId, at = new Date()) {
      const k = key(chatId, messageId);
      if (!ins.has(k)) ins.set(k, new Map());
      const set = ins.get(k);
      if (set.has(userId)) return false;
      set.set(userId, at);
      return true;
    },
    async countIn(chatId, messageId) {
      return ins.get(key(chatId, messageId))?.size ?? 0;
    },
    async duePosts(now) {
      return [...posts.values()].filter((p) => !p.unpinned && p.pinned_until <= now).map((p) => ({ ...p }));
    },
    async markUnpinned(chatId, messageId) {
      posts.get(key(chatId, messageId)).unpinned = true;
    },
    async dueReminders(now, leadMs) {
      return [...posts.values()]
        .filter((p) => !p.unpinned && !p.reminded && p.pinned_until > now && p.pinned_until.getTime() - leadMs <= now.getTime())
        .map((p) => ({ ...p }));
    },
    async markReminded(chatId, messageId, reminderMessageId) {
      const p = posts.get(key(chatId, messageId));
      p.reminded = true;
      p.reminder_message_id = reminderMessageId;
    },
    async saveReply(chatId, messageId, userId, body, norm, { kind = 'reply', at = new Date() } = {}) {
      if (replies.some((r) => r.chat_id === chatId && r.message_id === messageId && r.norm === norm)) return false;
      replies.push({ chat_id: chatId, message_id: messageId, user_id: userId, body, norm, kind, at });
      return true;
    },
    async countRepliesBy(chatId, messageId, userId, kind = 'reply') {
      return replies.filter(
        (r) => r.chat_id === chatId && r.message_id === messageId && r.user_id === userId && r.kind === kind,
      ).length;
    },
    async countRepliesSince(since, kind = null) {
      return replies.filter((r) => r.at >= since && (!kind || r.kind === kind)).length;
    },
    async countPostsSince(since) {
      return [...posts.values()].filter((p) => p.created_at >= since).length;
    },
    async countInsSince(since) {
      let n = 0;
      for (const set of ins.values()) for (const at of set.values()) if (at >= since) n++;
      return n;
    },
    async countChats() {
      return chats.size;
    },
    async recentReplies(chatId, messageId, limit) {
      return replies.filter((r) => r.chat_id === chatId && r.message_id === messageId).slice(-limit).map((r) => r.body);
    },
    async getSetting(name) {
      return settings.get(name) ?? null;
    },
    async setSetting(name, value) {
      settings.set(name, value);
    },
  };
}
