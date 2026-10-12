export async function verifyLoginSession(hasCookie: () => Promise<boolean>, verifyServer: () => Promise<unknown>): Promise<boolean> {
  if (!await hasCookie()) return false;
  try { await verifyServer(); return true; } catch { return false; }
}

/** Observe the session without copying credentials out of Electron. */
export function watchLogin(check: () => Promise<boolean>, complete: () => void): () => void {
  let stopped = false;
  let checking = false;
  const stop = () => { stopped = true; clearInterval(timer); };
  const timer = setInterval(() => {
    if (checking || stopped) return;
    checking = true;
    void check().then(loggedIn => {
      if (loggedIn && !stopped) { stop(); complete(); }
    }).catch(() => { /* A temporarily unavailable session can be checked again. */ })
      .finally(() => { checking = false; });
  }, 1000);
  return stop;
}
