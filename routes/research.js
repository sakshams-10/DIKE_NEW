'use strict';
const express = require('express');
const { query } = require('../src/db');
const { requireAuth } = require('../src/auth');
const { complete } = require('../src/ai');
const { str, bad, logActivity } = require('../src/util');

const router = express.Router();
const KIND = { judgment: 'Judgment', statute: 'Statute', note: 'Note' };

function keywordFallback(q, auth) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const hits = auth.filter((a) => words.some((w) => `${a.title} ${a.court}`.toLowerCase().includes(w)));
  return hits.length
    ? 'AI answers aren\'t available right now, but these authorities in your repository match your question: ' + hits.map((a) => `[${a.title}]`).join(', ') + '.'
    : 'AI answers aren\'t available right now, and nothing in your repository matches those words. Try adding the relevant authorities first.';
}

// Answers are drawn only from the shared repository.
router.post('/', requireAuth, async (req, res) => {
  const q = str(req.body?.question, 400);
  if (q.length < 4) throw bad('Ask a longer question.');
  const auth = (await query('SELECT id, title, kind, court, year, citations FROM authorities ORDER BY citations DESC, title')).rows;
  await logActivity(null, 'ask', 'asked the repository a question', req.user.id);
  if (!auth.length) return res.json({ text: 'Your repository is empty, so there is nothing to draw an answer from. Add a few authorities first.', ai: false });
  const links = (await query(`SELECT a.title AS f, b.title AS t FROM links l JOIN authorities a ON a.id = l.from_id JOIN authorities b ON b.id = l.to_id`)).rows;

  const system = 'You are the research assistant inside DÍKĒ, a legal workspace. Answer ONLY from the authorities listed by the user, which are their own repository. ' +
    'Cite each authority you rely on by its exact title in [square brackets]. If the repository does not contain enough to answer, say so plainly and suggest what kind of authority to add; ' +
    'never invent cases, holdings, quotations or citations. Do not give advice on a specific personal legal situation. Keep it to 3-6 sentences in plain language.';
  const prompt = 'AUTHORITIES (title | type | court/source | year | citation count):\n' +
    auth.map((a, i) => `${i + 1}. ${a.title} | ${KIND[a.kind] || 'Authority'} | ${a.court || 'n/a'} | ${a.year || 'n/a'} | cited ${a.citations} times in this workspace`).join('\n') +
    '\n\nRECORDED CITATION LINKS:\n' + (links.map((l) => `- "${l.f}" cites "${l.t}"`).join('\n') || '(none recorded)') + '\n\nQUESTION: ' + q;
  const text = await complete(system, [{ role: 'user', content: prompt }]);
  const used = auth.filter((a) => (text || '').toLowerCase().includes(a.title.toLowerCase())).map((a) => a.title);
  res.json(text ? { text, ai: true, used, considered: auth.length } : { text: keywordFallback(q, auth), ai: false, used: [], considered: auth.length });
});

module.exports = router;
