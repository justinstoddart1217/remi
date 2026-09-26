import clsx from 'clsx';
import { useEffect } from 'react';

import { isRemiApiError, useTextbookPage } from '../../api';
import { useTextbook } from './context';
import { OutlineNav } from './OutlineNav';
import { PageEditor } from './PageEditor';
import s from './Textbook.module.css';
import { TopBar } from './TopBar';
import { crumbFor } from './tree';

/**
 * A page route: loads `GET /textbook/pages/{id}` and hands it to the editor. While it loads
 * the frame (crumb, columns) is already in place; a page that no longer exists goes back to
 * Textbook home. After a 409 the editor is keyed afresh, so it starts from the server's copy.
 */
export function PageView({ pageId, fade, fadeIn }: { pageId: string; fade: boolean; fadeIn: boolean }) {
  const tb = useTextbook();
  const { pageGone } = tb;
  const query = useTextbookPage(pageId);
  const gone = isRemiApiError(query.error, 'NOT_FOUND');

  useEffect(() => {
    if (gone) pageGone(pageId);
  }, [gone, pageGone, pageId]);

  if (query.data) {
    return <PageEditor key={`${pageId}:${String(tb.reloadOf(pageId))}`} page={query.data} fade={fade} fadeIn={fadeIn} />;
  }

  return (
    <>
      <main className={s.main}>
        <TopBar crumb={crumbFor(tb.tree, pageId)} />
        <div className={s.scroll}>
          <div className={clsx(s.page, s.fx)} data-fade={fade}>
            {query.isError && !gone ? (
              <div className={s.homeError}>
                This page didn’t load.{' '}
                <button
                  type="button"
                  className={s.inlineLink}
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </main>
      <OutlineNav items={[]} empty="Headings appear here, numbered." />
    </>
  );
}
