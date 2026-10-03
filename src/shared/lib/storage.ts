/**
 * Best-effort localStorage access for per-browser conveniences (never for state that
 * must be correct). Private mode or blocked storage simply behaves like an empty store.
 */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore: storage is optional.
  }
}
