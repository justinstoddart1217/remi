import { NAV_ITEMS } from '../../app/screens';
import type { PaletteProvider } from './types';

/**
 * 'Jump to': the seven screens (Remi.dc.html paletteGroups). Hidden in quick-add mode;
 * otherwise matched by substring of the label.
 */
export const jumpToProvider: PaletteProvider = {
  id: 'jump-to',
  order: 20,
  items: ({ q, quickAdd, actions }) => {
    if (quickAdd) return [];
    return NAV_ITEMS.filter((screen) => !q || screen.label.toLowerCase().includes(q)).map((screen) => ({
      key: screen.id,
      group: 'Jump to',
      label: screen.label,
      hint: '',
      dot: 'var(--hairline)',
      run: () => {
        actions.go(screen.id);
      },
    }));
  },
};
