import { useState } from 'react';
import { Navigate, useParams } from 'react-router';

import { isValidRoomCode, normalizeRoomCodeInput, type GamePhase, type PlayerId } from '@/domain';
import { useAuthSession } from '@/features/auth/authContext';
import { GameScreen } from '@/features/game/GameScreen';
import { useRoomConnection } from '@/features/presence/useRoomConnection';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import type { RoomSummary } from '@/features/rooms/api/roomsApi';
import { JoinRoomForm } from '@/features/rooms/components/JoinRoomForm';
import { identityErrorMessage } from '@/features/rooms/copy';
import { useMemberRoom } from '@/features/rooms/hooks/useRoomQueries';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';

import { LobbyView } from './components/LobbyView';
import { RoomStateMessage } from './components/RoomStateMessage';
import { resolveRoomAccess } from './roomAccess';

/**
 * `/room/:code` — works on direct navigation and refresh:
 * identity → canonical code → membership → lobby (or join form for non-members).
 */
export function RoomPage() {
  const params = useParams<{ code: string }>();
  const rawCode = params.code ?? '';
  const code = normalizeRoomCodeInput(rawCode);
  const codeValid = isValidRoomCode(code);

  if (codeValid && rawCode !== code) {
    return <Navigate to={`/room/${code}`} replace />;
  }
  return <RoomGate key={code} code={code} codeValid={codeValid} />;
}

function RoomGate({ code, codeValid }: { code: string; codeValid: boolean }) {
  const auth = useAuthSession();
  const roomQuery = useMemberRoom(codeValid ? code : null);
  const access = resolveRoomAccess({
    codeValid,
    auth: auth.state,
    room: { data: roomQuery.data, error: roomQuery.error },
  });

  // Remember that this browser was a member, so losing the seat can be explained.
  const [wasMember, setWasMember] = useState(false);
  if (access.kind === 'member' && !wasMember) setWasMember(true);

  switch (access.kind) {
    case 'invalid_code':
      return (
        <RoomStateMessage title="Невалиден код">
          Кодът на стаята е от 5 знака — букви и цифри.
        </RoomStateMessage>
      );
    case 'identity_loading':
    case 'loading':
      return (
        <RoomStateMessage title="Свързване..." busy>
          {auth.slow ? 'Сървърът не отговаря. Опитваме отново...' : null}
        </RoomStateMessage>
      );
    case 'identity_error':
      return (
        <RoomStateMessage
          title={identityErrorMessage(access.reason)}
          action={
            access.reason !== 'not_configured' ? (
              <Button onClick={auth.retry}>Опитай отново</Button>
            ) : null
          }
        />
      );
    case 'error':
      return (
        <RoomStateMessage
          title="Неуспешно зареждане на стаята"
          action={<Button onClick={() => void roomQuery.refetch()}>Опитай отново</Button>}
        >
          {roomErrorMessage(access.code, 'join')}
        </RoomStateMessage>
      );
    case 'not_member':
      return <JoinThisRoom code={code} wasMember={wasMember} />;
    case 'member':
      // Narrowed: identity is ready whenever membership resolved.
      return auth.state.status === 'ready' ? (
        <RoomPhaseView room={access.room} playerId={auth.state.playerId} />
      ) : null;
  }
}

function JoinThisRoom({ code, wasMember }: { code: string; wasMember: boolean }) {
  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4">
      <div className="text-center">
        <p className="text-xs font-bold tracking-[0.3em] text-fg-subtle uppercase">Стая</p>
        <h1 className="text-gradient-brand font-display text-4xl font-black">{code}</h1>
      </div>
      {wasMember ? (
        <Notice tone="warning">
          Вече не си в тази стая — излезе от нея или връзката беше прекъсната твърде дълго. Можеш да
          влезеш отново.
        </Notice>
      ) : null}
      <div className="rounded-panel bg-ink-900/60 glass p-6 sm:p-8">
        <h2 className="mb-1 font-display text-xl font-bold">Влез в стаята</h2>
        <p className="mb-6 text-sm text-fg-muted">Избери име, с което другите да те виждат.</p>
        {/* Membership query refreshes on success; the page then renders the lobby. */}
        <JoinRoomForm fixedCode={code} onJoined={() => undefined} submitLabel="Влез в стаята" />
      </div>
    </section>
  );
}

/**
 * A confirmed member's view. The realtime channel, presence and heartbeat live here —
 * above the phase switch — so they persist unchanged across every game phase.
 * Every phase is handled explicitly so later iterations plug in without guesswork.
 */
function RoomPhaseView({ room, playerId }: { room: RoomSummary; playerId: PlayerId }) {
  const live = useRoomConnection(room.id, playerId);
  const phase: GamePhase = room.phase;
  switch (phase) {
    case 'LOBBY':
      return <LobbyView room={room} playerId={playerId} live={live} />;
    case 'ROUND_WAITING':
    case 'COUNTDOWN':
    case 'PLAYING':
    case 'ROUND_LOCKED':
    case 'RESULTS_READY':
    case 'AI_VALIDATING':
    case 'REVEAL':
    case 'RESULTS':
    case 'FINISHED':
      return <GameScreen room={room} playerId={playerId} live={live} />;
  }
}
