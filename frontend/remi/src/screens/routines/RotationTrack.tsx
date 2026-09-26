import type { CSSProperties } from 'react';

import { Icon, RotationTile } from '../../components';
import { COPY } from './model';
import type { TrackModel, TrackTile } from './model';
import s from './Routines.module.css';

function Tile({ tile }: { tile: TrackTile }) {
  return (
    <RotationTile
      size="l"
      index={tile.index}
      code={tile.code}
      country={tile.country}
      pass={tile.pass}
      dates={tile.dates}
      current={tile.current}
      {...(tile.extra ? { extra: tile.extra } : {})}
      {...(tile.flag ? { flag: tile.flag } : {})}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{value}</div>
    </div>
  );
}

/**
 * The Fixed Income rotation as a stadium (Routines.dc.html:99-142): a pill outline behind two
 * rows of tiles, read clockwise (top left to right, bottom right to left), with the loop's
 * figures in the middle band. Read-only: the rotation is edited in Settings.
 */
export function RotationTrack({ track }: { track: TrackModel }) {
  const cols = { gridTemplateColumns: `repeat(${String(track.columns)}, minmax(0, 1fr))` } as CSSProperties;
  return (
    <div className={s.track}>
      <div className={s.stadium} aria-hidden="true" />
      <div className={s.chevron} data-side="right" aria-hidden="true">
        <Icon name="chevron_right" className={s.chevronIcon} />
      </div>
      <div className={s.chevron} data-side="left" aria-hidden="true">
        <Icon name="chevron_right" className={s.chevronIcon} />
      </div>
      {track.now && (
        <div className={s.now}>
          <span className={s.nowLabel}>Now</span>
          <span className={s.nowText}>{track.now}</span>
        </div>
      )}

      <div className={s.tiles} style={cols}>
        {track.top.map((t) => (
          <Tile key={t.id} tile={t} />
        ))}
      </div>

      <div className={s.band}>
        <div className={s.stats}>
          <Stat label="Loop 1" value={track.loop} />
          <div className={s.divider} />
          <Stat label="Estimated completion" value={track.completion} />
          {track.then && (
            <>
              <div className={s.divider} />
              <Stat label="Then" value={track.then} />
            </>
          )}
        </div>
      </div>

      <div className={s.tiles} style={cols}>
        {track.bottom.map((t) => (
          <Tile key={t.id} tile={t} />
        ))}
      </div>
    </div>
  );
}

/** The pass chips' legend under the track. */
export function RotationLegend() {
  return (
    <div className={s.legend}>
      <span className={s.legendItem}>
        <span className={s.legendChip} data-pass="Build">
          Build
        </span>
        {COPY.buildLegend}
      </span>
      <span className={s.legendItem}>
        <span className={s.legendChip} data-pass="Refresh">
          Refresh
        </span>
        {COPY.refreshLegend}
      </span>
    </div>
  );
}
