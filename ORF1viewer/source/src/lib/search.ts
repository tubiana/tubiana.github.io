/** Fast search over 1 178 model ids: exact / prefix / substring / fuzzy subsequence. */
import { ModelEntry } from './types';

export interface SearchDoc {
  id: string;
  lower: string; // id in lowercase
  hay: string; // id + accession + host + organism + strain (lowercase)
  tokens: string[]; // id split on non-alphanumeric
  index: number;
}

export function buildDocs(models: ModelEntry[]): SearchDoc[] {
  return models.map((m, index) => {
    const meta = m.meta ?? {};
    const parts = [
      m.id,
      m.accession,
      m.host,
      meta.genbank_nucl ?? '',
      meta.organism ?? '',
      meta.strain ?? '',
      meta.isolate ?? '',
      meta.Genogroupe ?? '',
    ].filter(Boolean);
    const hay = parts.join(' ').toLowerCase();
    // accession (genbank protein id) and genbank_nucl let users search by either
    // id used in the CSV/tree metadata, not just the model id.
    const extraTokens = [m.accession, meta.genbank_nucl ?? '']
      .filter(Boolean)
      .flatMap((v) => v.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    return {
      id: m.id,
      lower: m.id.toLowerCase(),
      hay,
      tokens: [...m.id.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), ...extraTokens],
      index,
    };
  });
}

/** subsequence test with a gap penalty; returns -1 when not a subsequence */
function subsequenceScore(needle: string, hay: string): number {
  let hi = 0;
  let gaps = 0;
  let run = 0;
  let bestRun = 0;
  for (let i = 0; i < needle.length; i++) {
    const ch = needle[i];
    const at = hay.indexOf(ch, hi);
    if (at < 0) return -1;
    if (at > hi) gaps += at - hi;
    else run++;
    bestRun = Math.max(bestRun, run);
    hi = at + 1;
  }
  return 40 - Math.min(30, gaps / 6) + bestRun * 2;
}

export function scoreQuery(qRaw: string, doc: SearchDoc): number {
  const q = qRaw.toLowerCase().trim();
  if (!q) return 0;
  const { lower, hay, tokens } = doc;
  let score = 0;

  if (lower === q) return 10_000;
  if (lower.startsWith(q)) score = Math.max(score, 3000 - Math.min(200, lower.length - q.length));
  for (const t of tokens) {
    if (t === q) score = Math.max(score, 2200);
    else if (t.startsWith(q)) score = Math.max(score, 1600 - Math.min(120, t.length - q.length));
  }
  const at = lower.indexOf(q);
  if (at > 0) score = Math.max(score, 900 - Math.min(80, at));
  if (score === 0) {
    const hayAt = hay.indexOf(q);
    if (hayAt >= 0) score = Math.max(score, hayAt < lower.length + 1 ? 700 : 500);
  }
  if (score === 0) {
    const sub = subsequenceScore(q, lower);
    if (sub > 0) score = Math.max(score, sub);
  }
  return score;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
}

export function search(docs: SearchDoc[], query: string, limit = 80): SearchHit[] {
  if (!query.trim()) return [];
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const s = scoreQuery(query, d);
    if (s > 0) hits.push({ doc: d, score: s });
  }
  hits.sort((a, b) => b.score - a.score || a.doc.id.length - b.doc.id.length);
  return hits.slice(0, limit);
}
