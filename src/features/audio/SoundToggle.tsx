import { cn } from '@/shared/lib/cn';
import { SpeakerIcon, SpeakerOffIcon } from '@/shared/ui/icons';

import { useGameAudio } from './gameAudio';

/** Global speaker control. Per device, stored locally; keyboard and screen-reader friendly. */
export function SoundToggle() {
  const { enabled, setEnabled } = useGameAudio();
  const label = enabled ? 'Звук: включен' : 'Звук: изключен';
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      onClick={() => {
        setEnabled(!enabled);
      }}
      className={cn(
        'inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition duration-(--motion-instant) active:scale-95',
        enabled
          ? 'border-white/12 bg-white/5 text-fg-muted hover:text-fg'
          : 'border-white/8 bg-transparent text-fg-subtle hover:text-fg-muted',
      )}
    >
      {enabled ? <SpeakerIcon width={18} height={18} /> : <SpeakerOffIcon width={18} height={18} />}
      <span aria-hidden="true" className="hidden sm:inline">
        {enabled ? 'Звук' : 'Без звук'}
      </span>
    </button>
  );
}
