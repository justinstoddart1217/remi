import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon';
import { ICON_CODEPOINTS } from './icons.generated';

describe('Icon', () => {
  it('renders the ligature name and is decorative by default', () => {
    const { container } = render(<Icon name="search" />);
    const el = container.querySelector('[data-icon="search"]');
    expect(el).toHaveTextContent('search');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('can render the codepoint and carry an accessible label', () => {
    render(<Icon name="settings" render="codepoint" label="Settings" />);
    const el = screen.getByRole('img', { name: 'Settings' });
    expect(el.textContent).toBe(String.fromCodePoint(ICON_CODEPOINTS.settings));
  });

  it('sets only the variation axes it is given', () => {
    const { container } = render(<Icon name="today" fill={1} opsz={24} />);
    const el = container.querySelector<HTMLElement>('[data-icon="today"]');
    expect(el?.style.fontVariationSettings).toBe("'FILL' 1, 'opsz' 24");
  });

  it('covers the 22 icons of the redesigned Remi.dc.html, plus the Textbook and Settings icons: 33 in all', () => {
    // The Material Symbols icon_names of "Remi Dashboard Design Review/Remi.dc.html" (Ninety One redesign).
    const shell = [
      'add', 'arrow_forward', 'calendar_month', 'check', 'chevron_left', 'chevron_right', 'close', 'close_fullscreen',
      'edit_note', 'left_panel_close', 'left_panel_open', 'north_east', 'notes', 'open_in_full', 'repeat',
      'right_panel_close', 'right_panel_open', 'search', 'stacks', 'today', 'unfold_more', 'view_timeline',
    ];
    expect(Object.keys(ICON_CODEPOINTS)).toEqual(expect.arrayContaining(shell));
    expect(Object.keys(ICON_CODEPOINTS)).toHaveLength(33);
  });
});
