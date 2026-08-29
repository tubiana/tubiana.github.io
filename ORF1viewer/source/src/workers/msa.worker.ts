/** Parses a (gzipped-then-inflated) Clustal alignment off the main thread. */
import { parseClustal } from '../lib/msa';

interface Req {
  reqId: number;
  bytes: ArrayBuffer;
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { reqId, bytes } = ev.data;
  try {
    const t0 = performance.now();
    const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
    const tDecode = performance.now();
    const m = parseClustal(text);
    const tParse = performance.now();
    (self as unknown as Worker).postMessage({
      reqId,
      ok: true,
      names: m.names,
      rows: m.rows,
      columns: m.columns,
      blockWidth: m.blockWidth,
      conservation: m.conservation,
      gaps: m.gaps,
      indexByName: m.indexByName,
      msDecode: tDecode - t0,
      msParse: tParse - tDecode,
      rawChars: text.length,
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({ reqId, ok: false, error: String(err) });
  }
};
