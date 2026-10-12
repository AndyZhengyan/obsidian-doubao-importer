import { afterEach, expect, it, vi } from 'vitest';
import { verifyLoginSession, watchLogin } from '../src/login';

afterEach(() => { vi.useRealTimers(); });

it('closes the login window and refreshes state only after a logged-in session is detected', async () => {
  vi.useFakeTimers();
  let loggedIn = false;
  let closed = false;
  let completed = 0;
  const stop = watchLogin(async () => loggedIn, () => { closed = true; completed++; });
  await vi.advanceTimersByTimeAsync(1000);
  expect(closed).toBe(false);
  loggedIn = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(closed).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(completed).toBe(1);
  stop();
});

it('cancels login polling when the user closes or unloads the window', async () => {
  vi.useFakeTimers();
  let complete = false;
  const stop = watchLogin(async () => true, () => { complete = true; });
  stop();
  await vi.advanceTimersByTimeAsync(2000);
  expect(complete).toBe(false);
});

it('does not close a re-login window for a revoked session whose Cookie still exists', async () => {
  vi.useFakeTimers();
  let serverAccepts = false;
  let completed = 0;
  const stop = watchLogin(() => verifyLoginSession(async () => true, async () => {
    if (!serverAccepts) throw new Error('session revoked');
  }), () => { completed++; });
  await vi.advanceTimersByTimeAsync(2000);
  expect(completed).toBe(0);
  serverAccepts = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(completed).toBe(1);
  stop();
});
