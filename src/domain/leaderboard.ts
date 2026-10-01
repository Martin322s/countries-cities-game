import type { PlayerId } from './ids';

export interface LeaderboardInput {
  playerId: PlayerId;
  displayName: string;
  /** Authoritative cumulative points (from the server). */
  totalPoints: number;
  /** Authoritative points of the round being shown; null if the player sat it out. */
  roundPoints: number | null;
  /** Stable participant order (join order) — used only to keep tied rows still. */
  order: number;
  left: boolean;
}

export interface LeaderboardEntry extends LeaderboardInput {
  /** Competition rank: equal totals share a rank and the next rank is skipped (1, 2, 2, 4). */
  rank: number;
  tied: boolean;
}

/**
 * Orders by total (desc) and assigns competition ranks. Ties are never broken into
 * different ranks; the stable participant order only decides the visual row order
 * among tied players.
 */
export function rankLeaderboard(entries: readonly LeaderboardInput[]): LeaderboardEntry[] {
  const sorted = [...entries].sort((a, b) => b.totalPoints - a.totalPoints || a.order - b.order);
  const counts = new Map<number, number>();
  for (const entry of sorted)
    counts.set(entry.totalPoints, (counts.get(entry.totalPoints) ?? 0) + 1);

  let previousTotal: number | null = null;
  let rank = 0;
  return sorted.map((entry, index) => {
    if (entry.totalPoints !== previousTotal) {
      rank = index + 1;
      previousTotal = entry.totalPoints;
    }
    return { ...entry, rank, tied: (counts.get(entry.totalPoints) ?? 0) > 1 };
  });
}
