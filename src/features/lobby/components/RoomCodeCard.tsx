import { useState } from 'react';

import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { Button } from '@/shared/ui/Button';
import { CheckIcon, CopyIcon, ShareIcon } from '@/shared/ui/icons';

function canUseWebShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

const COPY_LABELS = {
  idle: 'Копирай кода',
  copied: 'Кодът е копиран',
  failed: 'Неуспешно копиране',
} as const;

export function RoomCodeCard({ code }: { code: string }) {
  const { status, copy } = useCopyToClipboard();
  const [shareSupported] = useState(canUseWebShare);

  const share = async () => {
    try {
      await navigator.share({
        title: 'Държави и градове',
        text: `Влез в моята стая с код ${code}`,
        url: `${window.location.origin}/room/${code}`,
      });
    } catch {
      // Dismissed by the user or refused by the browser — copying stays available.
    }
  };

  return (
    <section
      aria-labelledby="room-code-label"
      className="flex flex-col items-center gap-5 rounded-panel bg-ink-900/40 glass p-6 text-center sm:p-8"
    >
      <p
        id="room-code-label"
        className="text-xs font-bold tracking-[0.3em] text-fg-subtle uppercase"
      >
        Код на стаята
      </p>
      <p className="flex gap-1.5 font-display text-4xl font-black select-all sm:gap-2 sm:text-5xl">
        {code.split('').map((char, index) => (
          <span
            // Characters can repeat, so the position is part of the identity.
            key={`${index}-${char}`}
            className="grid h-14 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-gradient-brand sm:h-18 sm:w-14"
          >
            {char}
          </span>
        ))}
      </p>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button
          variant="secondary"
          icon={status === 'copied' ? <CheckIcon /> : <CopyIcon />}
          onClick={() => void copy(code)}
        >
          {COPY_LABELS[status]}
        </Button>
        {shareSupported ? (
          <Button variant="ghost" icon={<ShareIcon />} onClick={() => void share()}>
            Сподели
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" className="-mt-3 min-h-4 text-xs text-fg-subtle">
        {status === 'failed' ? 'Маркирай кода и го копирай ръчно.' : ''}
      </p>
    </section>
  );
}
