import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_FILE = path.join(__dirname, '..', 'data', 'dashboard.json');

/** PowerShell ConvertTo-Json sometimes emits a single object instead of an array. */
export function normalizeUpdatePasses(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [raw];
  return [];
}

export function loadDashboardData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  data.updatePasses = normalizeUpdatePasses(data.updatePasses);
  return data;
}

export function extractPassHighlights(pass) {
  if (!pass) return [];
  const text = pass.overview || pass.body || '';
  const highlights = [];
  for (const m of text.matchAll(/\|\s*\*\*([^*|]+)\*\*\s*\|\s*([^|\n]+)\|/g)) {
    highlights.push({ title: m[1].trim(), detail: m[2].trim() });
    if (highlights.length >= 6) break;
  }
  if (highlights.length) return highlights;
  for (const m of text.matchAll(/^[-*]\s+(.+)$/gm)) {
    highlights.push({ title: m[1].replace(/\*\*/g, '').trim(), detail: '' });
    if (highlights.length >= 5) break;
  }
  return highlights;
}
