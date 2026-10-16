import { useMemo } from 'react';

import {
  formatAwayCount,
  formatAwayDuration,
  summarizeActivity,
  type AwayInterval,
  type PlayerId,
  type RoomId,
  type RoundId,
} from '@/domain';
import { cn } from '@/shared/lib/cn';
import { EyeOffIcon } from '@/shared/ui/icons';

import { useAwayClock, useRoundActivity } from '../useRoundActivity';

interface ActivityPlayer {
  playerId: PlayerId;
  displayName: string;
}

export const ACTIVITY_DISCLAIMER =
  'Показва само кога страницата на играта е била скрита (друг таб или приложение, заключен телефон) — не и причината. Не влияе на точките.';

/**
 * "АКТИВНОСТ" during PLAYING: a small collapsible list of the round's meaningful
 * absences. Informational only — no score, no colours that suggest guilt.
 */
export function ActivityPanel({
  roomId,
  roundId,
  players,
  playerId,
}: {
  roomId: RoomId;
  roundId: RoundId;
  players: readonly ActivityPlayer[];
  playerId: PlayerId;
}) {
  const { data } = useRoundActivity(roomId, roundId);
  const intervals = data?.intervals ?? [];
  const openSince = intervals.find((interval) => interval.returnedAt === null)?.awayAt ?? null;
  const now = useAwayClock(openSince);
  const summaries = summarizeActivity(
    intervals,
    players.map((p) => p.playerId),
    now,
  );
  const shown = summaries.filter((s) => s.count > 0);
  const total = shown.reduce((sum, s) => sum + s.count, 0);

  return (
    <details className="group rounded-2xl border border-white/10 bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-xs font-bold tracking-[0.2em] text-fg-subtle uppercase focus-visible:outline-2 focus-visible:outline-brand-400 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <EyeOffIcon width={14} height={14} />
          Активност
          {total > 0 ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 tracking-normal text-fg-muted normal-case">
              {formatAwayCount(total)}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="px-4 pb-3">
        {!data ? (
          <p className="text-sm text-fg-muted">Зареждане...</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-fg-muted">Няма отчетени излизания в този рунд.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((summary) => (
              <li key={summary.playerId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-semibold">
                  {nameOf(players, summary.playerId)}
                  {summary.playerId === playerId ? (
                    <span className="ml-1 text-xs text-fg-subtle">(ти)</span>
                  ) : null}
                </span>
                <span className="text-fg-muted tabular-nums">
                  —{' '}
                  {summary.current?.meaningful
                    ? `извън играта сега · ${formatAwayDuration(summary.current.elapsedMs)}`
                    : `${formatAwayCount(summary.count)} · общо ${formatAwayDuration(summary.totalMs)}`}
                </span>
                {summary.current?.meaningful && summary.count > 1 ? (
                  <span className="text-xs text-fg-subtle tabular-nums">
                    ({formatAwayCount(summary.count)} · общо {formatAwayDuration(summary.totalMs)})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-fg-subtle">{ACTIVITY_DISCLAIMER}</p>
      </div>
    </details>
  );
}

/**
 * "АКТИВНОСТ ПРЕЗ РУНДА" under the results: per participant, how often and how long
 * their game page was hidden. Loaded for whichever round is shown (history included);
 * never part of the reveal animation and never mixed into scoring.
 */
export function RoundActivitySummary({
  roomId,
  roundId,
  players,
  immutable,
}: {
  roomId: RoomId;
  roundId: RoundId;
  players: readonly ActivityPlayer[];
  immutable: boolean;
}) {
  const { data, isError } = useRoundActivity(roomId, roundId, { immutable });
  // The answering window is over: every interval is closed (or ends at its cap).
  const now = useMemo(() => endOf(data?.intervals), [data]);
  const summaries = summarizeActivity(
    data?.intervals ?? [],
    players.map((p) => p.playerId),
    now,
  );
  const untilEnd = (id: PlayerId) =>
    data?.intervals.some((i) => i.playerId === id && i.endedBy === 'round_ended') ?? false;

  return (
    <details className="group rounded-panel border border-white/10 bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 text-xs font-bold tracking-[0.2em] text-fg-subtle uppercase focus-visible:outline-2 focus-visible:outline-brand-400 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <EyeOffIcon width={14} height={14} />
          Активност през рунда
        </span>
        <span aria-hidden="true" className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4">
        {isError ? (
          <p className="text-sm text-fg-muted">Активността не може да се зареди.</p>
        ) : !data ? (
          <p className="text-sm text-fg-muted">Зареждане...</p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {summaries.map((summary) => (
              <li
                key={summary.playerId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-xl bg-white/[0.03] px-3 py-2 text-sm"
              >
                <span className="font-semibold">{nameOf(players, summary.playerId)}</span>
                <span
                  className={cn('tabular-nums', summary.count > 0 ? 'text-fg' : 'text-fg-subtle')}
                >
                  {summary.count > 0
                    ? `${formatAwayCount(summary.count)} · ${formatAwayDuration(summary.totalMs)} общо${untilEnd(summary.playerId) ? ' · до края на рунда' : ''}`
                    : 'няма отчетени излизания'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-fg-subtle">{ACTIVITY_DISCLAIMER}</p>
      </div>
    </details>
  );
}

function nameOf(players: readonly ActivityPlayer[], playerId: PlayerId): string {
  return players.find((p) => p.playerId === playerId)?.displayName ?? '—';
}

/** A time after every interval's end, so durations are final. */
function endOf(intervals: readonly AwayInterval[] | undefined): number {
  let end = 0;
  for (const i of intervals ?? []) end = Math.max(end, i.returnedAt ?? i.capAt ?? i.awayAt);
  return end;
}
