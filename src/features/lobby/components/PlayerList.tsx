import type { LobbyPlayer } from '../lobbyModel';
import { PlayerCard } from './PlayerCard';

interface PlayerListProps {
  players: readonly LobbyPlayer[] | undefined;
  capacity: number;
}

export function PlayerList({ players, capacity }: PlayerListProps) {
  const count = players?.length ?? 0;
  const freeSeats = Math.max(0, capacity - count);

  return (
    <section aria-labelledby="players-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="players-heading" className="font-display text-xl font-bold">
          Играчи
        </h2>
        <p className="font-display text-lg font-bold tabular-nums">
          <span className="text-brand-300">{count}</span>
          <span className="text-fg-subtle"> / {capacity}</span>
          <span className="sr-only"> играчи</span>
        </p>
      </div>

      {players === undefined ? (
        <p className="py-6 text-center text-sm text-fg-muted" role="status">
          Зареждане на играчите...
        </p>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2" aria-label="Играчи в стаята">
          {players.map((player) => (
            <PlayerCard key={player.id} player={player} />
          ))}
          {Array.from({ length: freeSeats }, (_, index) => (
            <li
              key={`free-${index}`}
              aria-hidden="true"
              className="hidden h-[4.25rem] items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-fg-subtle sm:flex"
            >
              Свободно място
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
