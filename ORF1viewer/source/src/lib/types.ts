/** Types mirroring public/data/manifest.json.gz produced by scripts/prepare_data.py */

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

  /** structure actually loaded by Mol* (backbone-only .pdb.gz unless only full was built) */
  pdbPath: string;
  scoresPath: string | null;
  accentuatedPaePath: string | null;
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
