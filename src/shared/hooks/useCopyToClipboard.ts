import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyStatus = 'idle' | 'copied' | 'failed';

const FEEDBACK_MS = 2_000;

/**
 * Clipboard API copy with short-lived feedback. When the API is unavailable or the
 * browser refuses (insecure context, permissions), status becomes `failed` so the UI
 * can ask the user to copy manually — the text must stay selectable.
 */
export function useCopyToClipboard() {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copy = useCallback(async (text: string) => {
    window.clearTimeout(timeoutRef.current);
    let next: CopyStatus = 'failed';
    try {
      if ('clipboard' in navigator) {
        await navigator.clipboard.writeText(text);
        next = 'copied';
      }
    } catch {
      next = 'failed';
    }
    setStatus(next);
    timeoutRef.current = window.setTimeout(() => {
      setStatus('idle');
    }, FEEDBACK_MS);
  }, []);

  return { status, copy };
}
