/**
 * ICTV Hepeviridae reference phylogeny: Newick parsing + the species/genus
 * annotations shown in the ICTV report figure (ictv.global/report/chapter/hepeviridae),
 * which are not encoded in the tree file itself.
 */

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
 * Species / genus / dot-colour lookup, transcribed from the ICTV Hepeviridae
 * report figure (OPSR.Hepe_.Fig5_.v4-01.png) since the .tree file only carries
 * leaf names and bootstrap values. Keyed by the leaf's genbank_nucl accession.
 */
export const ICTV_TAXONOMY: Record<string, TaxonInfo> = {
  M73218: { species: 'Paslahepevirus balayani', genus: 'Paslahepevirus', color: '#e11d2f' },
  KX578717: { species: 'Paslahepevirus balayani', genus: 'Paslahepevirus', color: '#e11d2f' },
  AB602441: { species: 'Paslahepevirus balayani', genus: 'Paslahepevirus', color: '#e11d2f' },
  AB573435: { species: 'Paslahepevirus balayani', genus: 'Paslahepevirus', color: '#e11d2f' },
  AB197673: { species: 'Paslahepevirus balayani', genus: 'Paslahepevirus', color: '#e11d2f' },
  KJ496143: { species: 'Paslahepevirus balayani', genus: 'Paslahepevirus', color: '#e11d2f' },
  AF082843: { species: 'Paslahepevirus balayani', genus: 'Paslahepevirus', color: '#e11d2f' },
  KX387866: { species: 'Paslahepevirus balayani', genus: 'Paslahepevirus', color: '#e11d2f' },
  KF951328: { species: 'Paslahepevirus alci', genus: 'Paslahepevirus', color: '#d946ef' },
  KR905549: UNASSIGNED, // tree shrew HEV — unclassified in the ICTV figure

  KM516906: { species: 'Rocahepevirus ratti', genus: 'Rocahepevirus', color: '#1d4ed8' },
  JN167538: { species: 'Rocahepevirus ratti', genus: 'Rocahepevirus', color: '#1d4ed8' },
  AB847307: { species: 'Rocahepevirus ratti', genus: 'Rocahepevirus', color: '#1d4ed8' },
  JX120573: { species: 'Rocahepevirus ratti', genus: 'Rocahepevirus', color: '#1d4ed8' },
  LC549186: { species: 'Rocahepevirus ratti', genus: 'Rocahepevirus', color: '#1d4ed8' },
  LC057247: { species: 'Rocahepevirus ratti', genus: 'Rocahepevirus', color: '#1d4ed8' },
  AB890374: { species: 'Rocahepevirus ratti', genus: 'Rocahepevirus', color: '#1d4ed8' },
  KY432900: { species: null, genus: 'Rocahepevirus', color: '#e5e7eb' },
  KY432903: { species: null, genus: 'Rocahepevirus', color: '#e5e7eb' },
  MG021328: { species: null, genus: 'Rocahepevirus', color: '#e5e7eb' },
  KY432901: { species: 'Rocahepevirus eothenomi', genus: 'Rocahepevirus', color: '#7dd3fc' },
  KY432904: { species: 'Rocahepevirus eothenomi', genus: 'Rocahepevirus', color: '#7dd3fc' },
  KY432905: { species: 'Rocahepevirus eothenomi', genus: 'Rocahepevirus', color: '#7dd3fc' },
  KY432902: { species: 'Rocahepevirus eothenomi', genus: 'Rocahepevirus', color: '#7dd3fc' },
  KU670940: { species: 'Rocahepevirus eothenomi', genus: 'Rocahepevirus', color: '#7dd3fc' },
  MK192405: { species: 'Rocahepevirus eothenomi', genus: 'Rocahepevirus', color: '#7dd3fc' },
  KY432899: { species: null, genus: 'Rocahepevirus', color: '#e5e7eb' },

  KX513953: { species: 'Chirohepevirus eptesici', genus: 'Chirohepevirus', color: '#22c55e' },
  JQ001749: { species: 'Chirohepevirus eptesici', genus: 'Chirohepevirus', color: '#22c55e' },
  MW249011: { species: 'Chirohepevirus desmodi', genus: 'Chirohepevirus', color: '#86efac' },
  KJ562187: { species: 'Chirohepevirus rhinolophi', genus: 'Chirohepevirus', color: '#166534' },

  KX589065: { species: 'Avihepevirus egretti', genus: 'Avihepevirus', color: '#f97316' },
  MG737712: { species: 'Avihepevirus magniiecur', genus: 'Avihepevirus', color: '#eab308' },
  AY535004: { species: 'Avihepevirus magniiecur', genus: 'Avihepevirus', color: '#eab308' },
  JN597006: { species: 'Avihepevirus magniiecur', genus: 'Avihepevirus', color: '#eab308' },
  MK050107: { species: 'Avihepevirus magniiecur', genus: 'Avihepevirus', color: '#eab308' },
  AM943646: { species: 'Avihepevirus magniiecur', genus: 'Avihepevirus', color: '#eab308' },
};

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
