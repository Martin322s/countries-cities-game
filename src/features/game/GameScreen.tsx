import type { ReactNode } from 'react';

import { deriveRoundStage, REVEAL_DURATION_MS, type PlayerId, type RoundStage } from '@/domain';
import type { RoomConnection } from '@/features/presence/useRoomConnection';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import type { RoomSummary } from '@/features/rooms/api/roomsApi';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';

import { useServerNowAt } from './clock/useServerTime';
import { CountdownScreen } from './components/CountdownScreen';
import { AiValidationScreen } from './components/AiValidationScreen';
import { FinishedScreen } from './components/FinishedScreen';
import { GameFrame } from './components/GameFrame';
import { PlayingScreen } from './components/PlayingScreen';
import { PostRoundScreen } from './components/PostRoundScreen';
import { ResultsScreen } from './components/results/ResultsScreen';
import { RoundWaitingScreen } from './components/RoundWaitingScreen';
import { ScreenTransition } from './components/ScreenTransition';
import { useDeadlineNudge } from './hooks/useDeadlineNudge';
import { useGameState } from './hooks/useGameQueries';
import { isServerBehind } from './serverLag';

const SCREEN_GROUP: Record<RoundStage['kind'], string> = {
  lobby: 'lobby',
  waiting: 'waiting',
  countdown: 'countdown',
  playing: 'playing',
  time_up: 'playing',
  results_ready: 'results-ready',
  ai_validating: 'ai-validating',
  reveal: 'results',
  results: 'results',
  finished: 'finished',
};

interface GameScreenProps {
  room: RoomSummary;
  playerId: PlayerId;
  live: RoomConnection;
}

export function GameScreen({ room, playerId, live }: GameScreenProps) {
  const game = useGameState(room.id);
  const timeline = game.data?.round?.timeline ?? null;
  // Re-render exactly when the next timed stage begins: the countdown end, then the
  // answering deadline, then (during REVEAL) the end of the reveal.
  const revealEnd =
    game.data?.phase === 'REVEAL' && timeline?.revealAt != null
      ? timeline.revealAt + REVEAL_DURATION_MS
      : null;
  const now = useServerNowAt(timeline?.startedAt ?? null, revealEnd ?? timeline?.endsAt ?? null);
  const stage: RoundStage | null = game.data
    ? deriveRoundStage(game.data.phase, timeline, now)
    : null;
  useDeadlineNudge(room.id, game.data && stage ? isServerBehind(game.data, stage) : false);

  const isHost = room.hostPlayerId === playerId;
  // One transition per screen change (not per re-render): playing + time-up are one
  // screen, as are reveal + results.
  const screenKey = stage
    ? `${SCREEN_GROUP[stage.kind]}:${game.data?.round?.id ?? 'none'}`
    : 'loading';
  const frame = (content: ReactNode, wide = false) => (
    <GameFrame
      wide={wide}
      room={room}
      isHost={isHost}
      connection={live.connection}
      roundNumber={game.data?.round?.number ?? null}
    >
      {live.connection === 'offline' || live.connection === 'reconnecting' ? (
        <Notice tone="warning">
          Връзката прекъсна. Оставаш в играта — свързваме отново автоматично.
          {stage?.kind === 'playing'
            ? ' Отговорите ти се пазят и ще се изпратят, щом връзката се върне.'
            : ''}
        </Notice>
      ) : null}
      {game.data?.round?.validationTimedOut ? (
        <Notice tone="warning">
          AI проверката не приключи. Непотвърдените отговори са отбелязани като невалидни.
        </Notice>
      ) : null}
      <ScreenTransition screenKey={screenKey}>{content}</ScreenTransition>
    </GameFrame>
  );

  if (!game.data || !stage) {
    return frame(
      game.error ? (
        <Notice tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {roomErrorMessage(game.error.code, 'ready')}
            <Button variant="ghost" onClick={() => void game.refetch()}>
              Опитай отново
            </Button>
          </div>
        </Notice>
      ) : (
        <p role="status" className="py-16 text-center text-fg-muted">
          Зареждане на играта...
        </p>
      ),
    );
  }

  const { round, participants, progress, revealedRounds } = game.data;
  const isParticipant = participants.some((participant) => participant.playerId === playerId);
  // Players who came back after this round's snapshot sit it out (shown below).
  const sittingOut =
    !isParticipant &&
    (stage.kind === 'waiting' ||
      stage.kind === 'countdown' ||
      stage.kind === 'playing' ||
      stage.kind === 'time_up' ||
      stage.kind === 'results_ready' ||
      stage.kind === 'ai_validating');
  if (sittingOut) {
    return frame(
      <div className="flex flex-col items-center gap-3 rounded-panel bg-ink-900/40 glass p-8 text-center">
        <h1 className="font-display text-2xl font-black">Рунд {round?.number ?? ''} вече тече</h1>
        <p className="max-w-md text-fg-muted" role="status">
          Върна се, след като рундът започна, затова ще се включиш от следващия рунд. Точките ти от
          предишните рундове са запазени.
        </p>
      </div>,
    );
  }
  const shared = {
    roomId: room.id,
    playerId,
    hostPlayerId: room.hostPlayerId,
    participants,
    onlinePlayerIds: live.onlinePlayerIds,
  };

  switch (stage.kind) {
    case 'waiting':
      return frame(<RoundWaitingScreen {...shared} roundNumber={round?.number ?? 1} />);
    case 'countdown':
      return round && round.timeline.startedAt !== null
        ? frame(
            <CountdownScreen
              roundId={round.id}
              startedAt={round.timeline.startedAt}
              roundNumber={round.number}
            />,
          )
        : null;
    case 'playing':
    case 'time_up': {
      const { startedAt, endsAt } = round?.timeline ?? { startedAt: null, endsAt: null };
      if (!round || startedAt === null || endsAt === null) return null;
      return frame(
        <PlayingScreen
          {...shared}
          round={{ ...round, timeline: { ...round.timeline, startedAt, endsAt } }}
          timeUp={stage.kind === 'time_up'}
        />,
      );
    }
    case 'results_ready':
      return round ? frame(<PostRoundScreen {...shared} round={round} />) : null;
    case 'ai_validating':
      return round ? frame(<AiValidationScreen roomId={room.id} roundId={round.id} />) : null;
    case 'reveal':
    case 'results':
      return round
        ? frame(
            <ResultsScreen
              roomId={room.id}
              roundId={round.id}
              playerId={playerId}
              hostPlayerId={room.hostPlayerId}
              phase={game.data.phase}
              progress={progress}
              revealedRounds={revealedRounds}
            />,
            true,
          )
        : null;
    case 'finished':
      return round
        ? frame(
            <FinishedScreen
              roomId={room.id}
              roomCode={room.code}
              lastRoundId={round.id}
              playerId={playerId}
              hostPlayerId={room.hostPlayerId}
              progress={progress}
              revealedRounds={revealedRounds}
            />,
            true,
          )
        : null;
    case 'lobby':
      // Rendered by RoomPhaseView; transient while the room summary catches up.
      return null;
  }
}
