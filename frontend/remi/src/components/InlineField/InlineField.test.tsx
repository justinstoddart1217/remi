import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InlineField } from './InlineField';
import { parseNumericDraft } from './parse';

const field = () => screen.getByRole('textbox');

describe('InlineField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a draft while typing and commits the trimmed text on blur', () => {
    const onCommit = vi.fn();
    render(<InlineField value="Returns pipeline" onCommit={onCommit} aria-label="Name" />);
    fireEvent.change(field(), { target: { value: '  Returns pipeline automation ' } });
    expect(field()).toHaveValue('  Returns pipeline automation ');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenCalledWith('Returns pipeline automation');
  });

  it('commits on Enter by blurring', () => {
    const onCommit = vi.fn();
    render(<InlineField value="a" onCommit={onCommit} aria-label="Name" />);
    field().focus();
    fireEvent.change(field(), { target: { value: 'b' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(field()).not.toHaveFocus();
    expect(onCommit).toHaveBeenCalledWith('b');
  });

  it('does not commit on Enter when multi (Why now), so Enter can insert a newline', () => {
    const onCommit = vi.fn();
    render(<InlineField multi value="Because" onCommit={onCommit} aria-label="Why now" />);
    const el = field();
    expect(el.tagName).toBe('TEXTAREA');
    el.focus();
    fireEvent.change(el, { target: { value: 'Because\nnow' } });
    const enter = fireEvent.keyDown(el, { key: 'Enter' });
    expect(enter).toBe(true); // default not prevented: the newline goes in
    expect(el).toHaveFocus();
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(el);
    expect(onCommit).toHaveBeenCalledWith('Because\nnow');
  });

  it('reverts on Escape, stops propagation, and does not commit', () => {
    const onCommit = vi.fn();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    render(<InlineField value="Original" onCommit={onCommit} aria-label="Name" />);
    field().focus();
    fireEvent.change(field(), { target: { value: 'Edited' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
    expect(field()).toHaveValue('Original');
    act(() => {
      vi.runAllTimers();
    });
    expect(field()).not.toHaveFocus();
    expect(onCommit).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
  });

  it('does nothing when the value is unchanged', () => {
    const onCommit = vi.fn();
    render(<InlineField value="Same" onCommit={onCommit} aria-label="Name" />);
    fireEvent.change(field(), { target: { value: 'Same  ' } });
    fireEvent.blur(field());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('removes a list item committed blank', () => {
    const onCommit = vi.fn();
    const onRemove = vi.fn();
    render(<InlineField value="A limit" onCommit={onCommit} onRemove={onRemove} aria-label="Item" />);
    fireEvent.change(field(), { target: { value: '   ' } });
    fireEvent.blur(field());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('removes an untouched blank item on blur (a freshly added line)', () => {
    const onRemove = vi.fn();
    render(<InlineField value="" onCommit={vi.fn()} onRemove={onRemove} aria-label="Item" />);
    fireEvent.blur(field());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does not remove twice while an async removal is in flight', async () => {
    let reject: (e: Error) => void = () => undefined;
    const save = new Promise<void>((_, r) => {
      reject = r;
    });
    const onRemove = vi.fn(() => save);
    render(<InlineField value="A limit" onCommit={vi.fn()} onRemove={onRemove} aria-label="Item" />);
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(field()).toHaveValue('');

    // Refocus and blur the (now blank) line: not an untouched fresh line, so no second removal.
    field().focus();
    fireEvent.blur(field());
    // Nor does clearing it again.
    fireEvent.change(field(), { target: { value: 'x' } });
    fireEvent.change(field(), { target: { value: ' ' } });
    fireEvent.blur(field());
    expect(onRemove).toHaveBeenCalledTimes(1);

    // Once the removal fails the item is back, and removing it again works.
    await act(async () => {
      reject(new Error('500'));
      await save.catch(() => undefined);
    });
    expect(field()).toHaveValue('A limit');
    onRemove.mockReturnValueOnce(new Promise<void>(() => undefined));
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('does not remove an untouched blank item twice while its async removal is in flight', async () => {
    // A server-created blank item (text '') whose DELETE is in flight: refocus plus blur must not
    // send a second one.
    let reject: (e: Error) => void = () => undefined;
    const save = new Promise<void>((_, r) => {
      reject = r;
    });
    const onRemove = vi.fn<() => unknown>(() => save);
    render(<InlineField value="" onCommit={vi.fn()} onRemove={onRemove} aria-label="Item" />);
    field().focus();
    fireEvent.blur(field());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(field()).toHaveAttribute('readonly');

    field().focus();
    fireEvent.blur(field());
    field().focus();
    fireEvent.blur(field());
    expect(onRemove).toHaveBeenCalledTimes(1);

    // Once the removal fails the line unlocks, and blurring it again retries.
    await act(async () => {
      reject(new Error('500'));
      await save.catch(() => undefined);
    });
    expect(field()).not.toHaveAttribute('readonly');
    onRemove.mockReturnValueOnce(new Promise<void>(() => undefined));
    field().focus();
    fireEvent.blur(field());
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('is read-only while a removal is held, so it never commits an edit to a deleted item', () => {
    const onCommit = vi.fn();
    const onRemove = vi.fn(() => new Promise<void>(() => undefined));
    render(<InlineField value="A limit" onCommit={onCommit} onRemove={onRemove} aria-label="Item" />);
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(field()).toHaveAttribute('readonly');

    fireEvent.change(field(), { target: { value: 'A new limit' } });
    expect(field()).toHaveValue('');
    fireEvent.blur(field());
    expect(onCommit).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('shows but never edits or commits a read-only value', () => {
    const onCommit = vi.fn();
    const onRemove = vi.fn();
    render(<InlineField readOnly value="Saving" onCommit={onCommit} onRemove={onRemove} aria-label="Item" />);
    expect(field()).toHaveAttribute('readonly');
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    fireEvent.change(field(), { target: { value: 'Other' } });
    fireEvent.blur(field());
    expect(field()).toHaveValue('Saving');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('keeps an untouched non-blank item on blur', () => {
    const onRemove = vi.fn();
    render(<InlineField value="Kept" onCommit={vi.fn()} onRemove={onRemove} aria-label="Item" />);
    fireEvent.blur(field());
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('reverts a blank commit when required', () => {
    const onCommit = vi.fn();
    render(<InlineField required value="Goal" onCommit={onCommit} aria-label="Goal" />);
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(onCommit).not.toHaveBeenCalled();
    expect(field()).toHaveValue('Goal');
  });

  it('saves a blank value when neither required nor removable (routine names)', () => {
    const onCommit = vi.fn();
    render(<InlineField value="Returns" onCommit={onCommit} aria-label="Name" />);
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenCalledWith('');
  });

  it('parses numbers with a comma decimal, clamps, and treats NaN as 0', () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <InlineField numeric={{ max: 24 }} value={3.6} onCommit={onCommit} aria-label="Hours a day" />,
    );
    fireEvent.change(field(), { target: { value: '3,8' } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenLastCalledWith(3.8);

    rerender(<InlineField numeric={{ max: 8 }} value={6} onCommit={onCommit} aria-label="Hours a day" />);
    fireEvent.change(field(), { target: { value: '12' } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenLastCalledWith(8);

    fireEvent.change(field(), { target: { value: 'abc' } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenLastCalledWith(0);
  });

  it('does not commit a number equal to the current value', () => {
    const onCommit = vi.fn();
    render(<InlineField numeric={{ max: 24 }} value={4} onCommit={onCommit} aria-label="Hours" />);
    fireEvent.change(field(), { target: { value: '4.0' } });
    fireEvent.blur(field());
    expect(onCommit).not.toHaveBeenCalled();
  });

  describe('holds the committed value until the value prop changes', () => {
    it('keeps showing a void commit while the save is in flight, then follows the prop', () => {
      const onCommit = vi.fn();
      const { rerender } = render(<InlineField value="Old" onCommit={onCommit} aria-label="Name" />);
      fireEvent.change(field(), { target: { value: 'New' } });
      fireEvent.blur(field());
      expect(onCommit).toHaveBeenCalledWith('New');
      expect(field()).toHaveValue('New'); // no flash of 'Old'
      rerender(<InlineField value="Old" onCommit={onCommit} aria-label="Name" />);
      expect(field()).toHaveValue('New');
      rerender(<InlineField value="New" onCommit={onCommit} aria-label="Name" />);
      expect(field()).toHaveValue('New');
      // Once the value arrived the hold is gone: a later external change to 'Old' shows.
      rerender(<InlineField value="Old" onCommit={onCommit} aria-label="Name" />);
      expect(field()).toHaveValue('Old');
    });

    it('shows the server-normalised value when it differs from the committed text', () => {
      const { rerender } = render(<InlineField value="a" onCommit={vi.fn()} aria-label="Name" />);
      fireEvent.change(field(), { target: { value: 'b ' } });
      fireEvent.blur(field());
      expect(field()).toHaveValue('b');
      rerender(<InlineField value="B" onCommit={vi.fn()} aria-label="Name" />);
      expect(field()).toHaveValue('B');
    });

    it('does not commit again when the draft equals the held value', () => {
      const onCommit = vi.fn();
      render(<InlineField value="Old" onCommit={onCommit} aria-label="Name" />);
      fireEvent.change(field(), { target: { value: 'New' } });
      fireEvent.blur(field());
      fireEvent.change(field(), { target: { value: 'New ' } });
      fireEvent.blur(field());
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it('reverts when the returned promise rejects', async () => {
      let reject: (e: Error) => void = () => undefined;
      const save = new Promise<void>((_, r) => {
        reject = r;
      });
      render(<InlineField value="Old" onCommit={() => save} aria-label="Name" />);
      fireEvent.change(field(), { target: { value: 'New' } });
      fireEvent.blur(field());
      expect(field()).toHaveValue('New');
      await act(async () => {
        reject(new Error('422'));
        await save.catch(() => undefined);
      });
      expect(field()).toHaveValue('Old');
    });

    it('reverts at once when the callback returns false', () => {
      render(<InlineField value="Old" onCommit={() => false} aria-label="Name" />);
      fireEvent.change(field(), { target: { value: 'New' } });
      fireEvent.blur(field());
      expect(field()).toHaveValue('Old');
    });

    it('holds a parsed number', () => {
      render(<InlineField numeric={{ max: 24 }} value={3.6} onCommit={vi.fn()} aria-label="Hours" />);
      fireEvent.change(field(), { target: { value: '3,8' } });
      fireEvent.blur(field());
      expect(field()).toHaveValue('3.8');
    });

    it('shows a cleared list item blank while its removal is in flight', () => {
      render(<InlineField value="A limit" onCommit={vi.fn()} onRemove={vi.fn()} aria-label="Item" />);
      fireEvent.change(field(), { target: { value: '' } });
      fireEvent.blur(field());
      expect(field()).toHaveValue('');
    });
  });
});

describe('parseNumericDraft', () => {
  it('matches the prototype', () => {
    expect(parseNumericDraft('2,5', 24)).toBe(2.5);
    expect(parseNumericDraft('-3', 24)).toBe(0);
    expect(parseNumericDraft('', 24)).toBe(0);
    expect(parseNumericDraft('30h', 24)).toBe(24);
    expect(parseNumericDraft('0', 20, 1)).toBe(1);
  });
});
