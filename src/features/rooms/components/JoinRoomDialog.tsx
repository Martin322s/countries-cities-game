import { Dialog } from '@/shared/ui/Dialog';

import { JoinRoomForm } from './JoinRoomForm';

interface JoinRoomDialogProps {
  open: boolean;
  onClose: () => void;
  onJoined: (code: string) => void;
}

export function JoinRoomDialog({ open, onClose, onJoined }: JoinRoomDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Влез в стая"
      description="Въведи кода, който хостът сподели с теб."
    >
      <JoinRoomForm onJoined={onJoined} />
    </Dialog>
  );
}
