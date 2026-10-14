const STORAGE_PREFIX = 'darzhavi-i-gradove.celebrated:';

/**
 * One celebration per game per browser session: true the first time it is asked for
 * `gameKey`, false afterwards (refresh, re-render, refetch). Without sessionStorage it
 * still never repeats within the page's lifetime.
 */
const claimedInMemory = new Set<string>();
export function claimCelebration(
  gameKey: string,
  storage: Storage | null = safeSession(),
): boolean {
  if (claimedInMemory.has(gameKey)) return false;
  claimedInMemory.add(gameKey);
  try {
    if (storage?.getItem(STORAGE_PREFIX + gameKey)) return false;
    storage?.setItem(STORAGE_PREFIX + gameKey, '1');
  } catch {
    // Storage unavailable: the in-memory guard is enough.
  }
  return true;
}

function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Test helper. */
export function resetCelebrations(): void {
  claimedInMemory.clear();
}
