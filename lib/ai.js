// The AI that writes replies (Anthropic's Claude, called over the web).

import { buildPrompt, parseAnswer } from './reply.js';

export function createAi({ apiKey, model = 'claude-haiku-5-5', base = 'https://api.anthropic.com', fetchImpl = fetch }) {
  async function post(body) {
    return fetchImpl(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  }

  async function ask(input) {
    const { system, user } = buildPrompt(input);
    const body = { model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] };
    // A short reply needs no long think-time. Ask the AI to answer straight away;
    // if this model does not accept that request, ask again the plain way.
    let res = await post({ ...body, thinking: { type: 'disabled' } });
    if (res.status === 400) res = await post(body);
    if (!res.ok) {
      const detail = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
      throw new Error(`AI service answered ${res.status} ${detail.slice(0, 200)}`.trim());
    }
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text || '').join('');
    return { text, stopReason: data.stop_reason, kinds: (data.content || []).map((c) => c.type) };
  }
  return {
    // The raw answer, for the setup page's check.
    ask,
    async writeReply(input) {
      return parseAnswer((await ask(input)).text);
    },
  };
}
