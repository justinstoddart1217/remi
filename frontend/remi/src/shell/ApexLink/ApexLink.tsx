import clsx from 'clsx';

import { basePath } from '../../lib/basePath';
import s from './ApexLink.module.css';

export const APEX_LINK_LABEL = 'Back to APEX';

/**
 * The way back to APEX (docs/apex/INTEGRATION_REQUIREMENTS.md R-76). It shows only when Remi is
 * mounted under a path inside APEX (`basePath()` is `/remi`): APEX's own home is then `/`, a
 * full page load away, since the two are separate documents. On its own at the root (the
 * laptop), there is nothing to go back to and it renders nothing.
 */
export function ApexLink({ className }: { className?: string }) {
  if (!basePath()) return null;
  return (
    <a href="/" className={clsx(s.link, className)} title={APEX_LINK_LABEL} aria-label={APEX_LINK_LABEL}>
      <span aria-hidden="true">‹</span> APEX
    </a>
  );
}
