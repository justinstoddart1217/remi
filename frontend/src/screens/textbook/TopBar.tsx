import { Fragment } from 'react';
import type { ReactNode } from 'react';

import { useTextbook } from './context';
import s from './Textbook.module.css';
import type { Crumb } from './tree';

/**
 * The 56px bar over the page (Remi Textbook.dc.html:102-117): the crumb (section dot, section,
 * ancestors as links, the page), the save status, then the page's actions. `inert` while
 * something covers it (the full-screen chart).
 */
export function TopBar({ crumb, inert, children }: { crumb: Crumb; inert?: boolean; children?: ReactNode }) {
  const tb = useTextbook();
  return (
    <div className={s.topBar} inert={inert ? true : undefined}>
      <span className={s.crumb}>
        <span className={s.crumbDot} style={{ background: crumb.accent }} />
        <span>{crumb.section}</span>
        {crumb.path.map((c) => (
          <Fragment key={c.id}>
            <span className={s.slashSep}>/</span>
            <button
              type="button"
              className={s.crumbLink}
              onClick={() => {
                tb.openPage(c.id);
              }}
            >
              {c.title}
            </button>
          </Fragment>
        ))}
        <span className={s.slashSep}>/</span>
        <span className={s.crumbTitle}>{crumb.title}</span>
      </span>
      <span className={s.spacer} />
      <span className={s.saved} role="status">
        {tb.saveStatus}
      </span>
      {children}
    </div>
  );
}
