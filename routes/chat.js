'use strict';
const express = require('express');
const { complete } = require('../src/ai');

const router = express.Router();
const RULES = "You are the DÍKĒ Assistant on DÍKĒ's website (a legal intelligence platform for lawyers, law firms, judges and legal teams). Only answer questions about law, legal practice, contracts, litigation, court procedure, or legal research. If asked about anything unrelated to law, politely decline and redirect to a legal question. Never give specific legal advice for someone's personal situation — speak in general, educational terms and say so if asked. Keep answers to 2-4 sentences, plain language, professional tone.";

function classify(text) {
  const t = text.toLowerCase(), has = (arr) => arr.some((w) => t.includes(w));
  if (has(['contract', 'clause', 'agreement', 'breach', 'terms', 'indemnif', 'liability'])) return 'contract';
  if (has(['case', 'precedent', 'court', 'judge', 'litigation', 'appeal', 'ruling', 'verdict', 'trial'])) return 'litigation';
  if (has(['filing', 'deadline', 'procedure', 'statute', 'jurisdiction', 'compliance', 'regulation'])) return 'filing';
  if (has(['law', 'legal', 'lawyer', 'attorney', 'rights', 'plaintiff', 'defendant', 'evidence', 'witness', 'tort', 'criminal', 'civil'])) return 'general';
  return 'offtopic';
}
const FALLBACK = {
  contract: 'That sounds like a contract question. Inside the full workspace, DÍKĒ would pull the relevant clauses from your documents and flag anything unusual.',
  litigation: 'For case law and precedent, DÍKĒ searches your connected filings and returns answers with citations, not guesses.',
  filing: 'DÍKĒ can help track filings, deadlines, and procedural requirements once connected to your workspace.',
  general: 'That is a legal question. In the live product, I would answer using your own case documents and cite the source.',
  offtopic: 'I only answer legal questions. Try asking about a case, a contract clause, or a filing deadline.'
};

router.post('/', async (req, res) => {
  const raw = Array.isArray(req.body?.messages) ? req.body.messages.slice(-10) : [];
  const msgs = raw.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Send a question.' });
  const text = await complete(RULES, msgs, 400);
  res.json({ text: text || FALLBACK[classify(msgs[msgs.length - 1].content)], ai: !!text });
});

module.exports = router;
