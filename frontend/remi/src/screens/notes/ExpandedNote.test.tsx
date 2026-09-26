import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOverlays } from '../../stores/overlays';
import { createTestQueryClient, server, setupMockApi } from '../../test/msw';
import type { EntryView } from './DayPage';
import { ExpandedNote, EXPANDED_LAYER } from './ExpandedNote';

setupMockApi();

const ENTRY: EntryView = {
  id: 'n1',
  time: '11:20',
  text: 'Finance happy to review the ManCo NAV bridge spec on Thursday.',
  tags: [{ targetType: 'project', targetId: 'manco', label: 'ManCo automation', domain: 'pc' }],
};

function renderNote(props: { open?: boolean; entry?: EntryView } = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const client = createTestQueryClient();
  const ui = (open: boolean, entry: EntryView) => (
    <QueryClientProvider client={client}>
      <ExpandedNote entry={entry} day="Mon 5 Oct" open={open} onSave={onSave} onClose={onClose} />
    </QueryClientProvider>
  );
  const utils = render(ui(props.open ?? true, props.entry ?? ENTRY));
  const input = screen.getByRole('textbox', { name: 'Note at 11:20' });
  const rerenderWith = (open: boolean, entry: EntryView) => {
    utils.rerender(ui(open, entry));
  };
  return { ...utils, onSave, onClose, input, rerenderWith };
}

afterEach(() => {
  vi.useRealTimers();
  useOverlays.setState({ stack: [] });
});

describe('ExpandedNote', () => {
  it('shows the day, time, tags, word count and key hints', () => {
    renderNote();
    const dialog = screen.getByRole('dialog', { name: 'Note, Mon 5 Oct at 11:20' });
    expect(dialog).toHaveTextContent('Mon 5 Oct');
    expect(dialog).toHaveTextContent('11:20');
    expect(dialog).toHaveTextContent('ManCo automation');
    expect(dialog).toHaveTextContent('11 words');
    expect(dialog).toHaveTextContent('Enter for a new line · Esc or ⌘↵ to collapse · saves as you go');
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('title', 'Collapse (Esc)');
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Write as much as you like.');
  });

  it('focuses the text with the caret at the end once open', async () => {
    const { input } = renderNote();
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect((input as HTMLTextAreaElement).selectionStart).toBe(ENTRY.text.length);
  });

  it('saves the trimmed edit and closes on Escape, without reaching the global handler', () => {
    const { input, onSave, onClose } = renderNote();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    fireEvent.change(input, { target: { value: 'A longer note, written out.  ' } });
    expect(screen.getByText('5 words')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(onSave).toHaveBeenCalledWith('n1', 'A longer note, written out.');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('closes on ⌘↵, the scrim and Collapse; an untouched note is not saved', () => {
    const { input, onSave, onClose, container } = renderNote();
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    const scrim = container.querySelector('[aria-hidden="true"]');
    expect(scrim).not.toBeNull();
    if (scrim) fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps Enter as a new line', () => {
    const { input, onClose } = renderNote();
    const event = fireEvent.keyDown(input, { key: 'Enter' });
    expect(event).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hands a blanked note to onSave as empty (deleted, as inline)', () => {
    const { input, onSave } = renderNote();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(onSave).toHaveBeenCalledWith('n1', '');
  });

  it('saves as you go after a pause, never a blank', () => {
    vi.useFakeTimers();
    const { input, onSave } = renderNote();
    fireEvent.change(input, { target: { value: 'Draft one' } });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Draft two' } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('n1', 'Draft two');
    fireEvent.change(input, { target: { value: '' } });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('follows the text with its tags', async () => {
    server.use(
      http.post('*/api/notes/tags', () =>
        HttpResponse.json({ tags: [{ targetType: 'routine', targetId: 'r-ret', label: 'Returns · BAU', domain: 'pc' }] }),
      ),
    );
    const { input } = renderNote();
    fireEvent.change(input, { target: { value: 'Returns are done for today.' } });
    expect(await screen.findByText('Returns · BAU')).toBeInTheDocument();
    expect(screen.queryByText('ManCo automation')).not.toBeInTheDocument();
  });

  it('is an Escape layer only while open, and is inert while closed', () => {
    const { rerenderWith, onClose, container } = renderNote({ open: false });
    expect(useOverlays.getState().stack).not.toContain(EXPANDED_LAYER);
    expect(container.firstElementChild).toHaveAttribute('inert');
    rerenderWith(true, ENTRY);
    expect(useOverlays.getState().stack).toContain(EXPANDED_LAYER);
    act(() => {
      useOverlays.getState().closeTop();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
