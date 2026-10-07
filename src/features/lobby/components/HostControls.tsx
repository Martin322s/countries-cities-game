import { MIN_PLAYERS, type RoomId } from '@/domain';
import { useStartGame } from '@/features/game/hooks/useGameQueries';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';

interface HostControlsProps {
  roomId: RoomId;
  isHost: boolean;
  playerCount: number;
}

/**
 * Host-only actions. "ПОДГОТВИ ИГРАТА" calls `start_game`; the server re-checks host
 * role, phase and player count, so this button is a convenience, not the authority.
 * Every client then follows the phase change through realtime.
 */
export function HostControls({ roomId, isHost, playerCount }: HostControlsProps) {
  const start = useStartGame(roomId);

  if (!isHost) {
    return (
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <p className="font-display text-lg font-bold text-fg">
          Изчакваме хоста<span className="animate-pulse">...</span>
        </p>
        <p className="text-sm text-fg-muted">Хостът ще подготви играта, когато всички са тук.</p>
      </div>
    );
  }

  const enoughPlayers = playerCount >= MIN_PLAYERS;
  // A double click that loses the race is not an error for the player.
  const error = start.error && start.error.code !== 'game_already_started' ? start.error : null;

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Button
        size="lg"
        disabled={!enoughPlayers || start.isPending}
        aria-busy={start.isPending}
        className="w-full sm:w-auto"
        aria-describedby="host-start-help"
        onClick={() => {
          start.mutate(undefined);
        }}
      >
        {start.isPending ? 'Подготвяне...' : 'ПОДГОТВИ ИГРАТА'}
      </Button>
      {error ? <Notice tone="error">{roomErrorMessage(error.code, 'start')}</Notice> : null}
      <p id="host-start-help" className="max-w-sm text-sm text-fg-muted">
        {enoughPlayers
          ? 'Когато всички са тук, започни играта. Нови играчи няма да могат да влизат след това.'
          : `Изчакваме играчите... Нужни са поне ${MIN_PLAYERS} играчи.`}
      </p>
    </div>
  );
}
