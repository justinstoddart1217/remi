import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

import { useTextbookPage, useTextbookTree } from '../../api';
import s from './Home.module.css';
import { textbookMeta } from './model';
import { excerptFor, firstPage, typedWidthPx } from './textbookExcerpt';
import type { ExcerptLine, PageExcerpt } from './textbookExcerpt';

const MENU: readonly (readonly [label: string, on: boolean])[] = [
  ['Heading', true],
  ['Formula', false],
  ['Callout', false],
  ['Link to project', false],
];

/** The empty page's copy (arch-frontend-screens §5, Textbook: "No pages yet."). */
const EMPTY_PREVIEW = {
  section: 'Textbook',
  title: 'First page',
  heading: 'Untitled',
  body: 'No pages yet. Start one in the Textbook and its opening lines show here.',
} as const;

interface Counts {
  pages: number;
  liveCharts: number;
}

/**
 * The Textbook card's preview (Remi Home.dc.html:117-147): the opening of the user's first page
 * (textbookExcerpt.ts), or a designed empty page before there are any. Hovering the card types
 * the next heading (steps over 520ms) with a still caret, lifts its number to full ink and opens
 * the slash menu 560ms later (all in Home.module.css).
 */
export function TextbookPreview({ counts }: { counts: Counts | undefined }) {
  const pages = counts?.pages;
  const tree = useTextbookTree();
  const first = firstPage(tree.data);
  const page = useTextbookPage(pages ? first?.id : null);
  const excerpt = excerptFor(pages, tree.data, page.data);

  let body: ReactNode = null;
  if (excerpt?.kind === 'sample') body = <SampleExcerpt />;
  else if (excerpt?.kind === 'empty') body = <EmptyExcerpt />;
  else if (excerpt?.kind === 'page') body = <RealExcerpt excerpt={excerpt} />;

  return (
    <div className={clsx(s.preview, s.previewText)}>
      {body}
      <div className={s.cardFoot}>
        <span className={s.meta}>Numbered sections · formulas · live charts</span>
        <span className={s.spacer} />
        <span className={s.meta}>{counts ? textbookMeta(counts.pages, counts.liveCharts) : ''}</span>
      </div>
    </div>
  );
}

function Crumb({ section, title }: { section: string; title: string }) {
  return (
    <div className={s.crumb}>
      <span className={s.crumbSection}>{section}</span>
      <span>/</span>
      <span className={s.crumbTitle}>{title}</span>
    </div>
  );
}

function SlashMenu({ style }: { style?: CSSProperties }) {
  return (
    <div className={s.slash} aria-hidden="true" style={style}>
      <span className={s.slashGlyph}>/</span>
      {MENU.map(([label, on]) => (
        <span key={label} className={clsx(s.chip, on && s.chipOn)}>
          {label}
        </span>
      ))}
    </div>
  );
}

/** The row the hover demo types into, for any heading text. */
function NextRow({ num, text }: { num: string; text: string }) {
  const n = Array.from(text).length;
  const vars = { '--typed-n': n, '--typed-steps': Math.max(1, n) } as CSSProperties;
  return (
    <div className={clsx(s.numRow, s.nextRow)} style={vars}>
      <span className={clsx(s.num, s.nextNum)}>{num}</span>
      <span className={s.typing}>
        <span className={clsx(s.typed, s.typedAny)}>{text}</span>
        <span className={s.caret} />
      </span>
      <SlashMenu style={{ left: `min(${String(66 + typedWidthPx(text))}px, calc(100% - 340px))` }} />
    </div>
  );
}

/** The design's hand-set excerpt of its sample page, exactly as the prototype draws it. */
function SampleExcerpt() {
  return (
    <>
      <div className={s.crumb}>
        <span className={s.crumbSection}>Fixed Income</span>
        <span>/</span>
        <span>Rates primer</span>
      </div>
      <div className={clsx(s.numRow, s.h1Row)}>
        <span className={clsx(s.num, s.h1Num)}>1</span>
        <span className={s.h1Text}>Rates and duration</span>
      </div>
      <div className={clsx(s.numRow, s.h2Row)}>
        <span className={s.num}>1.1</span>
        <span className={s.h2Text}>Price and yield</span>
      </div>
      <div className={s.para}>When yields rise, bond prices fall. For small moves:</div>
      <div className={s.formula}>ΔP / P ≈ −D × Δy</div>
      <div className={s.where}>
        where <span className={s.sym}>D</span> is modified duration and <span className={s.sym}>Δy</span> the change in yield.
      </div>
      <div className={clsx(s.numRow, s.nextRow)}>
        <span className={clsx(s.num, s.nextNum)}>1.2</span>
        <span className={s.typing}>
          <span className={s.typed}>Convexity</span>
          <span className={s.caret} />
        </span>
        <SlashMenu />
      </div>
    </>
  );
}

/** No pages yet: an untitled first page waiting to be written. */
function EmptyExcerpt() {
  return (
    <>
      <Crumb section={EMPTY_PREVIEW.section} title={EMPTY_PREVIEW.title} />
      <div className={clsx(s.numRow, s.h1Row)}>
        <span className={clsx(s.num, s.h1Num)}>1</span>
        <span className={clsx(s.h1Text, s.placeholder)}>{EMPTY_PREVIEW.heading}</span>
      </div>
      <div className={s.para}>{EMPTY_PREVIEW.body}</div>
      <NextRow num="1.1" text="" />
    </>
  );
}

/**
 * One line of a real page's opening. A formula reads as its plain Unicode text (`line.text`,
 * 'x² + Σ₀'): it is an image of the formula (role="img", whose runs are presentational), since
 * ARIA gives no name to a plain div and the raised and lowered runs read piecemeal.
 */
export function ExcerptLineView({ line }: { line: ExcerptLine }) {
  switch (line.kind) {
    case 'h1':
      return (
        <div className={clsx(s.numRow, s.h1Row)}>
          <span className={clsx(s.num, s.h1Num)}>{line.num}</span>
          <span className={clsx(s.h1Text, s.clip)}>{line.text}</span>
        </div>
      );
    case 'h2':
    case 'h3':
      return (
        <div className={clsx(s.numRow, s.h2Row)}>
          <span className={s.num}>{line.num}</span>
          <span className={clsx(line.kind === 'h2' ? s.h2Text : s.h3Text, s.clip)}>{line.text}</span>
        </div>
      );
    case 'para':
      return <div className={clsx(s.para, s.clamp)}>{line.text}</div>;
    case 'formula':
      return (
        <div className={clsx(s.formula, s.clip)} role="img" aria-label={line.text}>
          {line.runs.map((r, k) =>
            r.script === 'sub' ? <sub key={k}>{r.t}</sub> : r.script === 'sup' ? <sup key={k}>{r.t}</sup> : r.t,
          )}
        </div>
      );
    case 'chart':
      return <div className={clsx(s.where, s.clip)}>{line.text}</div>;
  }
}

/** The opening of the user's own first page. */
function RealExcerpt({ excerpt }: { excerpt: PageExcerpt }) {
  return (
    <>
      <Crumb section={excerpt.section} title={excerpt.title} />
      {excerpt.lines.length === 0 ? <div className={s.para}>Nothing written on this page yet.</div> : null}
      {excerpt.lines.map((line, k) => (
        <ExcerptLineView key={k} line={line} />
      ))}
      <NextRow num={excerpt.next.num} text={excerpt.next.text} />
    </>
  );
}
