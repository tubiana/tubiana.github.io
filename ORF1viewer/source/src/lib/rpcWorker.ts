import PaeWorkerCtor from '../workers/pae.worker?worker';
import MsaWorkerCtor from '../workers/msa.worker?worker';

/** Tiny promise-based RPC wrapper around a module worker. */
type Handler = (data: any) => void;

export class RpcWorker {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: Handler; reject: Handler }>();
  private make: () => Worker;
  private dead = false;

  constructor(make: () => Worker) {
    this.make = make;
  }

  private ensure(): Worker | null {
    if (this.dead) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = this.make();
      this.worker.onmessage = (ev: MessageEvent) => {
        const data = ev.data;
        const p = this.pending.get(data?.reqId);
        if (!p) return;
        this.pending.delete(data.reqId);
        if (data.ok) p.resolve(data);
        else p.reject(new Error(data.error ?? 'worker error'));
      };
      this.worker.onerror = (e) => {
        const err = new Error(`worker error: ${e.message}`);
        for (const [, p] of this.pending) p.reject(err);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
        this.dead = true; // fall back to main-thread execution
      };
      return this.worker;
    } catch (e) {
      this.dead = true;
      return null;
    }
  }

  get unavailable() {
    return this.dead;
  }

  call<T = any>(payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const w = this.ensure();
    if (!w) return Promise.reject(new Error('worker unavailable'));
    const reqId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      w.postMessage({ ...payload, reqId }, transfer);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export const paeWorker = new RpcWorker(() => new PaeWorkerCtor());
export const msaWorker = new RpcWorker(() => new MsaWorkerCtor());
