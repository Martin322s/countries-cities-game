import type { SoundId } from './sounds';

/**
 * A sound tied to a game event. `key` is the event's identity — room/round + event
 * type + boundary, e.g. `round:<id>:countdown:3`, `round:<id>:category:city`,
 * `room:<id>:finished` — never a timestamp alone.
 */
export interface Cue {
  key: string;
  sound: SoundId;
  /**
   * Server time (epoch ms) of the event boundary, when there is one. A cue that
   * arrives later than `maxAgeMs` after it is dropped: a refresh, a resumed tab or a
   * late refetch never replays or dumps old sounds.
   */
  at?: number;
  maxAgeMs?: number;
}

export type CueDecision =
  | 'play'
  /** This event already had its chance (played or deliberately skipped). */
  | 'duplicate'
  /** The moment has passed (refresh, background tab, late data). */
  | 'stale'
  /** The page is hidden — no sounds in the background, and none replayed later. */
  | 'hidden'
  /** The player turned sound off. */
  | 'muted'
  /** No user gesture yet (autoplay rules) or audio unsupported. */
  | 'unavailable';

/** Default freshness: under one timer second, so a resumed tab never replays a tick. */
export const DEFAULT_CUE_MAX_AGE_MS = 900;
const MAX_REMEMBERED = 400;

export interface CueContext {
  now: number;
  visible: boolean;
  enabled: boolean;
  available: boolean;
}

/**
 * Decides whether a cue plays. Every event gets exactly one decision: whatever the
 * outcome, its key is remembered, so re-renders, StrictMode double effects, query
 * refetches and realtime echoes can never play it again.
 */
export class CueGate {
  private readonly seen = new Set<string>();

  decide(cue: Cue, context: CueContext): CueDecision {
    if (this.seen.has(cue.key)) return 'duplicate';
    this.remember(cue.key);
    if (cue.at !== undefined && context.now - cue.at > (cue.maxAgeMs ?? DEFAULT_CUE_MAX_AGE_MS)) {
      return 'stale';
    }
    if (!context.visible) return 'hidden';
    if (!context.enabled) return 'muted';
    if (!context.available) return 'unavailable';
    return 'play';
  }

  private remember(key: string): void {
    this.seen.add(key);
    if (this.seen.size > MAX_REMEMBERED) {
      // Oldest first (insertion order): old rounds' events can be forgotten.
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }
}
