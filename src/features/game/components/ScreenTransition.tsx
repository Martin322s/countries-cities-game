import type { ReactNode } from 'react';

/**
 * Major game screens enter with a short fade + rise (motion "normal", ~360 ms).
 * Keyed by the screen identity, so it plays once per screen change — never on
 * re-renders. There is no exit animation: the server's state change is shown the
 * moment it arrives, and nobody ever waits for an animation. Reduced motion makes
 * it instant.
 */
export function ScreenTransition({
  screenKey,
  children,
}: {
  screenKey: string;
  children: ReactNode;
}) {
  return (
    <div key={screenKey} data-screen={screenKey} className="animate-screen-in">
      {children}
    </div>
  );
}
