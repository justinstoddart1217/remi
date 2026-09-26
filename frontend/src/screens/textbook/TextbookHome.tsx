import clsx from 'clsx';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { chartUrl, useTextbookHome } from '../../api';
import { Icon, Toast } from '../../components';
import { count } from '../../lib/format';
import { afterTwoFrames } from '../../lib/timers';
import { useTextbook } from './context';
import { editedWhen } from './editor';
import { OutlineNav } from './OutlineNav';
import s from './Textbook.module.css';
import { TopBar } from './TopBar';
import { HOME_CRUMB, homeSub, sectionLabel, titleOf, topPageMeta } from './tree';

const vars = (v: Record<string, string>) => v as CSSProperties;

/** The banner's drifting bars (Remi Textbook.dc.html:132): x, y, width, height, drift, seconds, delay. */
const HERO_BARS: readonly (readonly [x: number, y: number, w: number, h: number, drift: 'A' | 'B', dur: number, delay: number])[] = [
  [52, -20, 16, 120, 'A', 9, 0],
  [84, 46, 18, 150, 'B', 11, -2],
  [120, -20, 22, 88, 'A', 13, -5],
  [150, 70, 20, 140, 'B', 8, -1],
  [186, -20, 18, 112, 'A', 10, -4],
];

function HeroBars() {
  return (
    <div className={s.heroBars} aria-hidden="true">
      <svg viewBox="0 0 240 200" preserveAspectRatio="xMaxYMid slice">
        <g transform="rotate(9 240 0)">
          {HERO_BARS.map(([x, y, w, h, drift, dur, delay]) => (
            <rect
              key={x}
              x={x}
              y={y}
              width={w}
              height={h}
              className={drift === 'A' ? s.driftA : s.driftB}
              style={vars({ '--drift-dur': `${String(dur)}s`, '--drift-delay': `${String(delay)}s` })}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

/**
 * Textbook home (Remi Textbook.dc.html:129-189): the dark-teal banner with the counts, the
 * section cards, recently edited pages and the live charts, all from `GET /textbook/home`.
 */
export function TextbookHome({ fade, fadeIn }: { fade: boolean; fadeIn: boolean }) {
  const tb = useTextbook();
  const [entering, setEntering] = useState(fadeIn);
  useEffect(() => {
    if (!fadeIn) return;
    return afterTwoFrames(() => {
      setEntering(false);
    });
  }, [fadeIn]);
  const query = useTextbookHome();
  const home = query.data;
  const accentOf = new Map((home?.sections ?? []).map((c) => [c.id, c.accent]));

  return (
    <>
      <main className={s.main}>
        <TopBar crumb={HOME_CRUMB} />
        <div className={s.scroll}>
          <div className={clsx(s.home, s.fx)} data-fade={fade || entering}>
            <div className={s.hero}>
              <HeroBars />
              <div className={s.heroEyebrow}>Textbook</div>
              <h1 className={s.homeH1}>Everything you have written down</h1>
              <div className={s.homeSub}>{home ? homeSub(home.counts) : ' '}</div>
              <span className={s.heroFlow} aria-hidden="true" />
            </div>

            {query.isError && !home ? (
              <div className={s.homeError}>
                The Textbook didn’t load.{' '}
                <button
                  type="button"
                  className={s.inlineLink}
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  Try again
                </button>
              </div>
            ) : null}

            <div className={clsx(s.rule, s.sectionsRule)}>
              <span className={s.ruleBrand}>Sections</span>
              <button type="button" className={s.outlineButton} onClick={tb.addSection}>
                <Icon name="add" />
                New section
              </button>
            </div>
            <div className={s.cards}>
              {(home?.sections ?? []).map((c, i) => (
                <div key={c.id} className={s.secCard} style={vars({ '--accent': c.accent, '--d': `${String(i * 50)}ms` })}>
                  <div className={s.secCardHead}>
                    <span className={s.secCardLabel}>{sectionLabel(c.label)}</span>
                    <span className={s.spacer} />
                    <span className={s.count11}>{count(c.pageCount, 'page')}</span>
                  </div>
                  <div className={s.secCardList}>
                    {c.topPages.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={s.secCardPage}
                        onClick={() => {
                          tb.openPage(p.id);
                        }}
                      >
                        <Icon name="description" />
                        <span className={s.secCardTitle}>{titleOf(p.title)}</span>
                        <span className={s.mono10}>{topPageMeta(p.descendantCount, p.chartCount)}</span>
                      </button>
                    ))}
                    {c.moreCount > 0 ? <span className={s.more}>{`+ ${String(c.moreCount)} more`}</span> : null}
                    {c.pageCount === 0 ? <span className={s.noPages}>No pages yet.</span> : null}
                  </div>
                  <span className={s.spacer} />
                  <button
                    type="button"
                    className={s.newPage}
                    onClick={() => {
                      tb.newPageIn(c.id);
                    }}
                  >
                    <Icon name="add" />
                    New page
                  </button>
                </div>
              ))}
            </div>

            <div className={s.homeCols}>
              <div>
                <div className={s.rule}>
                  <span className={s.ruleTitle}>Recently edited</span>
                </div>
                {(home?.recent ?? []).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={s.recent}
                    onClick={() => {
                      tb.openPage(r.id);
                    }}
                  >
                    <span className={s.recentHead}>
                      <span className={s.recentDot} style={{ background: accentOf.get(r.sectionId) ?? 'var(--ink-faint)' }} />
                      <span className={s.recentTitle}>{titleOf(r.title)}</span>
                      <span className={s.spacer} />
                      <span className={s.count11}>{editedWhen(r.updatedAt)}</span>
                    </span>
                    <span className={s.recentPath}>{r.path.join(' / ')}</span>
                    {r.snippet ? <span className={s.recentSnippet}>{r.snippet}</span> : null}
                  </button>
                ))}
                {home?.recent.length === 0 ? <div className={s.noCharts}>No pages yet.</div> : null}
              </div>
              <div>
                <div className={s.rule}>
                  <span className={s.ruleBrand}>Live charts</span>
                  <span className={s.mono12}>{home ? String(home.counts.charts) : ''}</span>
                </div>
                <div className={s.chartGrid}>
                  {(home?.charts ?? []).map((c) => (
                    <button
                      key={c.blockId}
                      type="button"
                      className={s.chartCard}
                      onClick={() => {
                        tb.openPage(c.pageId);
                      }}
                    >
                      <iframe
                        title={c.name}
                        src={chartUrl(c.assetId)}
                        sandbox="allow-scripts"
                        referrerPolicy="no-referrer"
                        tabIndex={-1}
                        className={s.chartThumb}
                      />
                      <span className={s.chartCardFoot}>
                        <span className={s.fiDot} />
                        <span className={s.count11}>{c.name || 'chart.html'}</span>
                        <span className={s.spacer} />
                        <span className={s.chartCardPage}>{titleOf(c.pageTitle)}</span>
                      </span>
                    </button>
                  ))}
                  {home?.charts.length === 0 ? (
                    <div className={s.noCharts}>No live charts yet. Drop an HTML chart from Claude onto any page.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div className={s.toastDock}>
            <Toast message={tb.toastMessage} className={s.toast} />
          </div>
        </div>
      </main>
      <OutlineNav items={[]} empty="Open a page to see its numbered outline." />
    </>
  );
}
