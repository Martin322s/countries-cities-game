import type { CSSProperties } from 'react';

import type { EligibleLetter } from '@/domain';

interface FloatingLetter {
  letter: EligibleLetter;
  top: string;
  left: string;
  size: string;
  tilt: string;
  delay: string;
  hue: 'brand' | 'accent' | 'violet' | 'cyan';
}

/** Hand-placed so the composition is stable across renders and never covers the hero. */
const LETTERS: readonly FloatingLetter[] = [
  { letter: 'Д', top: '8%', left: '6%', size: '9rem', tilt: '-12deg', delay: '0s', hue: 'brand' },
  {
    letter: 'Г',
    top: '14%',
    left: '82%',
    size: '7rem',
    tilt: '10deg',
    delay: '-3s',
    hue: 'accent',
  },
  { letter: 'Ж', top: '68%', left: '4%', size: '6rem', tilt: '8deg', delay: '-6s', hue: 'violet' },
  { letter: 'С', top: '74%', left: '86%', size: '8rem', tilt: '-8deg', delay: '-2s', hue: 'cyan' },
  { letter: 'Я', top: '42%', left: '92%', size: '4rem', tilt: '14deg', delay: '-8s', hue: 'brand' },
  {
    letter: 'Б',
    top: '40%',
    left: '-1%',
    size: '4.5rem',
    tilt: '-16deg',
    delay: '-5s',
    hue: 'accent',
  },
];

const HUE_CLASSES: Record<FloatingLetter['hue'], string> = {
  brand: 'text-brand-400/15',
  accent: 'text-accent-400/15',
  violet: 'text-violet-400/15',
  cyan: 'text-cyan-400/12',
};

/** Purely decorative ambient background: gradient glows + drifting Cyrillic letters. */
export function AmbientBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-[120px]" />
      <div className="absolute -bottom-48 -left-24 size-[36rem] rounded-full bg-accent-500/15 blur-[120px]" />
      <div className="absolute top-1/3 -right-40 size-[30rem] rounded-full bg-violet-400/12 blur-[120px]" />
      {LETTERS.map(({ letter, top, left, size, tilt, delay, hue }) => (
        <span
          key={letter}
          className={`absolute hidden animate-float font-display font-black select-none sm:block ${HUE_CLASSES[hue]}`}
          style={
            {
              top,
              left,
              fontSize: size,
              animationDelay: delay,
              '--tilt': tilt,
            } as CSSProperties
          }
        >
          {letter}
        </span>
      ))}
    </div>
  );
}
