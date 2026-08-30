/**
 * "Search model from sequence": paste a FASTA/plain protein sequence, find the
 * closest of the 1178 reference ORF1 sequences (metadata/ORF1s_1178.fasta).
 *
 * Two-stage search to stay fast in the browser:
 *  1. k-mer (k=6) Jaccard similarity against every sequence — O(n) and ranks
 *     candidates well even for distant sequences.
 *  2. For the top candidates, a Smith-Waterman local alignment gives a precise
 *     percent-identity (robust to partial/fragment queries), which is what we
 *     actually report/sort by.
 */

export interface FastaRecord {
  id: string; // header after '>' (matches ModelEntry.id, e.g. "AAA45730.1-human-1691")
  seq: string; // uppercase amino acids, no whitespace
}

/** Parses a multi-FASTA file (id, e.g. "AAA45730.1-human-1691" per header, no description). */
export function parseFasta(text: string): FastaRecord[] {
  const records: FastaRecord[] = [];
  let id: string | null = null;
  let chunks: string[] = [];
  const flush = () => {
    if (id) records.push({ id, seq: chunks.join('') });
    chunks = [];
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line[0] === '>') {
      flush();
      id = line.slice(1).split(/\s+/)[0];
    } else {
      chunks.push(line.toUpperCase().replace(/[^A-Z*-]/g, ''));
    }
  }
  flush();
  return records;
}

/** Strips FASTA headers/whitespace/digits from a pasted query, keeping only residues. */
export function cleanQuerySequence(input: string): string {
  const lines = input.split(/\r?\n/).filter((l) => !l.trim().startsWith('>'));
  return lines.join('').toUpperCase().replace(/[^A-Z]/g, '');
}

function kmerSet(seq: string, k: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + k <= seq.length; i++) set.add(seq.slice(i, i + k));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Local alignment (Smith-Waterman, affine-free linear gap) so partial/fragment
 * queries (a domain, a truncated read, …) still find their true best match
 * instead of being penalised by end-gaps like a strict global alignment would.
 * Returns percent identity over the aligned (local) region.
 * O(n*m); fine for the handful of top candidates this is called on.
 */
function localIdentity(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  const MATCH = 2;
  const MISMATCH = -1;
  const GAP = -2;

  // rolling rows: score, match-count-on-best-path, aligned-length-on-best-path
  let prevScore = new Float64Array(m + 1);
  let prevMatch = new Int32Array(m + 1);
  let prevLen = new Int32Array(m + 1);
  let curScore = new Float64Array(m + 1);
  let curMatch = new Int32Array(m + 1);
  let curLen = new Int32Array(m + 1);

  let bestScore = 0;
  let bestMatch = 0;
  let bestLen = 0;

  for (let i = 1; i <= n; i++) {
    curScore[0] = 0;
    curMatch[0] = 0;
    curLen[0] = 0;
    for (let j = 1; j <= m; j++) {
      const isMatch = a[i - 1] === b[j - 1];
      const diag = prevScore[j - 1] + (isMatch ? MATCH : MISMATCH);
      const up = prevScore[j] + GAP;
      const left = curScore[j - 1] + GAP;
      let best = 0;
      let bMatch = 0;
      let bLen = 0;
      if (diag > best) {
        best = diag;
        bMatch = prevMatch[j - 1] + (isMatch ? 1 : 0);
        bLen = prevLen[j - 1] + 1;
      }
      if (up > best) {
        best = up;
        bMatch = prevMatch[j];
        bLen = prevLen[j] + 1;
      }
      if (left > best) {
        best = left;
        bMatch = curMatch[j - 1];
        bLen = curLen[j - 1] + 1;
      }
      curScore[j] = best;
      curMatch[j] = bMatch;
      curLen[j] = bLen;
      if (best > bestScore) {
        bestScore = best;
        bestMatch = bMatch;
        bestLen = bLen;
      }
    }
    [prevScore, curScore] = [curScore, prevScore];
    [prevMatch, curMatch] = [curMatch, prevMatch];
    [prevLen, curLen] = [curLen, prevLen];
  }

  return bestLen === 0 ? 0 : (100 * bestMatch) / bestLen;
}

export interface FastaMatch {
  id: string;
  pctIdentity: number;
}

/** Finds the reference sequence closest to `query`; null if the query is too short/empty. */
export function findClosestSequence(
  query: string,
  records: FastaRecord[],
  candidateCount = 12
): FastaMatch | null {
  const q = query.trim();
  if (q.length < 20) return null;
  const K = 6;
  const qKmers = kmerSet(q, K);

  const ranked = records
    .map((r) => ({ r, sim: jaccard(qKmers, kmerSet(r.seq, K)) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, candidateCount);

  let best: FastaMatch | null = null;
  for (const { r } of ranked) {
    const pct = localIdentity(q, r.seq);
    if (!best || pct > best.pctIdentity) best = { id: r.id, pctIdentity: pct };
  }
  return best;
}
