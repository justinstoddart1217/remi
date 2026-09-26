import clsx from 'clsx';
import type { CSSProperties, KeyboardEvent } from 'react';

import { BauChip, CapacityBar, DOMAIN_ACCENT } from '../../components';
import type { LoadItem } from '../../components';
import { hoverHandlers, isDimmed, useHover } from '../../stores/hover';
import type { HoverKey } from '../../stores/hover';
import { loadItemKey } from './model';
import type { WeekCard, WeekModel } from './model';
import s from './Today.module.css';
import { useScreenHoverKey } from '../linkedHover';

const enter = (item: LoadItem) => {
  useHover.getState().set(loadItemKey(item));
};
const leave = () => {
  useHover.getState().clear();
};

function DayCard({
  card,
  arrived,
  hovered,
  onPick,
}: {
  card: WeekCard;
  arrived: boolean;
  hovered: HoverKey | null;
  onPick: (iso: string) => void;
}) {
  // The linked highlight: `--linked-dim` everywhere (Foundations), by [data-dim].
  const dimmed = (own: HoverKey) => isDimmed(hovered, own);
  const pick = () => {
    onPick(card.iso);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={s.card}
      aria-pressed={card.selected}
      aria-label={`${card.label}${card.isToday ? ', today' : ''}, ${card.bd}, ${card.loadLabel}`}
      onClick={pick}
      onKeyDown={onKeyDown}
    >
      <div className={s.cardHead}>
        <span className={s.cardLabel}>
          {card.label}
          {card.isToday && <span className={s.todayTag}>today</span>}
        </span>
        <span className={s.cardBd}>{card.bd}</span>
      </div>
      {card.load && (
        <CapacityBar
          variant="mini"
          load={card.load}
          arrived={arrived}
          pulseKey={card.iso}
          itemDimmed={(item) => isDimmed(hovered, loadItemKey(item))}
          onItemEnter={enter}
          onItemLeave={leave}
        />
      )}
      <span className={s.cardLoad} data-over={card.over ? '' : undefined}>
        {card.loadLabel}
      </span>
      <div className={s.cardStack}>
        {card.chips.map((c) => (
          <BauChip
            key={c.key}
            compact
            plain={c.milestone}
            domain={c.domain}
            accent={DOMAIN_ACCENT[c.domain]}
            title={c.label}
            className={s.chip}
            dimmed={dimmed(c.hover)}
            {...hoverHandlers(c.hover)}
          >
            {c.label}
          </BauChip>
        ))}
        {card.items.map((i) => (
          <div key={i.key} className={s.weekItem} data-dim={dimmed(i.hover) ? 'true' : undefined} {...hoverHandlers(i.hover)}>
            <span className={s.weekItemName}>{i.name}</span>
            <span className={s.weekItemBar}>
              <span className={s.weekItemFill} data-domain={i.domain} style={{ width: i.width }} />
              <span className={s.weekItemH}>{i.h}</span>
            </span>
          </div>
        ))}
        {card.more && <span className={s.more}>{card.more}</span>}
      </div>
    </div>
  );
}

export interface WeekStripProps {
  model: WeekModel;
  arrived: boolean;
  onPick: (iso: string) => void;
  style?: CSSProperties;
}

/**
 * Today.dc.html:143-178, the week card: Monday to Friday of the shown day's week, the day cards
 * stretching to the card's height. A holiday keeps its column
 * empty, in place (critique CORRECTION :334), instead of shifting the later days left.
 */
export function WeekStrip({ model, arrived, onPick, style }: WeekStripProps) {
  const hovered = useScreenHoverKey();
  return (
    <div className={clsx(s.panel, s.weekCard, s.arrive)} style={style}>
      <div className={s.weekHead}>
        <span className={s.sectionTitle}>{model.title}</span>
        <span className={s.weekSub}>{model.sub}</span>
      </div>
      <div className={s.week}>
        {/* Keyed by column, so bars glide from the previous week's values as the prototype's. */}
        {model.slots.map((slot, k) =>
          slot.kind === 'gap' ? (
            <div key={`gap:${String(k)}`} className={s.gap} aria-hidden="true" title={slot.holiday ?? undefined} />
          ) : (
            <DayCard key={`day:${String(k)}`} card={slot} arrived={arrived} hovered={hovered} onPick={onPick} />
          ),
        )}
      </div>
    </div>
  );
}
