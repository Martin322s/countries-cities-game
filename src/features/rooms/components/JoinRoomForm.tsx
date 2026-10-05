import { useState, type SubmitEvent } from 'react';

import {
  DISPLAY_NAME_MAX_LENGTH,
  isValidRoomCode,
  normalizeRoomCodeInput,
  ROOM_CODE_LENGTH,
  validateDisplayName,
} from '@/domain';
import { useIdentityGate } from '@/features/auth/authContext';
import { readLocal } from '@/shared/lib/storage';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';
import { TextField } from '@/shared/ui/TextField';

import { roomErrorMessage, type RoomErrorCode } from '../api/roomErrors';
import { displayNameErrorMessage, ROOM_CODE_ERROR_MESSAGE } from '../copy';
import { LAST_DISPLAY_NAME_KEY, useJoinRoom } from '../hooks/useRoomMutations';
import { IdentityStatus } from './IdentityStatus';

type ErrorTarget = 'code' | 'name' | 'form';

function errorTarget(code: RoomErrorCode): ErrorTarget {
  switch (code) {
    case 'invalid_room_code':
    case 'room_not_found':
      return 'code';
    case 'display_name_taken':
    case 'invalid_display_name':
      return 'name';
    case 'room_full':
    case 'room_finished':
    case 'game_in_progress':
    case 'invalid_capacity':
    case 'not_member':
    case 'not_authenticated':
    case 'room_code_unavailable':
    case 'network':
    case 'unknown':
    case 'not_host':
    case 'game_already_started':
    case 'not_enough_players':
    case 'not_participant':
    case 'wrong_phase':
    case 'round_not_active':
    case 'round_over':
    case 'answers_locked':
    case 'invalid_answers':
    case 'invalid_category':
    case 'answer_too_long':
    case 'results_not_available':
    case 'answer_empty':
    case 'round_already_started':
    case 'no_letters_left':
    case 'letters_remaining':
    case 'game_finished':
    case 'rate_limited':
    case 'payload_too_large':
      return 'form';
  }
}

interface JoinRoomFormProps {
  /** Pre-selected room (deep link). When set, the code field is hidden. */
  fixedCode?: string;
  onJoined: (code: string) => void;
  submitLabel?: string;
}

export function JoinRoomForm({ fixedCode, onJoined, submitLabel = 'Влез' }: JoinRoomFormProps) {
  const [roomCode, setRoomCode] = useState(fixedCode ?? '');
  const [displayName, setDisplayName] = useState(() => readLocal(LAST_DISPLAY_NAME_KEY) ?? '');
  const [submitted, setSubmitted] = useState(false);
  const join = useJoinRoom();
  const identity = useIdentityGate();

  const codeValid = isValidRoomCode(roomCode);
  const nameError = validateDisplayName(displayName);
  const serverError = join.error ? join.error.code : null;
  const serverMessage = serverError ? roomErrorMessage(serverError, 'join') : null;
  const target = serverError ? errorTarget(serverError) : null;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!codeValid || nameError || !identity.ready || join.isPending) return;
    join.mutate(
      { code: roomCode, displayName },
      {
        onSuccess: (code) => {
          onJoined(code);
        },
      },
    );
  };

  const codeFieldError =
    (submitted && !codeValid ? ROOM_CODE_ERROR_MESSAGE : null) ??
    (target === 'code' ? serverMessage : null);
  const nameFieldError =
    (submitted && nameError ? displayNameErrorMessage(nameError) : null) ??
    (target === 'name' ? serverMessage : null);

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
      {fixedCode === undefined ? (
        <TextField
          label="Код на стаята"
          name="roomCode"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          placeholder={'X'.repeat(ROOM_CODE_LENGTH)}
          value={roomCode}
          onChange={(event) => {
            setRoomCode(normalizeRoomCodeInput(event.target.value));
            join.reset();
          }}
          className="text-center font-display text-2xl tracking-[0.4em] uppercase"
          error={codeFieldError}
        />
      ) : codeFieldError ? (
        <Notice tone="error">{codeFieldError}</Notice>
      ) : null}
      <TextField
        label="Твоето име"
        name="displayName"
        autoComplete="nickname"
        maxLength={DISPLAY_NAME_MAX_LENGTH * 2}
        placeholder="напр. Деси"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
          join.reset();
        }}
        error={nameFieldError}
      />
      <IdentityStatus />
      {target === 'form' && serverMessage ? <Notice tone="error">{serverMessage}</Notice> : null}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!identity.ready || join.isPending}
        aria-busy={join.isPending}
      >
        {identity.connecting ? 'Свързване...' : join.isPending ? 'Влизане...' : submitLabel}
      </Button>
    </form>
  );
}
