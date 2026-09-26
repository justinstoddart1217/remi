import clsx from 'clsx';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { chartUrl } from '../../api';
import { Icon } from '../../components';
import { AutoTextarea } from './AutoTextarea';
import { CHART_SIZES } from './editor';
import type { ChartBlock } from './editor';
import s from './Textbook.module.css';

interface Props {
  block: ChartBlock;
  /** Bumped by Replay and Replace: a new key remounts the frame, so the chart starts again. */
  frameKey: number;
  /** Frames ignore the pointer while something is dragged or resized (:669). */
  still: boolean;
  resizing: boolean;
  /** A file is being dragged over the page: the empty block lights up (:593). */
  dropping: boolean;
  onSize: (height: number) => void;
  onReplay: () => void;
  onReplace: () => void;
  onFull: () => void;
  onRemove: () => void;
  onCaption: (caption: string) => void;
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeEnd: () => void;
}

/**
 * A live chart block (Remi Textbook.dc.html:232-261). The HTML runs in an iframe loaded from
 * `GET /api/charts/{id}` with `sandbox="allow-scripts"` only: no same-origin, so it can reach
 * neither the app nor its storage, and the server's CSP stops it from loading anything. Without
 * a file yet it is the 180px hatched drop target.
 */
export function ChartBlockView(p: Props) {
  const b = p.block;
  if (b.assetId === null) {
    return (
      <div className={s.chartWrap}>
        <button type="button" className={s.chartEmpty} data-drop={p.dropping} onClick={p.onReplace}>
          <Icon name="insert_chart" />
          <span className={s.chartEmptyTitle}>Drop an HTML chart here</span>
          <span className={s.chartEmptyHint}>or click to browse · made in Claude Design or Claude Code</span>
        </button>
      </div>
    );
  }
  const name = b.name || 'chart.html';
  return (
    <div className={s.chartWrap}>
      <div className={s.chartFrame}>
        <div className={s.chartBar}>
          <span className={s.fiDot} />
          <span className={s.live}>Live</span>
          <span className={s.chartName}>{name}</span>
          <div className={s.sizes} role="group" aria-label="Chart height">
            {CHART_SIZES.map(([label, height]) => (
              <button
                key={label}
                type="button"
                className={s.size}
                data-on={b.height === height}
                aria-pressed={b.height === height}
                onClick={() => {
                  p.onSize(height);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className={s.chartText} title="Replay" onClick={p.onReplay}>
            Replay
          </button>
          <button type="button" className={s.chartText} title="Replace with another file" onClick={p.onReplace}>
            Replace
          </button>
          <button type="button" className={s.chartIcon} title="Full screen" onClick={p.onFull}>
            <Icon name="open_in_full" />
          </button>
          <button type="button" className={clsx(s.chartIcon, s.danger)} title="Remove chart" onClick={p.onRemove}>
            <Icon name="delete" />
          </button>
        </div>
        <iframe
          key={p.frameKey}
          title={name}
          src={chartUrl(b.assetId)}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className={s.frame}
          data-still={p.still}
          data-resizing={p.resizing}
          style={{ height: b.height }}
        />
        <div
          className={s.resize}
          title="Drag to resize"
          onPointerDown={p.onResizeStart}
          onPointerMove={p.onResizeMove}
          onPointerUp={p.onResizeEnd}
          onPointerCancel={p.onResizeEnd}
        >
          <span />
        </div>
      </div>
      <AutoTextarea
        data-bid={`${b.id}:cap`}
        className={s.caption}
        value={b.caption}
        placeholder="Add a caption: what should the reader notice?"
        aria-label="Chart caption"
        onChange={(e) => {
          p.onCaption(e.target.value);
        }}
      />
    </div>
  );
}
