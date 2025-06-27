#!/usr/bin/env node
/**
 * parse-trello.js
 *
 * Usage:
 *   node parse-trello.js <trello-export.json> > study-plan.generated.json
 *
 * The script reads a Trello board export, extracts LeetCode problem cards that match
 * "Week <n> - <Problem Title>", resolves the canonical slug via the alfa-leetcode-api,
 * and outputs a JSON object compatible with study-plan.js.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

if (process.argv.length < 3) {
  console.error('Usage: node parse-trello.js <trello-export.json>');
  process.exit(1);
}

const EXPORT_PATH = process.argv[2];
const API_BASE = process.env.LEETCODE_API_URL || 'https://alfa-leetcode-api.onrender.com';
const RAW = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf-8'));

const listsById = new Map();
RAW.lists?.forEach(l => {
  listsById.set(l.id, l);
});

function extractWeekInfo(cardName) {
  // Matches "Week 6 - Binary Search"
  const m = cardName.match(/^Week\s+(\d+)\s*[-–]\s*(.+)$/i);
  if (!m) return null;
  return { week: parseInt(m[1], 10), title: m[2].trim() };
}

function isReviewCard(name) {
  return /sunday|spiral|catch\s*up|reflection|review|revisit|re-solve|confidence|tag\s+weaknesses|solve\s+\d+/i.test(name);
}

function toSlug(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-');
}

async function resolveSlug(slug) {
  try {
    const url = `${API_BASE}/select?titleSlug=${slug}`;
    const res = await axios.get(url, { timeout: 8000 });
    if (res.status === 200 && res.data?.questionTitle) {
      return { slug, difficulty: res.data.difficulty || 'Unknown' };
    }
    return null;
  } catch (err) {
    return null;
  }
}

(async () => {
  const weeks = {};
  const failures = [];

  for (const card of RAW.cards || []) {
    if (card.closed) continue;
    const info = extractWeekInfo(card.name);
    if (!info) continue;
    if (isReviewCard(card.name)) continue; // skip Sunday / review cards

    const { week, title } = info;

    if (week >= 18) continue; // Skip meta catch-up week

    // Determine theme from its list
    const list = listsById.get(card.idList);
    if (!list || !/week/i.test(list.name)) continue; // skip lists without week reference (e.g., System Design)

    let theme = 'Unknown';
    if (list) {
      const themeMatch = list.name.match(/^(.+?)\s*\(.*?Week/i);
      if (themeMatch) theme = themeMatch[1].trim();
    }

    // Ensure week bucket exists
    if (!weeks[week]) {
      weeks[week] = { theme, problems: [] };
    } else if (weeks[week].theme === 'Unknown' && theme !== 'Unknown') {
      weeks[week].theme = theme;
    }

    // Resolve slug via heuristic + API validation
    const candidateSlug = toSlug(title);
    let difficulty = 'Unknown';
    // Try to resolve, but don't fail if it doesn't validate
    const resolved = await resolveSlug(candidateSlug);
    if (resolved) {
      difficulty = resolved.difficulty;
    } else {
      failures.push({ week, title, tried: candidateSlug });
    }

    weeks[week].problems.push({
      name: title,
      slug: candidateSlug,
      difficulty,
      estimatedTime: 30,
      priority: 'medium'
    });
  }

  // Output summary to stderr
  console.error('--- Import Summary ---');
  Object.keys(weeks).sort((a, b) => a - b).forEach(w => {
    console.error(`Week ${w}: ${weeks[w].problems.length} problems (theme: ${weeks[w].theme})`);
  });
  if (failures.length) {
    console.error('\nUnresolved problems:');
    failures.forEach(f => console.error(`Week ${f.week} – ${f.title} (slug tried: ${f.tried})`));
  }

  // Output JSON object
  console.log(JSON.stringify({ weeks }, null, 2));
})(); 