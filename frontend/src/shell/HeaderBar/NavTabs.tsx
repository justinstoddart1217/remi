import { useGo } from '../../app/navigation';
import { NAV_ITEMS } from '../../app/screens';
import { Icon } from '../../components/Icon';
import { useActiveScreen } from '../useActiveScreen';
import s from './HeaderBar.module.css';

/**
 * The seven screen tabs of the top bar (Remi.dc.html <header> <nav>): icon and label, white on
 * the active tab and 62% white otherwise, with a 2px Ninety One teal underline that grows from
 * the left over the 440ms spring. Projects stays active on the workspace.
 *
 * They are buttons, as in the design (the harness and the egress crawl click them in
 * `nav[aria-label="Screens"]`), and the active one carries `aria-current="page"`. In a bar
 * narrower than the design's (below 1680px, a small 'Fit window'), the labels are visually
 * hidden and the tabs are icons with their tooltips; the labels stay the buttons' names.
 */
export function NavTabs() {
  const active = useActiveScreen();
  const go = useGo();
  return (
    <nav className={s.nav} aria-label="Screens">
      {NAV_ITEMS.map((item) => {
        const on = active === item.id || (item.id === 'projects' && active === 'workspace');
        return (
          <button
            key={item.id}
            type="button"
            className={s.tab}
            title={item.label}
            aria-current={on ? 'page' : undefined}
            data-active={on ? '' : undefined}
            onClick={() => {
              go(item.id);
            }}
          >
            <Icon name={item.icon} className={s.tabIcon} />
            <span className={s.tabLabel}>{item.label}</span>
            <span className={s.tabInk} aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
