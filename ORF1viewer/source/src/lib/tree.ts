/**
 * ICTV Hepeviridae reference phylogeny: Newick parsing + the species/genus
 * annotations shown in the ICTV report figure (ictv.global/report/chapter/hepeviridae),
 * which are not encoded in the tree file itself. The species/genus/colour lookup
 * lives in `ictv_taxonomy.csv` (same folder) so it can be edited without touching
 * this file, e.g. if the reference tree changes later.
 */
import taxonomyCsv from './ictv_taxonomy.csv?raw';

export interface TreeNode {
  name: string | null; // leaf label (e.g. "M73218_hepatitis_E_virus_1a"), null for internal nodes
  support: number | null; // bootstrap value on internal nodes
  length: number; // branch length leading to this node
  children: TreeNode[];
}

/** Minimal recursive-descent Newick parser (supports names, branch lengths, internal-node labels). */
export function parseNewick(text: string): TreeNode {
  const s = text.trim();
  let i = 0;

  function parseNode(): TreeNode {
    if (s[i] === '(') {
      i++; // consume '('
      const children: TreeNode[] = [];
      children.push(parseNode());
      while (s[i] === ',') {
        i++;
        children.push(parseNode());
      }
      if (s[i] !== ')') throw new Error(`Newick parse error at ${i}: expected ')'`);
      i++; // consume ')'
      const label = parseLabel();
      const length = parseLength();
      const support = label ? Number(label) : null;
      return { name: null, support: support != null && !Number.isNaN(support) ? support : null, length, children };
    }
    const name = parseLabel();
    const length = parseLength();
    return { name: name || null, support: null, length, children: [] };
  }

  function parseLabel(): string {
    const start = i;
    while (i < s.length && !',()[;:'.includes(s[i])) i++;
    return s.slice(start, i);
  }

  function parseLength(): number {
    if (s[i] !== ':') return 0;
    i++;
    const start = i;
    while (i < s.length && !',()[;'.includes(s[i])) i++;
    const v = Number(s.slice(start, i));
    return Number.isFinite(v) ? v : 0;
  }

  const root = parseNode();
  return root;
}

/** Flat list of every leaf under a node, in left-to-right (display) order. */
export function leavesOf(node: TreeNode): TreeNode[] {
  if (node.children.length === 0) return [node];
  return node.children.flatMap(leavesOf);
}

/** genbank_nucl accession embedded at the start of each leaf label, e.g. "M73218" from "M73218_hepatitis_E_virus_1a". */
export function leafAccession(name: string): string {
  return name.split('_')[0];
}

export interface TaxonInfo {
  species: string | null;
  genus: string | null;
  color: string; // dot colour, matches the ICTV figure legend
}

const UNASSIGNED: TaxonInfo = { species: null, genus: null, color: '#e5e7eb' };

/**
 * Species / genus / dot-colour lookup, parsed from `ictv_taxonomy.csv` (transcribed
 * from the ICTV Hepeviridae report figure, OPSR.Hepe_.Fig5_.v4-01.png, since the
 * .tree file only carries leaf names and bootstrap values). Keyed by the leaf's
 * genbank_nucl accession. Edit the CSV file to add/change entries, e.g. if the
 * reference tree is updated later — no code changes needed.
 */
function parseTaxonomyCsv(text: string): Record<string, TaxonInfo> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const table: Record<string, TaxonInfo> = {};
  if (!lines.length) return table;
  const header = lines[0].split(';');
  const col = (name: string) => header.indexOf(name);
  const iAcc = col('accession');
  const iSpecies = col('species');
  const iGenus = col('genus');
  const iColor = col('color');
  for (let li = 1; li < lines.length; li++) {
    const parts = lines[li].split(';');
    const accession = parts[iAcc];
    if (!accession) continue;
    const species = parts[iSpecies]?.trim() || null;
    const genus = parts[iGenus]?.trim() || null;
    const color = parts[iColor]?.trim() || UNASSIGNED.color;
    table[accession] = { species, genus, color };
  }
  return table;
}

export const ICTV_TAXONOMY: Record<string, TaxonInfo> = parseTaxonomyCsv(taxonomyCsv);


export function taxonOf(accession: string): TaxonInfo {
  return ICTV_TAXONOMY[accession] ?? UNASSIGNED;
}

/** A friendlier display label, e.g. "M73218 hepatitis E virus 1a". */
export function displayLeafLabel(name: string): string {
  return name.replace(/_/g, ' ');
}

// ---------------------------------------------------------------- clusters CSV

export interface ClusterRow {
  seqId: string;
  genbank: string;
  genbankNucl: string;
  node: string;
  nodeNucl: string;
  pctId: number;
}

/** `metadata/ICTV_ORF1s_clusters.csv`: semicolon-delimited, header on row 1. */
export function parseClusters(text: string): Map<string, ClusterRow> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const map = new Map<string, ClusterRow>();
  if (!lines.length) return map;
  const header = lines[0].split(';');
  const col = (name: string) => header.indexOf(name);
  const iSeq = col('seq_id');
  const iGb = col('genbank');
  const iGbNucl = col('genbank_nucl');
  const iNode = col('node');
  const iNodeNucl = col('node_nucl');
  const iPct = col('pct_id');
  for (let li = 1; li < lines.length; li++) {
    const parts = lines[li].split(';');
    const seqId = parts[iSeq];
    if (!seqId) continue;
    map.set(seqId, {
      seqId,
      genbank: parts[iGb] ?? '',
      genbankNucl: parts[iGbNucl] ?? '',
      node: parts[iNode] ?? '',
      nodeNucl: parts[iNodeNucl] ?? '',
      pctId: Number(parts[iPct]),
    });
  }
  return map;
}
