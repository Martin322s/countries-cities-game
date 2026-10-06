import { useState } from 'react';
import { useNavigate } from 'react-router';

import { MAX_PLAYERS, MIN_PLAYERS, ROUND_DURATION_MS } from '@/domain';
import { CreateRoomDialog } from '@/features/rooms/components/CreateRoomDialog';
import { IdentityStatus } from '@/features/rooms/components/IdentityStatus';
import { JoinRoomDialog } from '@/features/rooms/components/JoinRoomDialog';
import { Button } from '@/shared/ui/Button';
import { EnterIcon, PlusIcon, UsersIcon } from '@/shared/ui/icons';

import { CategoryStrip } from './components/CategoryStrip';

type OpenDialog = 'create' | 'join' | null;

const ROUND_MINUTES = ROUND_DURATION_MS / 60_000;

export function LandingPage() {
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const navigate = useNavigate();
  const closeDialog = () => {
    setOpenDialog(null);
  };
  const enterRoom = (code: string) => {
    void navigate(`/room/${code}`);
  };

  return (
    <section
      aria-labelledby="landing-title"
      className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 text-center"
    >
      <p className="mb-6 inline-flex animate-rise items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-fg-muted">
        <UsersIcon className="text-brand-300" width={18} height={18} />
        <span>
          От {MIN_PLAYERS} до {MAX_PLAYERS} играчи
        </span>
      </p>

      <h1
        id="landing-title"
        className="animate-rise font-display leading-[0.95] font-black tracking-tight [animation-delay:80ms]"
      >
        <span className="block text-gradient-brand text-[clamp(3rem,12vw,7.5rem)]">Държави</span>
        <span className="mt-1 block text-[clamp(1.75rem,6.5vw,3.75rem)] text-fg">и градове</span>
      </h1>

      <p className="mt-6 max-w-xl animate-rise text-base text-pretty text-fg-muted [animation-delay:160ms] sm:text-lg">
        Една буква. {ROUND_MINUTES} минути. Седем категории. Класическата игра с лист и химикалка —
        вече онлайн с приятели.
      </p>

      <div className="mt-10 flex w-full animate-rise flex-col gap-3 [animation-delay:240ms] sm:w-auto sm:flex-row sm:gap-4">
        <Button
          size="lg"
          icon={<PlusIcon />}
          onClick={() => {
            setOpenDialog('create');
          }}
        >
          СЪЗДАЙ СТАЯ
        </Button>
        <Button
          size="lg"
          variant="secondary"
          icon={<EnterIcon />}
          onClick={() => {
            setOpenDialog('join');
          }}
        >
          ВЛЕЗ В СТАЯ
        </Button>
      </div>

      {/* Quiet unless the server is slow or unreachable (then: what is happening + retry). */}
      <div className="mt-4 w-full max-w-md empty:hidden">
        <IdentityStatus />
      </div>

      <div className="mt-14 animate-rise [animation-delay:320ms]">
        <CategoryStrip />
      </div>

      <CreateRoomDialog
        open={openDialog === 'create'}
        onClose={closeDialog}
        onCreated={enterRoom}
      />
      <JoinRoomDialog open={openDialog === 'join'} onClose={closeDialog} onJoined={enterRoom} />
    </section>
  );
}
