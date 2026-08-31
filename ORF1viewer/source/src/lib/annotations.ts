/**
 * Live annotation overlay for the catalogue.
 *
 * `manifest.json` is generated *from* the curated annotation CSV, so uploading a new
 * CSV alone would stay invisible until the payload is regenerated. Fetching the table
 * here and patching the catalogue with it makes the whole update procedure "upload the
 * CSV, reload the page": the domains (3D colours, MSA per-domain colouring, domain×domain
 * PAE table) and the metadata shown in the search bar come from the table, while the
 * manifest stays as the fallback whenever it is absent, unreachable or unreadable. The
 * viewer never blocks on it and never breaks because of it.
 */
import { currentDataUrl } from './dataSource';
import { DomainRange, ModelEntry } from './types';
import { fetchText } from './util';

/**
 * The curated annotation table inside the data root: ";"-delimited (CRLF), one row per
 * genbank protein, `border_<Domain>` columns holding "(start-end)". Point at another
 * table for one page load with `?annotations=metadata/other.csv` — or with a complete
 * `https://…` URL, which is fetched as-is.
 */
export const ANNOTATIONS_CSV = 'metadata/dataset_ORF1s_1178_reviewed_renumbered.csv';

/** colour for a domain the manifest palette does not know (table gained a column) */
const FALLBACK_COLOR = '#8b93a7';
/** accepted names for the protein-accession column, same rules as scripts/prepare_data.py */
const ID_KEYS = ['genbank', 'uniprot', 'accession', 'id'];

export interface Annotation {
  domains: DomainRange[];
  meta: Record<string, string>;
}

export interface AnnotationsInfo {
  /** table the catalogue was patched from, relative to the data root ('' = never fetched) */
  source: string;
  /** usable data rows in the table */
  rows: number;
  /** catalogue entries whose annotation was replaced */
  patched: number;
  /** catalogue entries in total */
  total: number;
}

export const NO_ANNOTATIONS: AnnotationsInfo = { source: '', rows: 0, patched: 0, total: 0 };

/** the table for this page load: `?annotations=` override, else the default above */
export function annotationsSource(): string {
  try {
    const q = new URLSearchParams(location.search).get('annotations');
    if (q && q.trim()) return q.trim();
  } catch {
    /* no location (worker / test) */
  }
  return ANNOTATIONS_CSV;
}

/**
 * Split one delimited record, honouring "…" quoted fields — host names such as
 * `"chicken; layer"` contain the delimiter itself, so a bare split would shift columns.
 */
function splitRecord(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Parse the annotation table into accession -> { domains, meta }.
 *
 * Every non-`border*` column becomes metadata (that is what the search index and the
 * search-bar summary read); `border_<Domain>` columns become domain ranges, coloured from
 * the manifest palette. Blank rows, unparsable ranges and unknown accessions are skipped
 * rather than fatal — the table is hand-edited.
 */
export function parseAnnotations(text: string, palette: { name: string; color: string }[] = []): Map<string, Annotation> {
  const out = new Map<string, Annotation>();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const head = lines.find((l) => l.trim().length > 0);
  if (!head) return out;
  const delim = head.includes(';') ? ';' : ',';
  const cols = splitRecord(head, delim).map((c) => c.trim());
  const iId = cols.findIndex((c) => ID_KEYS.includes(c.toLowerCase()));
  if (iId < 0) return out;
  const colorOf = new Map(palette.map((d) => [d.name, d.color]));
  for (let li = 1; li < lines.length; li++) {
    if (!lines[li].trim()) continue;
    const parts = splitRecord(lines[li], delim);
    const acc = (parts[iId] ?? '').trim();
    if (!acc) continue;
    const domains: DomainRange[] = [];
    const meta: Record<string, string> = {};
    for (let c = 0; c < cols.length; c++) {
      const key = cols[c];
      const val = (parts[c] ?? '').trim();
      if (!key) continue;
      if (!/^border/i.test(key)) {
        if (c !== iId && val) meta[key] = val;
        continue;
      }
      if (!val) continue;
      const name = (key.indexOf('_') >= 0 ? key.slice(key.indexOf('_') + 1) : key.slice(6)).trim() || key;
      const mm = /(\d+)\s*[-–]\s*(\d+)/.exec(val);
      if (!mm) continue;
      let s = Number(mm[1]);
      let e = Number(mm[2]);
      if (e < s) [s, e] = [e, s];
      domains.push({ name, start: s, end: e, color: colorOf.get(name) ?? FALLBACK_COLOR });
    }
    domains.sort((a, b) => a.start - b.start);
    out.set(acc, { domains, meta });
  }
  return out;
}

/**
 * Replace the domains + metadata of each catalogue entry with its table row, keyed by
 * genbank accession. Entries with no row keep the manifest annotation, so a partly
 * updated table is never a regression. Mutates the entries in place.
 */
export function applyAnnotations(models: ModelEntry[], ann: Map<string, Annotation>, source: string): AnnotationsInfo {
  const info: AnnotationsInfo = { source, rows: ann.size, patched: 0, total: models.length };
  if (!ann.size) return info;
  for (const m of models) {
    const row = ann.get(m.accession) ?? (m.meta?.genbank ? ann.get(String(m.meta.genbank).trim()) : undefined);
    if (!row) continue;
    m.domains = row.domains.map((d) => ({ ...d }));
    m.meta = { ...m.meta, ...row.meta };
    info.patched++;
  }
  return info;
}

/**
 * Fetch the table for this page load. Returns null when it cannot be read — never throws,
 * because the catalogue annotations from the manifest are perfectly usable on their own.
 */
export async function loadAnnotationsText(signal?: AbortSignal): Promise<{ source: string; text: string } | null> {
  const source = annotationsSource();
  try {
    const text = await fetchText(currentDataUrl(source), signal);
    return text && text.trim() ? { source, text } : null;
  } catch {
    return null;
  }
}
