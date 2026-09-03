/** Types mirroring public/data/manifest.json.gz produced by scripts/update_dataset.py */

export interface DomainRange {
  name: string;
  start: number; // 1-based, inclusive
  end: number; // 1-based, inclusive
  color: string;
}

export interface DomainStat extends DomainRange {
  meanPae: number;
  meanPlddt: number | null;
}

export interface ModelMeta {
  genbank_nucl?: string;
  generic_hostname?: string;
  Genogroupe?: string;
  sequence_size?: string;
  species_y?: string;
  host?: string;
  organism?: string;
  strain?: string;
  isolate?: string;
  [k: string]: string | undefined;
}

export interface ModelEntry {
  id: string;
  name: string;
  accession: string;
  length: number;
  csvLength: number;
  meanPlddt: number | null;
  pctPlddtLt50: number | null;
  pTM: number | null;
  maxPae: number;
  meanPae: number;
  host: string;
  meta: ModelMeta;
  domains: DomainRange[];
  domainStats: DomainStat[];

  /** the structure Mol* loads: full-atom .pdb.gz (payloads that also ship a backbone-only
   *  reduction point here instead — the viewer does not care which) */
  pdbPath: string;
  scoresPath: string | null;
  accentuatedPaePath: string | null;
  /** same file as pdbPath in the current payload; older payloads had the full-atom copy separate */
  pdbFullPath: string | null;
  pdbSourcePath: string;
  paePath: string;
  paeFormat: 'png' | 'webp' | 'bin' | string;
  paeW: number;
  paeH: number;
  plddtPath: string;
  msaName: string;
  verify: { lutName: string; points: [number, number, number][]; decoded: number[] };
}

export interface Manifest {
  schema: number;
  generatedAt: string;
  source: string;
  counts: { models: number; failed: number };
  pae: {
    format: string;
    lutName: string;
    lut: number[];
    maxErrorA?: number;
    unit: string;
    note?: string;
  };
  domains: { name: string; color: string }[];
  hosts: string[];
  msa?: { path: string | null; sequences: number; columns: number };
  models: ModelEntry[];
}

export type LoadPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface LoadStatus {
  structure: LoadPhase;
  pae: LoadPhase;
  plddt: LoadPhase;
  error?: string;
}
