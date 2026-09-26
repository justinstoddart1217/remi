import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RemiApiError } from '../../../api';
import { TimezoneField } from '../fields/TimezoneField';
import { FieldError, SaveNote } from './Section';
import type { SaveFeedback } from './useSaveFeedback';
import { saveError, saveErrorMessage } from './useSaveFeedback';
import { useScrollSpy } from './useScrollSpy';

const IDS = ['move', 'day', 'rotation', 'ai', 'appearance'] as const;
/** Section tops on a page scrolled to its end: 04 sits above the 35% line, 05 cannot reach it. */
const TOPS: Record<(typeof IDS)[number], number> = { move: -900, day: -500, rotation: -100, ai: 150, appearance: 600 };

describe('useScrollSpy', () => {
  let scrollY: PropertyDescriptor | undefined;

  beforeEach(() => {
    scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    Element.prototype.scrollIntoView = vi.fn();
    for (const id of IDS) {
      const section = document.createElement('section');
      section.id = id;
      section.innerHTML = `<h2 tabindex="-1">${id}</h2><input aria-label="${id} field" />`;
      section.getBoundingClientRect = () => ({ top: TOPS[id] }) as DOMRect;
      document.body.append(section);
    }
  });

  afterEach(() => {
    for (const id of IDS) document.getElementById(id)?.remove();
    if (scrollY) Object.defineProperty(window, 'scrollY', scrollY);
  });

  it('marks the last section at the end of the page', async () => {
    const { result } = renderHook(() => useScrollSpy(IDS));
    await waitFor(() => {
      expect(result.current.current).toBe('appearance');
    });
  });

  it('keeps a jumped-to section current until the reader scrolls', async () => {
    const { result } = renderHook(() => useScrollSpy(IDS));
    await waitFor(() => {
      expect(result.current.current).toBe('appearance');
    });
    act(() => {
      result.current.jump('ai');
    });
    expect(result.current.current).toBe('ai');
    expect(document.activeElement?.textContent).toBe('ai');
    // The jump's own scroll (and the page hitting its end) does not take it back.
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.current).toBe('ai');
    // A wheel is the reader scrolling: the spy follows the page again, even when the page
    // is already at its end and does not move.
    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });
    expect(result.current.current).toBe('appearance');
  });

  it('follows focus into another section after a jump', () => {
    const { result } = renderHook(() => useScrollSpy(IDS));
    act(() => {
      result.current.jump('ai');
    });
    act(() => {
      screen.getByLabelText('rotation field').focus();
    });
    expect(result.current.current).toBe('rotation');
  });

  it('follows focus back into the section above, without a jump', async () => {
    const { result } = renderHook(() => useScrollSpy(IDS));
    await waitFor(() => {
      expect(result.current.current).toBe('appearance');
    });
    act(() => {
      screen.getByLabelText('day field').focus();
    });
    expect(result.current.current).toBe('day');
    act(() => {
      screen.getByLabelText('rotation field').focus();
    });
    expect(result.current.current).toBe('rotation');
    // Back into 02: the rail goes with it, and the page's own scroll does not take it away.
    act(() => {
      screen.getByLabelText('day field').focus();
    });
    expect(result.current.current).toBe('day');
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.current).toBe('day');
    // The reader scrolling hands the rail back to the page.
    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });
    expect(result.current.current).toBe('appearance');
  });

  it('keeps the mark when Space presses a button, and lets Page Down scroll it away', () => {
    const { result } = renderHook(() => useScrollSpy(IDS));
    const button = document.createElement('button');
    document.getElementById('ai')?.append(button);
    act(() => {
      button.focus();
    });
    expect(result.current.current).toBe('ai');
    act(() => {
      fireEvent.keyDown(button, { key: ' ' });
    });
    expect(result.current.current).toBe('ai');
    act(() => {
      fireEvent.keyDown(button, { key: 'PageDown' });
    });
    expect(result.current.current).toBe('appearance');
  });
});

describe('TimezoneField', () => {
  function setup(value = 'Africa/Johannesburg') {
    const onCommit = vi.fn();
    render(<TimezoneField id="tz" value={value} onCommit={onCommit} />);
    const input = screen.getByRole('combobox', { name: 'Time zone' });
    return { onCommit, input };
  }

  function type(input: HTMLElement, text: string) {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
  }

  it('settles on the zone a typed city names when the field is left', () => {
    const { onCommit, input } = setup();
    type(input, 'london');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('Europe/London');
    expect(screen.queryByText(/Pick a zone from the list/)).toBeNull();
  });

  it('keeps an entry that names no single zone, unsaved, with a hint', () => {
    const { onCommit, input } = setup();
    type(input, 'europe');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('europe');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Pick a zone from the list. It stays Africa/Johannesburg until you do.')).toBeVisible();
    expect(screen.queryByRole('listbox')).toBeNull();
    // Back in the field the list returns; Escape gives the saved zone back.
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeVisible();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('Africa/Johannesburg');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not throw away an entry on Enter when nothing matches', () => {
    const { onCommit, input } = setup();
    type(input, 'atlantis');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('atlantis');
    expect(screen.getByText(/No time zone matches that/)).toBeVisible();
  });
});

describe('save feedback', () => {
  const keychain =
    'The macOS Keychain is not available to Remi. Install the keyring extra (uv sync --extra keyring) or set REMI_ANTHROPIC_API_KEY.';

  it("puts a field's failure under the field and only 'Not saved' in the header", () => {
    const state: SaveFeedback = { phase: 'error', message: keychain, visible: true, field: 'key', detail: null };
    render(
      <>
        <SaveNote state={state} />
        <FieldError state={state} field="key" />
        <FieldError state={state} field="model" />
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/^Not saved$/);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(keychain);
  });

  it("says a keychain failure in plain words and keeps the server's words as the title", () => {
    const error = new RemiApiError({ status: 409, code: 'KEYCHAIN_UNAVAILABLE', message: keychain });
    const calm = "Remi could not reach this computer's secure key store, so the key was not stored.";
    expect(saveError(error)).toEqual({ message: calm, detail: keychain });
    expect(saveErrorMessage(error)).toBe(calm);
    const state: SaveFeedback = { phase: 'error', ...saveError(error), visible: true, field: 'key' };
    render(<FieldError state={state} field="key" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(calm);
    expect(alert).not.toHaveTextContent(/uv sync|REMI_/);
    expect(alert).toHaveAttribute('title', keychain);
  });

  it("shows any other server message as it is, with no title", () => {
    const error = new RemiApiError({ status: 422, code: 'VALIDATION_ERROR', message: 'Remi only talks to Ollama on this Mac.' });
    expect(saveError(error)).toEqual({ message: 'Remi only talks to Ollama on this Mac.', detail: null });
    expect(saveError(new Error('x'))).toEqual({ message: 'Remi could not save that.', detail: null });
  });

  it('keeps a section-wide failure on one line with the full words as its title', () => {
    const state: SaveFeedback = {
      phase: 'error',
      message: 'Remi could not save that.',
      visible: true,
      field: null,
      detail: null,
    };
    render(<SaveNote state={state} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('Not saved · Remi could not save that.');
    expect(note).toHaveAttribute('title', 'Not saved · Remi could not save that.');
  });
});
