'use strict';
const config = require('./config');

// Calls the Claude Messages API directly; returns null when no key is configured
// or the call fails, so every caller has a graceful non-AI path.
async function complete(system, messages, maxTokens = 600) {
  if (!config.anthropicKey) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.anthropicModel, max_tokens: maxTokens, system, messages }),
      signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) { console.error('Anthropic API', r.status, (await r.text()).slice(0, 200)); return null; }
    const j = await r.json();
    return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim() || null;
  } catch (e) { console.error('Anthropic API error:', e.message); return null; }
}

module.exports = { complete };
