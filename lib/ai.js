// The AI that writes replies (Anthropic's Claude, called over the web).

import { buildPrompt, parseAnswer } from './reply.js';

export function createAi({ apiKey, model = 'claude-haiku-5-5', base = 'https://api.anthropic.com', fetchImpl = fetch }) {
  return {
    async writeReply(input) {
      const { system, user } = buildPrompt(input);
      const res = await fetchImpl(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`AI service answered ${res.status}`);
      const data = await res.json();
      const text = (data.content || []).map((c) => c.text || '').join('');
      return parseAnswer(text);
    },
  };
}
