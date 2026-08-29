/**
 * Clustal (.aln) parsing + alignment-column ↔ model-residue mapping.
 * Used inside a worker for parsing, and on the main thread for mapping.
 */

export interface MsaData {
  names: string[];
  rows: string[]; // aligned sequences, all of length `columns`
  columns: number;
  blockWidth: number;
  /** per column: fraction (0..1) of non-gap sequences carrying the majority residue */
  conservation: Float32Array;
  /** per column: number of gapped sequences */
  gaps: Uint16Array;
  /** name (as written in the file, truncated to 10 chars) -> row index */
  indexByName: Record<string, number>;
}

const SEQ_LINE = /^(\S{1,30})\s+([A-Za-z*?.\-]+)\s*$/;

export function parseClustal(text: string): MsaData {
  const lines = text.split('\n');
  const order: string[] = [];
  interface Rec {
    chunks: string[];
    len: number;
    lastBlock: number;
  }
  const recs = new Map<string, Rec>();
  const sizes = new Map<string, number>();
  const chunks = new Map<string, string[]>();
  let blockWidth = 0;
  let canonical: Set<string> | null = null;
  let blockHasSeq = false;
  let blockIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      // the first block defines the set of valid record names (conservation
      // lines such as "   ***  **" are then ignored)
      if (blockHasSeq && !canonical) {
        canonical = new Set<string>();
        for (const k of recs.keys()) canonical.add(k.split('#')[0]);
      }
      blockHasSeq = false;
      blockIdx++;
      continue;
    }
    if (line.startsWith('CLUSTAL')) continue;
    const m = SEQ_LINE.exec(line);
    if (!m) continue;
    const base = m[1];
    const seq = m[2];
    if (canonical && !canonical.has(base)) continue;
    // Names are truncated to 10 chars by MAFFT, so two different sequences can
    // share one name: the second record of a block gets a "#k" suffix.
    let key = base;
    let rec = recs.get(key);
    if (rec && rec.lastBlock === blockIdx) {
      let k = 2;
      while (true) {
        const cand = `${base}#${k}`;
        const cr = recs.get(cand);
        if (!cr) {
          key = cand;
          rec = undefined;
          break;
        }
        if (cr.lastBlock !== blockIdx) {
          key = cand;
          rec = cr;
          break;
        }
        k++;
      }
    }
    blockWidth = Math.max(blockWidth, seq.length);
    if (!rec) {
      rec = { chunks: [], len: 0, lastBlock: -2 };
      recs.set(key, rec);
      order.push(key);
    }
    rec.chunks.push(seq);
    rec.len += seq.length;
    rec.lastBlock = blockIdx;
    blockHasSeq = true;
  }

  for (const [k, r] of recs) {
    chunks.set(k, r.chunks);
    sizes.set(k, r.len);
  }

  let columns = 0;
  for (const n of order) columns = Math.max(columns, sizes.get(n) ?? 0);

  const rows: string[] = new Array(order.length);
  for (let r = 0; r < order.length; r++) {
    const name = order[r];
    const c = chunks.get(name)!;
    let s = c.join('');
    if (s.length < columns) s += '-'.repeat(columns - s.length);
    else if (s.length > columns) s = s.slice(0, columns);
    rows[r] = s;
  }

  const conservation = new Float32Array(columns);
  const gaps = new Uint16Array(columns);
  const counts = new Int32Array(26);
  const n = order.length;
  for (let c = 0; c < columns; c++) {
    counts.fill(0);
    let ungapped = 0;
    let best = 0;
    for (let r = 0; r < n; r++) {
      const ch = rows[r].charCodeAt(c);
      let idx: number;
      if (ch >= 65 && ch <= 90) idx = ch - 65;
      else if (ch >= 97 && ch <= 122) idx = ch - 97;
      else idx = -1;
      if (idx < 0) {
        gaps[c]++;
        continue;
      }
      ungapped++;
      const v = ++counts[idx];
      if (v > best) best = v;
    }
    conservation[c] = ungapped ? best / ungapped : 0;
  }

  const indexByName: Record<string, number> = {};
  for (let r = 0; r < order.length; r++) indexByName[order[r]] = r;

  return { names: order, rows, columns, blockWidth: blockWidth || 60, conservation, gaps, indexByName };
}

// --------------------------------------------------- column ↔ residue mapping
export interface ResidueMap {
  /** alignment column (0-based) → residue number (1-based), -1 when the row has a gap */
  colToRes: Int32Array;
  /** residue number (1-based, index 0 unused) → alignment column, -1 if absent */
  resToCol: Int32Array;
  length: number;
  mismatches: number;
  compared: number;
  reliable: boolean;
  ungapped: string;
}

const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G',
  HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S',
  THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M',
};

/** Minimal PDB parse: per-residue number → one-letter, plus CA coordinate (for camera focus). */
export interface PdbResidues {
  length: number;
  maxResnum: number;
  /** residue number → one-letter code (index 0 is padding, so `oneLetter[rn]` works) */
  oneLetter: string;
  /** one-letter codes in model order — what an alignment row actually compares to */
  ordered: string;
  caX: Float32Array;
  caY: Float32Array;
  caZ: Float32Array;
  hasCa: Uint8Array;
}

export function parsePdbResidues(text: string): PdbResidues {
  const lines = text.split('\n');
  let maxResnum = 0;
  const seen = new Set<number>();
  const orderSeen: number[] = [];
  const xs = new Map<number, number>();
  const ys = new Map<number, number>();
  const zs = new Map<number, number>();
  const names = new Map<number, string>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length < 66 || !l.startsWith('ATOM')) continue;
    const name = l.substring(12, 16).trim();
    if (name !== 'CA') continue;
    const resn = l.substring(17, 20).trim();
    let rn: number;
    try {
      rn = parseInt(l.substring(22, 26), 10);
    } catch {
      continue;
    }
    if (!Number.isFinite(rn)) continue;
    if (rn > maxResnum) maxResnum = rn;
    if (seen.has(rn)) continue;
    seen.add(rn);
    orderSeen.push(rn);
    names.set(rn, THREE_TO_ONE[resn] ?? 'X');
    xs.set(rn, parseFloat(l.substring(30, 38)));
    ys.set(rn, parseFloat(l.substring(38, 46)));
    zs.set(rn, parseFloat(l.substring(46, 54)));
  }
  const length = seen.size;
  // index 0 is padded with 'X' so that the joined string stays 1-based
  const oneLetterArr = new Array<string>(maxResnum + 1).fill('X');
  oneLetterArr[0] = 'X';
  const orderedArr: string[] = [];
  for (const rn of orderSeen) orderedArr.push(names.get(rn) ?? 'X');
  const caX = new Float32Array(maxResnum + 1);
  const caY = new Float32Array(maxResnum + 1);
  const caZ = new Float32Array(maxResnum + 1);
  const hasCa = new Uint8Array(maxResnum + 1);
  for (const rn of seen) {
    oneLetterArr[rn] = names.get(rn) ?? 'X';
    caX[rn] = xs.get(rn) ?? 0;
    caY[rn] = ys.get(rn) ?? 0;
    caZ[rn] = zs.get(rn) ?? 0;
    hasCa[rn] = 1;
  }
  return {
    length,
    maxResnum,
    oneLetter: oneLetterArr.join(''),
    ordered: orderedArr.join(''),
    caX,
    caY,
    caZ,
    hasCa,
  };
}

/**
 * Map one alignment row onto model residue numbers.
 * `expectedSequence` must be 1-based by residue number (PdbResidues.oneLetter):
 * position i of the row is compared with residue number i+1 of the model, so a
 * few unmodelled residues (no atoms in the PDB) do not shift the whole compare.
 * A mismatch rate >2 % marks the mapping unreliable, which the UI reports
 * instead of silently trusting a bad row.
 */
export function mapRowToResidues(row: string, expectedSequence?: string): ResidueMap {
  const columns = row.length;
  const colToRes = new Int32Array(columns).fill(-1);
  const ungappedParts: string[] = [];
  let res = 0;
  for (let c = 0; c < columns; c++) {
    const ch = row[c];
    if (ch === '-' || ch === '.' || ch === '?') continue;
    res++;
    colToRes[c] = res;
    ungappedParts.push(ch.toUpperCase());
  }
  const length = res;
  const resToCol = new Int32Array(length + 1).fill(-1);
  for (let c = 0; c < columns; c++) {
    const r = colToRes[c];
    if (r > 0 && resToCol[r] < 0) resToCol[r] = c;
  }
  const ungapped = ungappedParts.join('');
  let mismatches = 0;
  let compared = 0;
  if (expectedSequence) {
    for (let i = 0; i < length; i++) {
      const a = ungapped[i];
      const b = expectedSequence[i + 1];
      if (!b || b === 'X' || a === 'X' || a === '*') continue;
      compared++;
      if (a !== b) mismatches++;
    }
  }
  return {
    colToRes,
    resToCol,
    length,
    mismatches,
    compared,
    reliable: compared === 0 || mismatches / compared < 0.02,
    ungapped,
  };;
}

/** residue range(s) covered by an alignment column range for the mapped row */
export function columnsToResidues(map: ResidueMap, c0: number, c1: number): { s: number; e: number } | null {
  let s = -1;
  let e = -1;
  const lo = Math.max(0, Math.min(c0, c1));
  const hi = Math.min(map.colToRes.length - 1, Math.max(c0, c1));
  for (let c = lo; c <= hi; c++) {
    const r = map.colToRes[c];
    if (r < 0) continue;
    if (s < 0) s = r;
    e = r;
  }
  return s < 0 ? null : { s, e };
}
