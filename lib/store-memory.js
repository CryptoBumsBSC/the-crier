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
      posts.set(key(p.chat_id, p.message_id), { ...p, unpinned: false });
    },
    async getPost(chatId, messageId) {
      const p = posts.get(key(chatId, messageId));
      return p ? { ...p } : null;
    },
    async updateLine(chatId, messageId, line) {
      posts.get(key(chatId, messageId)).line = line;
    },
    async addIn(chatId, messageId, userId) {
      const k = key(chatId, messageId);
      if (!ins.has(k)) ins.set(k, new Set());
      const set = ins.get(k);
      if (set.has(userId)) return false;
      set.add(userId);
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
    async saveReply(chatId, messageId, userId, body, norm, at = new Date()) {
      if (replies.some((r) => r.chat_id === chatId && r.message_id === messageId && r.norm === norm)) return false;
      replies.push({ chat_id: chatId, message_id: messageId, user_id: userId, body, norm, at });
      return true;
    },
    async countRepliesBy(chatId, messageId, userId) {
      return replies.filter((r) => r.chat_id === chatId && r.message_id === messageId && r.user_id === userId).length;
    },
    async countRepliesSince(since) {
      return replies.filter((r) => r.at >= since).length;
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
