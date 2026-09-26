import { memo } from 'react';

import { Button, IconButton, SegmentedControl } from '../../components';
import type { Zoom } from './geometry';
import s from './Timeline.module.css';

const ZOOM_OPTIONS = [
  { value: '2w', label: '2 weeks' },
  { value: '3m', label: '3 months' },
] as const;

interface Props {
  title: string;
  subtitle: string;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  onPrev: () => void;
  onThisWeek: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}

/** Eyebrow, title and window, the legend, the two-week pan and the zoom (Timeline.dc.html:12-40). */
export const TopBar = memo(function TopBar({ title, subtitle, zoom, onZoom, onPrev, onThisWeek, onNext, canPrev, canNext }: Props) {
  const panning = zoom === '2w';
  return (
    <div className={s.top}>
      <div className={s.titleBlock}>
        <div className={s.eyebrow}>Timeline</div>
        <div className={s.titleRow}>
          <h1 className={s.title} tabIndex={-1}>
            {title}
          </h1>
          <span className={s.subtitle}>{subtitle}</span>
        </div>
      </div>
      <div className={s.spacer} />
      <Legend />
      <div className={s.pan} data-shown={panning} inert={!panning}>
        <IconButton icon="chevron_left" label="Previous week" variant="raised" size={32} iconSize={18} onClick={onPrev} disabled={!canPrev} />
        <Button variant="raised" size="s" onClick={onThisWeek}>
          This week
        </Button>
        <IconButton icon="chevron_right" label="Next week" variant="raised" size={32} iconSize={18} onClick={onNext} disabled={!canNext} />
      </div>
      <SegmentedControl label="Zoom" options={ZOOM_OPTIONS} value={zoom} onChange={onZoom} variant="pill" itemWidth={96} />
    </div>
  );
});

/** The legend swatches (critique :22-28). The Target glyph is a centred T here, a Γ in the chart. */
function Legend() {
  return (
    <div className={s.legend} aria-hidden="true">
      <span className={s.legendItem}>
        <span className={s.swBau} />
        BAU
      </span>
      <span className={s.legendItem}>
        <span className={s.swProject} />
        Project
      </span>
      <span className={s.legendItem}>
        <span className={s.swPast} />
        Past target
      </span>
      <span className={s.legendItem}>
        <span className={s.swPrev} />
        Previous plan
      </span>
      <span className={s.legendItem}>
        <span className={s.swMilestone} />
        Milestone
      </span>
      <span className={s.legendItem}>
        <span className={s.swTarget}>
          <span className={s.swTargetUp} />
          <span className={s.swTargetBar} />
        </span>
        Target
      </span>
      <span className={s.legendItem}>
        <span className={s.swOverload} />
        Overload
      </span>
    </div>
  );
}
