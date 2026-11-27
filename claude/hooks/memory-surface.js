#!/usr/bin/env node
/**
 * UserPromptSubmit hook — surface the memory bodies relevant to THIS prompt.
 *
 * The problem it fixes: MEMORY.md loads as index lines only, so a fact can be
 * present-but-unused at the decision point. Retrieval was never the bottleneck; a trigger at the moment
 * the topic arises was. This is that trigger.
 *
 * Contract: reads the UserPromptSubmit JSON on stdin, scores the prompt against
 * every memory file's signal terms, and prints the top 1-2 matching bodies to
 * stdout as additional context. Prints nothing when nothing matches. ALWAYS
 * exits 0 — a memory hook must never block or break a prompt.
 *
 * Matching, by design:
 *   - Signal terms are auto-derived from each memory's `name` + `description`
 *     (distinctive tokens only; stopwords and generic words dropped), so there
 *     is no hand-maintained keyword list to rot.
 *   - A memory may add an optional `triggers:` frontmatter list to tune matching;
 *     those terms are ADDED to the derived set, never required.
 *   - Fires only on >= MIN_HITS distinct signal-term hits, which kills the
 *     single-common-word false positive ("windows" alone won't do it).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MEM_DIR = path.join(os.homedir(), '.claude', 'memory');
const MIN_AUTO_HITS = 2;   // auto-derived terms needed to fire (kills common-word FPs)
const MAX_INJECT = 2;      // most bodies to surface at once
const BODY_CAP = 1400;     // chars of body per memory (trim the rest)
// A single curated `triggers:` hit fires — the human made those decisive on purpose.

// Generic words that carry no routing signal even though they appear in descriptions.
const STOP = new Set((
  'the a an and or of to in on at is are be it its this that these those with without ' +
  'for from by as not never always all any every his him he she they them my your our ' +
  'work works working want wants need needs happen happens run runs use uses using via ' +
  'set sets when what which how who why where into out over under about than then also ' +
  'per each one two three more most less least good bad fast slow hard rule rules note ' +
  'notes thing things stuff item items still yet just only even much many few new old ' +
  'connect connects guest here there now day days date modified type name description ' +
  // short (2-char) stopwords, since prompt tokenization keeps 2-char words for triggers
  'im is it on at to of or an be do go my me we us so no up by if in as hi ok id vs re ' +
  // too-common to route on: appear in many memory descriptions AND in everyday prompts
  'claude code local want wants dream let lets get got make made see look check'
).split(' '));

// Signal tokens from name/description: length >= 3 so descriptions don't inject 2-char noise.
function tokenize(s) {
  return (s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

// Prompt tokens: keep 2-char words (so "vm", "os", "db" can match a trigger), drop stopwords.
function tokenizePrompt(s) {
  return (s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

// Trigger terms: curated, so honoured verbatim at any length, no stopword filtering.
function parseTriggers(raw) {
  return (raw || '')
    .replace(/["']/g, '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function getPrompt(raw) {
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.prompt === 'string') return j.prompt;
  } catch { /* not JSON — treat the whole thing as the prompt */ }
  return raw;
}

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: text };
  const fmBlock = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\s+/, '');
  const fm = {};
  for (const line of fmBlock.split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    const t = line.match(/^\s*triggers:\s*\[(.*)\]/);
    if (t) fm.triggers = t[1];
  }
  return { fm, body };
}

function main() {
  const promptTokens = new Set(tokenizePrompt(getPrompt(readStdin())));
  if (promptTokens.size === 0) return;

  let files = [];
  try {
    files = fs.readdirSync(MEM_DIR).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
  } catch { return; }

  const scored = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(MEM_DIR, f), 'utf8'); } catch { continue; }
    const { fm, body } = parseFrontmatter(text);
    if (!fm.description && !fm.name) continue;

    const auto = new Set([...tokenize(fm.name), ...tokenize(fm.description)]);
    const triggers = new Set(parseTriggers(fm.triggers));

    const autoHits = [...auto].filter((t) => promptTokens.has(t));
    const trigHits = [...triggers].filter((t) => promptTokens.has(t));

    // Fire on either a single curated trigger, or >= 2 auto-derived terms.
    const fires = trigHits.length >= 1 || autoHits.length >= MIN_AUTO_HITS;
    if (fires) {
      const hits = [...new Set([...trigHits, ...autoHits])];
      // triggers weigh double for ranking — they are the deliberate signal
      const score = trigHits.length * 2 + autoHits.length;
      scored.push({ name: fm.name || f.replace(/\.md$/, ''), body, score, hits });
    }
  }

  if (scored.length === 0) return;
  scored.sort((a, b) => b.score - a.score);

  const out = ['[auto-surfaced memory — matched this prompt; verify before relying on it]'];
  for (const m of scored.slice(0, MAX_INJECT)) {
    const b = m.body.length > BODY_CAP ? m.body.slice(0, BODY_CAP) + ' […]' : m.body;
    out.push(`\n### memory: ${m.name}  (matched: ${m.hits.join(', ')})\n${b}`);
  }
  process.stdout.write(out.join('\n') + '\n');
}

try { main(); } catch { /* never break a prompt */ }
process.exit(0);
