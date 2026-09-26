/**
 * What the Textbook's views share with the screen: the tree, autosave, the toast and the
 * navigation actions (Remi Textbook.dc.html's `openPage`, `newPageIn`, `createSub`, delete).
 */

import { createContext, useContext } from 'react';

import type { TextbookTreeOut } from '../../api';
import type { LivePage } from './tree';
import type { PageSaver } from './usePageSaver';

export interface TextbookCtx {
  tree: TextbookTreeOut | undefined;
  saver: PageSaver;
  /** The save-status line for the page on show (:657). */
  saveStatus: string;
  toastMessage: string | null;
  toast: (text: string) => void;
  openPage: (pageId: string) => void;
  openHome: () => void;
  newPageIn: (sectionId: string) => void;
  /** A sub-page inside `parentId`; with `replaceBlockId`, that block becomes the link (:433-446). */
  createSub: (parentId: string, replaceBlockId?: string) => void;
  deletePage: (pageId: string) => void;
  /** The server no longer has this page (deleted elsewhere): back to Textbook home. */
  pageGone: (pageId: string) => void;
  addSection: () => void;
  /** The open page's typed title and live-chart count, for the sidebar before the server has them. */
  setLive: (live: LivePage) => void;
  /** True once for a page just created: its title takes the focus. */
  takeFocusTitle: (pageId: string) => boolean;
  /** Bumped when a page is reloaded after a 409, so its editor starts again from the server. */
  reloadOf: (pageId: string) => number;
  reduced: boolean;
}

export const TextbookContext = createContext<TextbookCtx | null>(null);

export function useTextbook(): TextbookCtx {
  const ctx = useContext(TextbookContext);
  if (!ctx) throw new Error('useTextbook outside the Textbook screen');
  return ctx;
}
