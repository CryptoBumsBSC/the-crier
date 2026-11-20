// A very small Telegram client. call('sendMessage', {...}) and so on.

export function createTelegram(token, fetchImpl = fetch, base = "https://api.telegram.org") {
  async function call(method, params = {}) {
    const res = await fetchImpl(`${base}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const err = new Error(`${method}: ${data.description || res.status}`);
      err.code = data.error_code || res.status;
      err.description = data.description || '';
      throw err;
    }
    return data.result;
  }
  return { call };
}

// The bot's own Telegram id is the number at the start of its token.
export function botIdFromToken(token) {
  return Number(String(token).split(':')[0]);
}
