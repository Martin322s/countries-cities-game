/**
 * Privacy-first error reporting boundary.
 *
 * The app never sends anything anywhere by default. An operator who wants production
 * error monitoring registers a sink (e.g. a small adapter for their provider) with
 * `setTelemetrySink` in `main.tsx`. Every report is sanitized first: no answers, no
 * player names, no room codes, no tokens, no URLs with room codes — only the error
 * kind, a scrubbed message and a coarse context.
 */
export type TelemetryKind =
  | 'render_error'
  | 'unhandled_error'
  | 'unhandled_rejection'
  | 'rpc_failure'
  | 'auth_failure'
  | 'realtime_failure';

export interface TelemetryEvent {
  kind: TelemetryKind;
  /** Scrubbed message (see sanitize). */
  message: string;
  /** Coarse, non-identifying context, e.g. the RPC name or the route pattern. */
  context?: string;
  /** Build identifier, so regressions can be tied to a deploy. */
  release: string;
}

export type TelemetrySink = (event: TelemetryEvent) => void;

let sink: TelemetrySink | null = null;
const RECENT_LIMIT = 20;
const recent = new Map<string, number>();

export function setTelemetrySink(next: TelemetrySink | null): void {
  sink = next;
}

/** Removes anything that could identify a player, a room or a session. */
export function sanitize(text: string): string {
  return (
    text
      // JWTs / bearer tokens / Supabase keys
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
      .replace(/\bsb_(publishable|secret)_[\w-]+/g, '[key]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [token]')
      // UUIDs (player, room, round ids)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
      // Room codes in paths, and anything in quotes (user text)
      .replace(/\/room\/[A-Za-z0-9]{1,10}/g, '/room/[code]')
      .replace(/(["'«„“])[^"'»“”]{1,200}(["'»“”])/g, '$1…$2')
      .slice(0, 300)
  );
}

export const RELEASE = `web-${import.meta.env.MODE}-1.0`;

/**
 * Reports an error to the registered sink (if any). Identical reports are throttled
 * (one per minute) so a broken loop cannot flood the provider. In development the
 * full error is also printed to the console.
 */
export function reportError(kind: TelemetryKind, error: unknown, context?: string): void {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const message = sanitize(raw);
  if (import.meta.env.DEV) console.error(`[${kind}]`, context ?? '', error);

  const key = `${kind}|${context ?? ''}|${message}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < 60_000) return;
  recent.set(key, now);
  if (recent.size > RECENT_LIMIT) {
    const oldest = recent.keys().next().value;
    if (oldest !== undefined) recent.delete(oldest);
  }

  try {
    sink?.({ kind, message, release: RELEASE, ...(context ? { context: sanitize(context) } : {}) });
  } catch {
    // A broken sink must never break the game.
  }
}

/** Installs window-level handlers once (called from main.tsx). */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    reportError('unhandled_error', event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError('unhandled_rejection', event.reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

/** Test helper. */
export function resetTelemetry(): void {
  sink = null;
  recent.clear();
}
