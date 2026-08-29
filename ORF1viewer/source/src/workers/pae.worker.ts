/** Decodes + verifies + colourises a PAE matrix off the main thread. */
import { colorize, decodePaeImage, verifyPae, PaeMatrix } from '../lib/pae';

interface DecodeReq {
  reqId: number;
  kind: 'decode';
  bytes: ArrayBuffer;
  format: string;
  id: string;
  url: string;
  lut: Float32Array;
  mode: string;
  scaleMax: number;
  muteHigh: boolean;
  points?: [number, number, number][];
  decoded?: number[];
}

interface ColorReq {
  reqId: number;
  kind: 'colorize';
  id: string;
  w: number;
  h: number;
  index: ArrayBuffer;
  lut: Float32Array;
  mode: string;
  scaleMax: number;
  muteHigh: boolean;
}

type Req = DecodeReq | ColorReq;

function post(msg: Record<string, unknown>, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const data = ev.data;
  try {
    if (data.kind === 'colorize') {
      const { reqId, id, w, h, index: indexBuf, lut, mode, scaleMax, muteHigh } = data;
      const index = new Uint8Array(indexBuf);
      const m = { id, url: '', w, h, index, rgba: new Uint8ClampedArray(w * h * 4), checks: { n: 0, maxAbsErr: 0, ok: true }, format: '' } as PaeMatrix;
      const t0 = performance.now();
      colorize(m, { lut, mode, scaleMax, muteHigh });
      const rgba = m.rgba;
      post(
        { reqId, ok: true, rgba, msColor: performance.now() - t0 },
        [rgba.buffer as ArrayBuffer]
      );
      return;
    }

    const { reqId, bytes, format, id, url, lut, mode, scaleMax, muteHigh, points, decoded } = data;
    const t0 = performance.now();
    const m = await decodePaeImage(new Uint8Array(bytes), format, id, url);
    const tDecode = performance.now();
    m.checks = verifyPae(m, lut, points ?? [], decoded ?? []);
    colorize(m, { lut, mode, scaleMax, muteHigh });
    const tColor = performance.now();
    const index = m.index;
    const rgba = m.rgba;
    post(
      {
        reqId,
        ok: true,
        w: m.w,
        h: m.h,
        index,
        rgba,
        checks: m.checks,
        msDecode: tDecode - t0,
        msColor: tColor - tDecode,
      },
      [index.buffer as ArrayBuffer, rgba.buffer as ArrayBuffer]
    );
  } catch (err) {
    post({ reqId: (data as Req).reqId, ok: false, error: String(err) });
  }
};
