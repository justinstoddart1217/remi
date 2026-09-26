/** Wraps a save's promise: shows the failure toast and hands the promise back to the field. */
export type Guard = <T>(p: Promise<T>) => Promise<T>;
