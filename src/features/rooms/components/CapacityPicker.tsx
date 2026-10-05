import { useId } from 'react';

import { clampRoomCapacity, MAX_PLAYERS, MIN_PLAYERS } from '@/domain';
import { MinusIcon, PlusIcon } from '@/shared/ui/icons';

interface CapacityPickerProps {
  value: number;
  onChange: (value: number) => void;
}

const stepButtonClass =
  'grid size-12 cursor-pointer place-items-center rounded-xl border border-white/12 bg-white/5 text-fg transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

export function CapacityPicker({ value, onChange }: CapacityPickerProps) {
  const labelId = useId();
  const set = (next: number) => {
    onChange(clampRoomCapacity(next));
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-semibold text-fg-muted">
        Брой играчи
      </span>
      <div className="flex items-center gap-3" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          className={stepButtonClass}
          onClick={() => {
            set(value - 1);
          }}
          disabled={value <= MIN_PLAYERS}
          aria-label="Намали броя играчи"
        >
          <MinusIcon />
        </button>
        <input
          type="range"
          min={MIN_PLAYERS}
          max={MAX_PLAYERS}
          step={1}
          value={value}
          onChange={(event) => {
            set(Number(event.target.value));
          }}
          aria-labelledby={labelId}
          aria-valuetext={`${value} играчи`}
          className="h-2 flex-1 cursor-pointer accent-brand-500"
        />
        <button
          type="button"
          className={stepButtonClass}
          onClick={() => {
            set(value + 1);
          }}
          disabled={value >= MAX_PLAYERS}
          aria-label="Увеличи броя играчи"
        >
          <PlusIcon />
        </button>
        <output
          aria-live="polite"
          className="w-10 text-center font-display text-2xl font-bold text-brand-300 tabular-nums"
        >
          {value}
        </output>
      </div>
      <p className="text-xs text-fg-subtle">
        От {MIN_PLAYERS} до {MAX_PLAYERS} играчи, включително теб.
      </p>
    </div>
  );
}
