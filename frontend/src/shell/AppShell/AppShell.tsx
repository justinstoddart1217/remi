import { useOverlays } from '../../stores/overlays';
import { CommandPalette } from '../CommandPalette';
import { DrawerHost } from '../DrawerHost';
import { HeaderBar } from '../HeaderBar';
import { ScreenStack } from '../ScreenStack';
import { Stage } from '../Stage';
import { useActiveScreen } from '../useActiveScreen';
import s from './AppShell.module.css';
import { useShellRoute } from './useShellRoute';

/**
 * The /app layout (Remi.dc.html "Remi app", the Ninety One redesign): one column, the 66px
 * dark-teal top bar (brand, screen tabs, status) over <main>, with the drawer (z 20) and the
 * palette (z 30) layers over everything. While an overlay is open the column is inert.
 */
export function AppShell() {
  const active = useActiveScreen();
  const drawerOpen = useOverlays((st) => st.drawer.open);
  const paletteOpen = useOverlays((st) => st.palette.open);
  useShellRoute(active);
  const covered = drawerOpen || paletteOpen;

  return (
    <Stage label="Remi app" className={s.grid}>
      <div className={s.column} inert={covered}>
        <HeaderBar />
        <ScreenStack />
      </div>
      <DrawerHost />
      <CommandPalette />
    </Stage>
  );
}
