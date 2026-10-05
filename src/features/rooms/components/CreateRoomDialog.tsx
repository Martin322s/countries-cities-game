import { useState, type SubmitEvent } from 'react';

import { DISPLAY_NAME_MAX_LENGTH, MAX_PLAYERS, validateDisplayName } from '@/domain';
import { useIdentityGate } from '@/features/auth/authContext';
import { readLocal } from '@/shared/lib/storage';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { Notice } from '@/shared/ui/Notice';
import { TextField } from '@/shared/ui/TextField';

import { roomErrorMessage } from '../api/roomErrors';
import { displayNameErrorMessage } from '../copy';
import { LAST_DISPLAY_NAME_KEY, useCreateRoom } from '../hooks/useRoomMutations';
import { CapacityPicker } from './CapacityPicker';
import { IdentityStatus } from './IdentityStatus';

const DEFAULT_CAPACITY = Math.min(8, MAX_PLAYERS);

interface CreateRoomDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (code: string) => void;
}

export function CreateRoomDialog({ open, onClose, onCreated }: CreateRoomDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Нова стая"
      description="Избери име и колко души ще играят. Ще получиш код, който да споделиш."
    >
      <CreateRoomForm onCreated={onCreated} />
    </Dialog>
  );
}

function CreateRoomForm({ onCreated }: { onCreated: (code: string) => void }) {
  const [displayName, setDisplayName] = useState(() => readLocal(LAST_DISPLAY_NAME_KEY) ?? '');
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const [submitted, setSubmitted] = useState(false);
  const create = useCreateRoom();
  const identity = useIdentityGate();

  const nameError = validateDisplayName(displayName);
  const serverError = create.error?.code ?? null;
  const nameServerError =
    serverError === 'invalid_display_name' ? roomErrorMessage(serverError, 'create') : null;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || !identity.ready || create.isPending) return;
    create.mutate(
      { displayName, capacity },
      {
        onSuccess: (code) => {
          onCreated(code);
        },
      },
    );
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
      <TextField
        label="Твоето име"
        name="displayName"
        autoComplete="nickname"
        maxLength={DISPLAY_NAME_MAX_LENGTH * 2}
        placeholder="напр. Деси"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
          create.reset();
        }}
        error={
          (submitted && nameError ? displayNameErrorMessage(nameError) : null) ?? nameServerError
        }
      />
      <CapacityPicker value={capacity} onChange={setCapacity} />
      <IdentityStatus />
      {serverError && !nameServerError ? (
        <Notice tone="error">{roomErrorMessage(serverError, 'create')}</Notice>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!identity.ready || create.isPending}
        aria-busy={create.isPending}
      >
        {identity.connecting ? 'Свързване...' : create.isPending ? 'Създаване...' : 'Създай стая'}
      </Button>
    </form>
  );
}
