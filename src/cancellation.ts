export function abortError(): Error { return new DOMException('同步已取消', 'AbortError'); }

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Observe cancellation even when Electron does not settle an interrupted navigation. */
export function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { cleanup(); reject(abortError()); };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) aborted();
  });
}

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
