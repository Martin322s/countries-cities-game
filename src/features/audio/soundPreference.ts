/**
 * Per-device sound preference ("Звук: включен / изключен"), kept in localStorage —
 * never on the server: each player controls their own speaker. Defaults to ON.
 * Storage failures (private mode, quota) fall back to the in-memory value.
 */
const STORAGE_KEY = 'darzhavi-i-gradove.sound';

let memory: boolean | null = null;
const listeners = new Set<() => void>();

export function readSoundEnabled(): boolean {
  if (memory !== null) return memory;
  try {
    memory = window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    memory = true;
  }
  return memory;
}

export function writeSoundEnabled(enabled: boolean): void {
  memory = enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Not persisted; the choice still applies for this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeSoundEnabled(listener: () => void): () => void {
  listeners.add(listener);
  // Other tabs of the same game follow the change.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    memory = event.newValue !== 'off';
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Test helper: forget the cached value. */
export function resetSoundPreferenceCache(): void {
  memory = null;
}
