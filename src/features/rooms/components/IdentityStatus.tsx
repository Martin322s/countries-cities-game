import { useAuthSession } from '@/features/auth/authContext';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';

import { identityErrorMessage } from '../copy';

/** Explains why room actions are unavailable while the anonymous identity is missing. */
export function IdentityStatus() {
  const { state, slow, retry } = useAuthSession();

  if (state.status === 'loading') {
    return slow ? <Notice tone="warning">Сървърът не отговаря. Опитваме отново...</Notice> : null;
  }
  if (state.status !== 'error') return null;

  return (
    <Notice tone={state.kind === 'unreachable' ? 'warning' : 'error'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{identityErrorMessage(state.kind)}</span>
        {state.kind !== 'not_configured' ? (
          <Button variant="ghost" onClick={retry} className="h-9 px-3">
            Опитай отново
          </Button>
        ) : null}
      </div>
    </Notice>
  );
}
