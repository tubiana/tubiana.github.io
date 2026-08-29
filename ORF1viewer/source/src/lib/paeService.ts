/** PAE access with worker → main-thread fallback. */
import { paeWorker } from './rpcWorker';
import { colorize, decodePaeImage, PaeMatrix, verifyPae } from './pae';

export interface PaeViewOptions {
  lut: Float32Array;
  mode: string; // colormap name or 'bands'
  scaleMax: number;
  muteHigh: boolean;
}

export async function decodePae(
  bytes: Uint8Array,
  format: string,
  id: string,
  url: string,
  view: PaeViewOptions,
  points: [number, number, number][],
  decoded: number[]
): Promise<PaeMatrix> {
  if (!paeWorker.unavailable) {
    try {
      const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const res = await paeWorker.call<{
        w: number;
        h: number;
        index: Uint8Array;
        rgba: Uint8ClampedArray;
        checks: PaeMatrix['checks'];
      }>(
        {
          kind: 'decode',
          bytes: raw,
          format,
          id,
          url,
          lut: view.lut,
          mode: view.mode,
          scaleMax: view.scaleMax,
          muteHigh: view.muteHigh,
          points,
          decoded,
        },
        [raw]
      );
      return {
        id,
        url,
        w: res.w,
        h: res.h,
        index: res.index,
        rgba: res.rgba,
        checks: res.checks,
        format,
      };
    } catch (e) {
      console.warn('PAE worker failed, decoding on the main thread', e);
    }
  }
  const m = await decodePaeImage(bytes, format, id, url);
  m.checks = verifyPae(m, view.lut, points, decoded);
  colorize(m, view);
  return m;
}

export async function recolorPae(m: PaeMatrix, view: PaeViewOptions): Promise<PaeMatrix> {
  if (!paeWorker.unavailable) {
    try {
      const indexCopy = new Uint8Array(m.index); // keep m.index intact, transfer the copy
      const indexBuf = indexCopy.buffer as ArrayBuffer;
      const res = await paeWorker.call<{ rgba: Uint8ClampedArray }>(
        {
          kind: 'colorize',
          id: m.id,
          w: m.w,
          h: m.h,
          index: indexBuf,
          lut: view.lut,
          mode: view.mode,
          scaleMax: view.scaleMax,
          muteHigh: view.muteHigh,
        },
        [indexBuf]
      );
      return { ...m, rgba: res.rgba };
    } catch (e) {
      console.warn('recolor in worker failed', e);
    }
  }
  const next = { ...m };
  colorize(next, view);
  return next;
}
