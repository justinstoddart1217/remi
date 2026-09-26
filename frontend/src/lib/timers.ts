/**
 * Small timer helpers shared by the motion choreography (plan moves, drawer apply, arrival,
 * focus delays). Everything is cancellable so unmounts and repeats never leak callbacks.
 */

import { useEffect, useMemo } from 'react';

/** Resolves after `ms`. Rejects with an AbortError if `signal` aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(id);
      reject(abortError(signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError');
}

/** Runs `fn` after `ms`; returns a cancel function. */
export function after(ms: number, fn: () => void): () => void {
  const id = setTimeout(fn, ms);
  return () => {
    clearTimeout(id);
  };
}

/** Runs `fn` after two animation frames (the prototype's arrival trigger). */
export function afterTwoFrames(fn: () => void): () => void {
  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(fn);
  });
  return () => {
    cancelAnimationFrame(outer);
    if (inner) cancelAnimationFrame(inner);
  };
}

/**
 * Timers keyed by id: setting a key again clears its previous timer, so a repeat restarts
 * the countdown (the prototype's per-project `fT` / `mT` maps).
 */
export class KeyedTimers<K = string> {
  readonly #timers = new Map<K, { id: ReturnType<typeof setTimeout>; fn: () => void; due: number }>();
  #suspended: { key: K; fn: () => void; due: number }[] | null = null;

  set(key: K, ms: number, fn: () => void): void {
    this.clear(key);
    const id = setTimeout(() => {
      this.#timers.delete(key);
      fn();
    }, ms);
    this.#timers.set(key, { id, fn, due: Date.now() + ms });
  }

  clear(key: K): void {
    const timer = this.#timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer.id);
      this.#timers.delete(key);
    }
  }

  has(key: K): boolean {
    return this.#timers.has(key);
  }

  clearAll(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer.id);
    this.#timers.clear();
  }

  /** Cancels every timer but remembers it, so `resume` can re-arm it for its remaining time. */
  suspend(): void {
    this.#suspended = [...this.#timers.entries()].map(([key, t]) => ({ key, fn: t.fn, due: t.due }));
    this.clearAll();
  }

  /** Re-arms what `suspend` cancelled, unless the key was set again meanwhile. */
  resume(): void {
    const suspended = this.#suspended;
    this.#suspended = null;
    for (const t of suspended ?? []) {
      if (!this.#timers.has(t.key)) this.set(t.key, Math.max(0, t.due - Date.now()), t.fn);
    }
  }

  get size(): number {
    return this.#timers.size;
  }
}

/**
 * Timeouts owned by a component: `set` replaces the previous one for the same key and
 * everything is cancelled on unmount.
 *
 * The effect suspends the timers on cleanup and resumes them on setup. A real unmount never
 * resumes, so nothing fires after it. React StrictMode's simulated unmount and remount (dev
 * only) runs the cleanup and the setup back to back on the same instance; the timers then carry
 * on, so a timer armed in a layout effect that does not re-arm on the replay (Routines'
 * 1600ms row flash) still fires, as it does in production.
 */
export function useTimers<K = string>(): KeyedTimers<K> {
  const timers = useMemo(() => new KeyedTimers<K>(), []);
  useEffect(() => {
    timers.resume();
    return () => {
      timers.suspend();
    };
  }, [timers]);
  return timers;
}

/** A promise with its resolve function exposed. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  settled: () => boolean;
}

export function deferred<T = void>(): Deferred<T> {
  let done = false;
  let resolveFn: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (done) return;
      done = true;
      resolveFn(value);
    },
    settled: () => done,
  };
}
