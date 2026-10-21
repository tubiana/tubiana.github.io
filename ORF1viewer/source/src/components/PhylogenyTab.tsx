/**
 * Tab "reference tree": the ICTV Hepeviridae phylogeny (Newick), rendered as an
 * SVG cladogram in the same style as the ICTV report figure — bootstrap values,
 * coloured tip dots, and species/genus bracket columns on the right. The leaf
 * that the current model clusters with (metadata/ICTV_ORF1s_clusters.csv) is
 * highlighted and auto-scrolled into view.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../state/store';
import { PanelLoading } from './AnalysisTabs';
import { ErrorBanner } from './ui';
import { displayLeafLabel, leafAccession, leavesOf, taxonOf, TreeNode } from '../lib/tree';

const ROW_H = 20;
const TREE_W = 190; // branch-drawing width
const LABEL_W = 230; // leaf-name text column
const SPECIES_W = 190;
const GENUS_W = 140;
const PAD = { l: 12, r: 16, t: 28, b: 12 };
const DOT_R = 3.5;

interface LayoutLeaf {
  node: TreeNode;
  y: number;
  x: number;
  accession: string;
}
interface LayoutEdge {
  x0: number;
  x1: number;
  y: number;
  support: number | null;
}
interface LayoutVEdge {
  x: number;
  yTop: number;
  yBot: number;
}
interface Layout {
  leaves: LayoutLeaf[];
  edges: LayoutEdge[];
  vedges: LayoutVEdge[];
  maxX: number;
  height: number;
}

/** Standard cladogram layout: x = cumulative branch length from the root, y = leaf order. */
function layoutTree(root: TreeNode): Layout {
  const leaves = leavesOf(root);
  const yOf = new Map<TreeNode, number>();
  leaves.forEach((leaf, i) => yOf.set(leaf, i * ROW_H + ROW_H / 2));

  const edges: LayoutEdge[] = [];
  const vedges: LayoutVEdge[] = [];
  const layoutLeaves: LayoutLeaf[] = [];
  let maxX = 0;

  // x position of each node = parent x + branch length (post-order won't work for x,
  // need pre-order top-down since x depends on ancestors' cumulative length)
  function walk(node: TreeNode, parentX: number): number {
    const x = parentX + node.length;
    maxX = Math.max(maxX, x);
    if (node.children.length === 0) {
      const y = yOf.get(node)!;
      layoutLeaves.push({ node, y, x, accession: node.name ? leafAccession(node.name) : '' });
      edges.push({ x0: parentX, x1: x, y, support: null });
      return y;
    }
    const childYs = node.children.map((c) => walk(c, x));
    const yMin = Math.min(...childYs);
    const yMax = Math.max(...childYs);
    const yMid = (yMin + yMax) / 2;
    edges.push({ x0: parentX, x1: x, y: yMid, support: node.support });
    vedges.push({ x, yTop: yMin, yBot: yMax });
    return yMid;
  }
  walk(root, 0);

  return { leaves: layoutLeaves, edges, vedges, maxX, height: leaves.length * ROW_H };
}

/** Contiguous same-taxon leaf runs (in display order) become one bracket + label. */
function bracketRuns(leaves: LayoutLeaf[], key: 'species' | 'genus') {
  const runs: { label: string; y0: number; y1: number }[] = [];
  for (const leaf of leaves) {
    const info = taxonOf(leaf.accession);
    const label = info[key];
    if (!label) continue;
    const last = runs[runs.length - 1];
    if (last && last.label === label && last.y1 === leaf.y - ROW_H) {
      last.y1 = leaf.y;
    } else {
      runs.push({ label, y0: leaf.y, y1: leaf.y });
    }
  }
  return runs;
}

export function PhylogenyTab() {
  const status = useStore((s) => s.status.tree);
  const tree = useStore((s) => s.tree);
  const clusters = useStore((s) => s.clusters);
  const model = useStore((s) => s.model);
  const loadTree = useStore((s) => s.loadTree);
  const error = useStore((s) => s.error);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const layout = useMemo(() => (tree ? layoutTree(tree) : null), [tree]);
  const speciesRuns = useMemo(() => (layout ? bracketRuns(layout.leaves, 'species') : []), [layout]);
  const genusRuns = useMemo(() => (layout ? bracketRuns(layout.leaves, 'genus') : []), [layout]);

  const clusterRow = model ? clusters?.get(model.id) : undefined;
  const highlightAccession = clusterRow?.nodeNucl || null;

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightAccession, layout]);

  if (status === 'loading' || status === 'idle') return <PanelLoading label="loading reference phylogeny…" />;
  if (status === 'error' || !tree || !layout) {
    return (
      <div className="p-3">
        <ErrorBanner message={error ?? 'could not load the reference tree'} />
      </div>
    );
  }

  const xScale = (TREE_W - 12) / Math.max(layout.maxX, 1e-6);
  const plotX = (x: number) => PAD.l + x * xScale;
  const labelX = PAD.l + TREE_W; // fixed start for every leaf dot + name, regardless of branch depth
  const width = PAD.l + TREE_W + LABEL_W + SPECIES_W + GENUS_W + PAD.r;
  const height = PAD.t + layout.height + PAD.b;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-[12.5px]">
        <span className="font-semibold">ICTV Hepeviridae reference tree</span>
        <span className="text-muted">{layout.leaves.length} reference sequences</span>
        {model && (
          <span className="ml-auto text-muted">
            {clusterRow ? (
              <>
                This model is closest to <b className="text-fg">{clusterRow.nodeNucl}</b>, {fmtPct(clusterRow.pctId)}% identity
              </>
            ) : (
              'This model has no reference assignment'
            )}
          </span>
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto border-t border-line">
        <svg width={width} height={height} className="block" style={{ minWidth: width }}>
          <text x={PAD.l} y={16} fill="var(--muted)" style={{ font: '600 11.5px var(--font-sans)' }}>
            reference sequences
          </text>
          <text
            x={labelX + LABEL_W + SPECIES_W / 2}
            y={16}
            textAnchor="middle"
            fill="var(--muted)"
            style={{ font: '600 11.5px var(--font-sans)', fontStyle: 'italic' }}
          >
            species
          </text>
          <text
            x={labelX + LABEL_W + SPECIES_W + GENUS_W / 2}
            y={16}
            textAnchor="middle"
            fill="var(--muted)"
            style={{ font: '600 11.5px var(--font-sans)', fontStyle: 'italic' }}
          >
            genus
          </text>

          <g transform={`translate(0, ${PAD.t})`}>
            {/* branches */}
            {layout.edges.map((e, i) => (
              <line
                key={`e${i}`}
                x1={plotX(e.x0)}
                x2={plotX(e.x1)}
                y1={e.y}
                y2={e.y}
                stroke="var(--line-strong)"
                strokeWidth={1.2}
              />
            ))}
            {layout.vedges.map((v, i) => (
              <line
                key={`v${i}`}
                x1={plotX(v.x)}
                x2={plotX(v.x)}
                y1={v.yTop}
                y2={v.yBot}
                stroke="var(--line-strong)"
                strokeWidth={1.2}
              />
            ))}
            {/* bootstrap support values, small and unobtrusive */}
            {layout.edges
              .filter((e) => e.support != null)
              .map((e, i) => (
                <text
                  key={`s${i}`}
                  x={plotX(e.x0) - 3}
                  y={e.y - 3}
                  textAnchor="end"
                  fill="var(--faint)"
                  style={{ font: '10px var(--font-sans)' }}
                >
                  {e.support}
                </text>
              ))}

            {/* leaves: dot + label, aligned to a fixed column with a thin dotted extension
                from the true branch tip (matches the ICTV figure convention) */}
            {layout.leaves.map((leaf, i) => {
              const info = taxonOf(leaf.accession);
              const isHighlighted = highlightAccession != null && leaf.accession === highlightAccession;
              const tipX = plotX(leaf.x);
              return (
                <g
                  key={i}
                  ref={isHighlighted ? highlightRef : undefined}
                  transform={`translate(0, ${leaf.y})`}
                >
                  {isHighlighted && (
                    <rect
                      x={0}
                      y={-ROW_H / 2}
                      width={width}
                      height={ROW_H}
                      fill="var(--sel-fill)"
                    />
                  )}
                  {tipX < labelX - 2 && (
                    <line
                      x1={tipX}
                      x2={labelX}
                      y1={0}
                      y2={0}
                      stroke="var(--line)"
                      strokeDasharray="1.5,2"
                      strokeWidth={1}
                    />
                  )}
                  <circle
                    cx={labelX}
                    cy={0}
                    r={DOT_R}
                    fill={info.color}
                    stroke={info.color === '#e5e7eb' ? 'var(--faint)' : 'none'}
                    strokeWidth={1}
                  />
                  <text
                    x={labelX + 8}
                    y={3.5}
                    fill={isHighlighted ? 'var(--fg)' : 'var(--muted)'}
                    style={{ font: isHighlighted ? '700 12px var(--font-sans)' : '12px var(--font-sans)' }}
                  >
                    {leaf.node.name ? displayLeafLabel(leaf.node.name) : ''}
                  </text>
                </g>
              );
            })}

            {/* species / genus bracket columns, ICTV-report style */}
            {speciesRuns.map((r, i) => (
              <BracketColumn key={`sp${i}`} x={labelX + LABEL_W + 10} run={r} italic />
            ))}
            {genusRuns.map((r, i) => (
              <BracketColumn key={`ge${i}`} x={labelX + LABEL_W + SPECIES_W + 10} run={r} italic />
            ))}
          </g>
        </svg>
      </div>
      <div className="shrink-0 border-t border-line px-4 py-2 text-[12px] text-muted">
        Topology, taxa and dot colours follow the{' '}
        <a
          href="https://ictv.global/report/chapter/hepeviridae/hepeviridae"
          target="_blank"
          rel="noreferrer"
          className="text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg"
        >
          ICTV Hepeviridae report
        </a>
        .
      </div>
    </div>
  );
}

function BracketColumn({ x, run, italic }: { x: number; run: { label: string; y0: number; y1: number }; italic?: boolean }) {
  const yMid = (run.y0 + run.y1) / 2;
  const single = run.y0 === run.y1;
  return (
    <g>
      <line x1={x} x2={x} y1={run.y0 - ROW_H / 2 + 2} y2={run.y1 + ROW_H / 2 - 2} stroke="var(--line-strong)" strokeWidth={1.2} />
      <text
        x={x + 8}
        y={yMid + 3.5}
        fill="var(--fg)"
        style={{ font: `${italic ? 'italic ' : ''}12px var(--font-sans)` }}
      >
        {run.label}
      </text>
      {single && null}
    </g>
  );
}

function fmtPct(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '—';
}
