import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** `navigator.onLine` — a hint only: `true` does not guarantee the server is reachable. */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
