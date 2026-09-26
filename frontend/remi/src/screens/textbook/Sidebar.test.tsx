import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { TextbookTreeOut } from '../../api';
import { createTestQueryClient, server, setupMockApi } from '../../test/msw';
import { TextbookContext } from './context';
import type { TextbookCtx } from './context';
import { Sidebar } from './Sidebar';
import type { SectionEdit } from './Sidebar';

setupMockApi();

const tree: TextbookTreeOut = {
  sections: [
    { id: 'fi', label: 'Fixed Income', accent: 'var(--fi-accent)', collapsed: false, pageCount: 0, sortOrder: 0 },
    { id: 'pc', label: 'Private Credit', accent: 'var(--pc-accent)', collapsed: false, pageCount: 0, sortOrder: 1 },
  ],
  pages: [],
};

const ctx = {
  tree,
  toast: () => undefined,
  openPage: () => undefined,
  openHome: () => undefined,
  newPageIn: () => undefined,
  addSection: () => undefined,
} as unknown as TextbookCtx;

function Harness() {
  const [secEdit, setSecEdit] = useState<SectionEdit | null>(null);
  return (
    <Sidebar
      currentId={null}
      open
      onOpenChange={() => undefined}
      collapsed={new Set()}
      onTogglePage={() => undefined}
      live={null}
      secEdit={secEdit}
      onSecEdit={setSecEdit}
    />
  );
}

function renderSidebar() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <TextbookContext.Provider value={ctx}>
          <Harness />
        </TextbookContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Textbook sidebar sections from the keyboard', () => {
  it('renames with Enter (or F2), and gives the focus back to the name after', async () => {
    renderSidebar();
    const label = screen.getByRole('button', { name: 'Rename Fixed Income' });
    label.focus();
    fireEvent.keyDown(label, { key: 'Enter' });
    const field = await screen.findByRole('textbox', { name: 'Section name' });
    expect(field).toHaveValue('Fixed Income');
    expect(field).toHaveFocus();
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Rename Fixed Income' })).toHaveFocus();
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Rename Private Credit' }), { key: 'F2' });
    expect(await screen.findByRole('textbox', { name: 'Section name' })).toHaveValue('Private Credit');
  });

  it('moves a section with Alt+↓ and Alt+↑, the same reorder the drag sends', async () => {
    const orders: string[][] = [];
    server.use(
      http.put('*/api/textbook/sections/order', async ({ request }) => {
        const body = (await request.json()) as { ids: string[] };
        orders.push(body.ids);
        return HttpResponse.json(tree);
      }),
    );
    renderSidebar();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Rename Fixed Income' }), { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Rename Private Credit' }), { key: 'ArrowUp', altKey: true });
    // Already first: nothing to send.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Rename Fixed Income' }), { key: 'ArrowUp', altKey: true });
    await waitFor(() => {
      expect(orders).toEqual([
        ['pc', 'fi'],
        ['pc', 'fi'],
      ]);
    });
  });
});
