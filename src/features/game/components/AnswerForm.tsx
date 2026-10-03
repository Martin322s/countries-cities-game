import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

import {
  ANSWER_MAX_LENGTH,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  type AnswerValues,
  type CategoryId,
  startsWithLetter,
} from '@/domain';
import { cn } from '@/shared/lib/cn';

interface AnswerFormProps {
  values: AnswerValues;
  onChange: (category: CategoryId, value: string) => void;
  readOnly: boolean;
  /** Focus target after the last field (the ready button). */
  nextFocusRef: RefObject<HTMLButtonElement | null>;
  autoFocusFirst: boolean;
  /** The round's letter: answers starting with another letter score 0. */
  letter: string | null;
}

function prefersPreciseInput(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

/**
 * Seven answer fields tuned for fast typing:
 * - Enter moves to the next field (never submits); after the last it focuses READY
 * - Enter during IME composition is left alone
 * - Tab works natively; the form never submits on its own
 */
export function AnswerForm({
  values,
  onChange,
  readOnly,
  nextFocusRef,
  autoFocusFirst,
  letter,
}: AnswerFormProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const composing = useRef(false);
  const didAutoFocus = useRef(false);

  useEffect(() => {
    // Only once, when the form first appears. Desktop only: on phones this would pop
    // the keyboard over the letter and the timer.
    if (didAutoFocus.current) return;
    didAutoFocus.current = true;
    if (autoFocusFirst && !readOnly && prefersPreciseInput()) inputs.current[0]?.focus();
  }, [autoFocusFirst, readOnly]);

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || composing.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const next = inputs.current[index + 1];
    if (next) next.focus();
    else nextFocusRef.current?.focus();
  };

  return (
    <form
      noValidate
      aria-label="Отговори"
      onSubmit={(event) => {
        event.preventDefault();
      }}
      className="flex flex-col gap-2.5"
    >
      {CATEGORY_IDS.map((category, index) => {
        const id = `answer-${category}`;
        const isLast = index === CATEGORY_IDS.length - 1;
        const filled = values[category].trim() !== '';
        const wrongLetter = filled && letter !== null && !startsWithLetter(values[category], letter);
        const hintId = `${id}-hint`;
        return (
          <div
            key={category}
            data-filled={filled}
            className={cn(
              'group grid grid-cols-1 items-center gap-1.5 rounded-2xl border px-3 py-2.5 sm:grid-cols-[8.5rem_1fr] sm:gap-3',
              'transition-colors duration-(--motion-fast) ease-standard',
              'focus-within:border-brand-400/70 focus-within:bg-brand-500/10',
              filled ? 'border-white/16 bg-white/[0.07]' : 'border-white/10 bg-white/5',
            )}
          >
            <label
              htmlFor={id}
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase transition-colors duration-(--motion-fast) group-focus-within:text-brand-300',
                filled ? 'text-fg' : 'text-fg-muted',
              )}
            >
              {CATEGORY_LABELS[category]}
              {filled ? (
                <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-400" />
              ) : null}
            </label>
            <input
              id={id}
              ref={(element) => {
                inputs.current[index] = element;
              }}
              name={category}
              value={values[category]}
              onChange={(event) => {
                onChange(category, event.target.value);
              }}
              onKeyDown={handleKeyDown(index)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                // Safari fires the confirming Enter keydown after compositionend.
                window.setTimeout(() => {
                  composing.current = false;
                }, 0);
              }}
              readOnly={readOnly}
              aria-readonly={readOnly}
              aria-invalid={wrongLetter || undefined}
              aria-describedby={wrongLetter ? hintId : undefined}
              maxLength={ANSWER_MAX_LENGTH}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
              spellCheck={false}
              enterKeyHint={isLast ? 'done' : 'next'}
              className={cn(
                'h-12 w-full min-w-0 rounded-xl border border-transparent bg-ink-950/60 px-3 text-lg font-semibold text-fg placeholder:text-fg-subtle',
                // Focus scrolling (Enter → next field, phone keyboards) stops below the sticky
                // letter/timer header and above the bottom edge.
                'scroll-mt-32 scroll-mb-24',
                'transition-[border-color,box-shadow] duration-(--motion-fast) ease-standard',
                'focus-visible:border-brand-400 focus-visible:shadow-[0_0_0_4px_rgb(255_169_77/0.14)] focus-visible:outline-offset-0',
                readOnly && 'cursor-not-allowed text-fg-muted',
                wrongLetter && 'border-status-duplicate/60',
              )}
            />
            {wrongLetter ? (
              <p id={hintId} className="text-xs font-semibold text-status-duplicate sm:col-start-2">
                {`Трябва да започва с „${letter}“ — иначе носи 0 точки.`}
              </p>
            ) : null}
          </div>
        );
      })}
    </form>
  );
}
