import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PageOut } from '../../api';
import { createTestQueryClient, setupMockApi } from '../../test/msw';
import { TextbookContext } from './context';
import type { TextbookCtx } from './context';
import { PageEditor } from './PageEditor';
import type { PageSaver } from './usePageSaver';

setupMockApi();

const saver: PageSaver = {
  loaded: () => undefined,
  pendingBlocks: () => null,
  setVersion: () => undefined,
  schedule: () => undefined,
  scheduleTitle: () => undefined,
  flush: () => Promise.resolve(),
  discard: () => undefined,
  hasUnsaved: () => false,
  flushAll: () => undefined,
};

const ctx: TextbookCtx = {
  tree: undefined,
  saver,
  saveStatus: 'Saved locally',
  toastMessage: null,
  toast: () => undefined,
  openPage: () => undefined,
  openHome: () => undefined,
  newPageIn: () => undefined,
  createSub: () => undefined,
  deletePage: () => undefined,
  pageGone: () => undefined,
  addSection: () => undefined,
  setLive: () => undefined,
  takeFocusTitle: () => false,
  reloadOf: () => 0,
  reduced: true,
};

const page: PageOut = {
  id: 'p1',
  sectionId: 'fi',
  parentId: null,
  sortOrder: 0,
  title: 'Rates primer',
  createdAt: '2026-10-01T09:00:00+01:00',
  updatedAt: '2026-10-01T09:00:00+01:00',
  version: 1,
  blocks: [
    { id: 'b1', type: 'p', text: '' },
    { id: 'f1', type: 'formula', tex: 'x^2' },
    { id: 'c1', type: 'chart', assetId: 'a'.repeat(64), name: 'curve.html', caption: '', height: 320 },
  ],
};

function renderEditor() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TextbookContext.Provider value={ctx}>
        <PageEditor page={page} fade={false} fadeIn={false} />
      </TextbookContext.Provider>
    </QueryClientProvider>,
  );
}

describe('PageEditor slash menu', () => {
  it('points the text at the menu and its active item, so arrowing is announced', () => {
    renderEditor();
    const text = screen.getByRole('textbox', { name: 'Paragraph' });
    text.focus();
    fireEvent.change(text, { target: { value: '/' } });
    const menu = screen.getByRole('listbox', { name: 'Blocks' });
    expect(text).toHaveAttribute('aria-controls', menu.id);
    const options = screen.getAllByRole('option');
    // Only the items are options: the "Blocks" eyebrow is not read as one.
    expect(options.every((o) => o.tagName === 'BUTTON')).toBe(true);
    expect(text).toHaveAttribute('aria-activedescendant', options[0]?.id);
    fireEvent.keyDown(text, { key: 'ArrowDown' });
    expect(text).toHaveAttribute('aria-activedescendant', options[1]?.id);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(text, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(text).not.toHaveAttribute('aria-activedescendant');
    expect(text).not.toHaveAttribute('aria-controls');
  });
});

describe('PageEditor focus', () => {
  it('Escape in a formula puts focus back on the formula, not on the page body', async () => {
    renderEditor();
    const formula = screen.getByRole('button', { name: 'Edit formula' });
    formula.focus();
    fireEvent.keyDown(formula, { key: 'Enter' });
    const tex = await screen.findByRole('textbox', { name: 'Formula (LaTeX)' });
    await waitFor(() => {
      expect(tex).toHaveFocus();
    });
    fireEvent.keyDown(tex, { key: 'Escape' });
    const back = await screen.findByRole('button', { name: 'Edit formula' });
    expect(back).toHaveFocus();
  });

  it('the full-screen chart makes the page under it inert and returns focus to Full screen on close', async () => {
    renderEditor();
    const open = screen.getByTitle('Full screen');
    open.focus();
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'curve.html' });
    // Non-modal: it covers the main column only, and the page under it cannot take focus.
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.getByLabelText('Page title').closest('[inert]')).not.toBeNull();
    expect(screen.getByText('Saved locally').closest('[inert]')).not.toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Page title').closest('[inert]')).toBeNull();
    await waitFor(() => {
      expect(open).toHaveFocus();
    });
  });
});
