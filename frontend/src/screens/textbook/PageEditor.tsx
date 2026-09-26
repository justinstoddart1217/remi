import clsx from 'clsx';
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { chartUrl, isRemiApiError, useUploadChart } from '../../api';
import type { PageOut } from '../../api';
import { Icon, Toast, TwoStepConfirmButton } from '../../components';
import { captureFocus } from '../../lib/focus';
import { count } from '../../lib/format';
import { useStage } from '../../lib/stage';
import { afterTwoFrames } from '../../lib/timers';
import { AutoTextarea } from './AutoTextarea';
import { ChartBlockView } from './ChartBlockView';
import { useTextbook } from './context';
import {
  clampChartHeight,
  dropIndex,
  editorReducer,
  filterSlash,
  headingNumbers,
  isHtmlFile,
  isText,
  liveCharts,
  localDate,
  makeBlock,
  markdownShortcut,
  MAX_CHART_BYTES,
  metaLine,
  newId,
  outlineOf,
  slashOptionId,
  slashQuery,
} from './editor';
import type { Block, BlockType, ChartBlock, EditorAction, TextBlock } from './editor';
import { MathView } from './MathView';
import { OutlineNav } from './OutlineNav';
import { SlashMenu } from './SlashMenu';
import type { SlashAnchor } from './SlashMenu';
import s from './Textbook.module.css';
import { TopBar } from './TopBar';
import { crumbFor, descendantsOf, titleOf } from './tree';

type Pos = number | 'end';

interface Slash {
  bid: string;
  q: string;
  i: number;
  anchor: SlashAnchor;
}

interface Resize {
  bid: string;
  y0: number;
  h0: number;
}

/** Heading metrics (:573): size class, number size, number column. */
const HEAD = {
  h1: { cls: s.h1, numFs: 14, numW: 44 },
  h2: { cls: s.h2, numFs: 13, numW: 52 },
  h3: { cls: s.h3, numFs: 12, numW: 60 },
} as const;

const TYPE_LABEL: Record<BlockType, string> = {
  p: 'Paragraph',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bullet: 'Bullet',
  callout: 'Callout',
  formula: 'Formula',
  page: 'Page inside',
  chart: 'Live chart',
  divider: 'Divider',
};

const hasFiles = (e: ReactDragEvent) => [...e.dataTransfer.types].includes('Files');

interface Props {
  page: PageOut;
  /** The page is fading out (a page switch is under way). */
  fade: boolean;
  /** Fade in on mount (the page was opened from inside the Textbook). */
  fadeIn: boolean;
}

/**
 * One Textbook page (Remi Textbook.dc.html:101-330): the top bar, the numbered title and
 * blocks, the slash menu, drag reorder with its drop line, live charts (upload, resize, replay,
 * replace, full screen), the file drop overlay, the toast, and the outline column. Blocks are
 * edited locally and autosaved (usePageSaver); the server's version guards every save.
 */
export function PageEditor({ page, fade, fadeIn }: Props) {
  const tb = useTextbook();
  const { saver, setLive, toast, takeFocusTitle } = tb;
  const pageId = page.id;
  const stage = useStage();
  const upload = useUploadChart();

  const [blocks, setBlocks] = useState<Block[]>(() => saver.pendingBlocks(page.id) ?? page.blocks);
  const [title, setTitle] = useState(page.title);
  const [initial] = useState(() => ({ version: page.version, blocks: page.blocks }));
  const [editedAt, setEditedAt] = useState(page.updatedAt);
  const [editF, setEditF] = useState<string | null>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const slashMenuId = useId();
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const [dropFiles, setDropFiles] = useState(false);
  const [resizing, setResizing] = useState<Resize | null>(null);
  const [frameKeys, setFrameKeys] = useState<Readonly<Record<string, number>>>({});
  const [full, setFull] = useState<string | null>(null);
  const [entering, setEntering] = useState(fadeIn);

  const blocksRef = useRef(blocks);
  const titleRef = useRef(title);
  const mainRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ bid: string; pos: Pos } | null>(null);
  /** A formula whose editor just closed by Escape: its display takes the focus back. */
  const pendingFormula = useRef<string | null>(null);
  /** Puts focus back where the full-screen chart was opened from (its 'Full screen' button). */
  const fullReturn = useRef<(() => void) | null>(null);
  const replaceBid = useRef<string | null>(null);
  const dropAt = useRef<number | null>(null);
  const dragBid = useRef<string | null>(null);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---------------------------------------------------------------- lifecycle
  useEffect(() => {
    saver.loaded(pageId, initial.version, initial.blocks);
  }, [saver, pageId, initial]);

  useEffect(() => {
    if (!fadeIn) return;
    return afterTwoFrames(() => {
      setEntering(false);
    });
  }, [fadeIn]);

  useEffect(
    () => () => {
      clearTimeout(freshTimer.current);
    },
    [],
  );

  const focusNow = (bid: string, pos: Pos): boolean => {
    const el = mainRef.current?.querySelector<HTMLTextAreaElement>(`[data-bid="${CSS.escape(bid)}"]`);
    if (!el) return false;
    el.focus();
    const n = pos === 'end' ? el.value.length : pos;
    try {
      el.setSelectionRange(n, n);
    } catch {
      // Not a text field.
    }
    return true;
  };

  // A new page's title takes the focus; otherwise any focus asked for by the last change.
  useLayoutEffect(() => {
    if (pendingFormula.current) {
      const bid = pendingFormula.current;
      pendingFormula.current = null;
      mainRef.current?.querySelector<HTMLElement>(`[data-formula="${CSS.escape(bid)}"]`)?.focus();
    }
    if (takeFocusTitle(pageId)) pendingFocus.current = { bid: '__title', pos: 0 };
    const want = pendingFocus.current;
    if (!want) return;
    const el = mainRef.current?.querySelector<HTMLTextAreaElement>(`[data-bid="${CSS.escape(want.bid)}"]`);
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
    const n = want.pos === 'end' ? el.value.length : want.pos;
    try {
      el.setSelectionRange(n, n);
    } catch {
      // Not a text field.
    }
  });

  /**
   * The full-screen chart covers the main column only (arch-frontend-screens: the sidebar and
   * the outline stay usable), so it is a non-modal dialog: the page under it is inert while it
   * is open, Close takes the focus, and closing puts the focus back on the button that opened
   * it.
   */
  const openFull = (id: string) => {
    fullReturn.current = captureFocus();
    setFull(id);
  };
  const closeFull = useCallback(() => {
    setFull(null);
    const back = fullReturn.current;
    fullReturn.current = null;
    // After the page under it is no longer inert.
    requestAnimationFrame(() => back?.());
  }, []);

  // Escape closes the full-screen chart first, then the slash menu (:392).
  useEffect(() => {
    if (!full && !slash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (full) closeFull();
      else setSlash(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [full, slash, closeFull]);

  useEffect(() => {
    if (full) closeRef.current?.focus();
  }, [full]);

  // ---------------------------------------------------------------- edits
  const act = (a: EditorAction) => {
    const prev = blocksRef.current;
    const next = editorReducer(prev, a);
    if (next === prev) return;
    blocksRef.current = next;
    setBlocks(next);
    setEditedAt(new Date().toISOString());
    saver.schedule(pageId, next);
    const charts = liveCharts(next);
    if (charts !== liveCharts(prev)) setLive({ pageId, title: titleRef.current, charts });
  };

  const markFresh = (id: string) => {
    setJustAdded(id);
    clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => {
      setJustAdded(null);
    }, 60);
  };

  const insertAt = (index: number, block: Block, focus = true) => {
    act({ type: 'insert', index, block });
    if (focus) pendingFocus.current = { bid: block.id, pos: 0 };
    markFresh(block.id);
  };

  const indexOf = (id: string) => blocksRef.current.findIndex((b) => b.id === id);

  /** The nearest text block before (-1) or after (+1) index `i` (:528). */
  const textNeighbour = (i: number, dir: -1 | 1): TextBlock | null => {
    const bl = blocksRef.current;
    for (let k = i + dir; k >= 0 && k < bl.length; k += dir) {
      const b = bl[k];
      if (b && isText(b)) return b;
    }
    return null;
  };

  const anchorOf = (el: HTMLElement): SlashAnchor => {
    const main = mainRef.current;
    if (!main) return { x: 0, top: 0, bottom: 0 };
    const m = main.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const k = m.width > 0 ? main.offsetWidth / m.width : 1;
    return { x: Math.max(0, (r.left - m.left) * k), top: (r.top - m.top) * k, bottom: (r.bottom - m.top) * k };
  };

  const openFilePicker = () => {
    fileRef.current?.click();
  };

  /** Turns block `bid` into `type` (the slash menu, :481-489). */
  const applySlash = (bid: string, type: BlockType) => {
    setSlash(null);
    const i = indexOf(bid);
    if (i < 0) return;
    if (type === 'page') {
      tb.createSub(pageId, bid);
      return;
    }
    act({ type: 'replace', id: bid, block: makeBlock(type, bid) });
    if (type === 'divider') {
      insertAt(i + 1, makeBlock('p'));
      return;
    }
    if (type === 'chart') {
      replaceBid.current = bid;
      setTimeout(openFilePicker, 30);
      return;
    }
    if (type === 'formula') setEditF(bid);
    pendingFocus.current = { bid, pos: 0 };
  };

  const onTitle = (value: string) => {
    const v = value.replace(/\n/g, '');
    titleRef.current = v;
    setTitle(v);
    setEditedAt(new Date().toISOString());
    saver.scheduleTitle(pageId, v);
    setLive({ pageId, title: v, charts: liveCharts(blocksRef.current) });
  };

  const onTitleKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || (e.key !== 'Enter' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const first = blocksRef.current.find(isText);
    if (first) focusNow(first.id, 0);
    else insertAt(0, makeBlock('p'));
  };

  const onTextChange = (b: TextBlock, el: HTMLTextAreaElement) => {
    const v = el.value;
    const md = markdownShortcut(b.type, v);
    if (md === 'divider') {
      applySlash(b.id, 'divider');
      return;
    }
    if (md) {
      setSlash(null);
      act({ type: 'replace', id: b.id, block: makeBlock(md, b.id) });
      if (md === 'formula') setEditF(b.id);
      pendingFocus.current = { bid: b.id, pos: 0 };
      return;
    }
    const q = slashQuery(v);
    if (q !== null) setSlash({ bid: b.id, q, i: 0, anchor: anchorOf(el) });
    else if (slash?.bid === b.id) setSlash(null);
    act({ type: 'setText', id: b.id, text: v });
  };

  const onTextKey = (b: TextBlock, i: number, e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const ta = e.currentTarget;
    const v = ta.value;
    const st = ta.selectionStart;
    const en = ta.selectionEnd;

    if (slash?.bid === b.id) {
      const items = filterSlash(slash.q);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlash({ ...slash, i: Math.min(items.length - 1, slash.i + 1) });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlash({ ...slash, i: Math.max(0, slash.i - 1) });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[slash.i];
        if (it) applySlash(b.id, it.type);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSlash(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((b.type === 'bullet' || b.type === 'callout') && !v) {
        act({ type: 'replace', id: b.id, block: makeBlock('p', b.id) });
        return;
      }
      const next = makeBlock(b.type === 'bullet' ? 'bullet' : 'p', newId(), v.slice(en));
      act({ type: 'split', id: b.id, before: v.slice(0, st), block: next });
      pendingFocus.current = { bid: next.id, pos: 0 };
      markFresh(next.id);
      return;
    }

    if (e.key === 'Backspace' && st === 0 && en === 0) {
      if (b.type !== 'p') {
        e.preventDefault();
        act({ type: 'replace', id: b.id, block: makeBlock('p', b.id, v) });
        return;
      }
      const prev = blocksRef.current[i - 1];
      if (!v) {
        e.preventDefault();
        act({ type: 'remove', id: b.id });
        if (prev?.type === 'formula') {
          // Open the formula so the caret has somewhere to land (arch §4, the prototype's risk).
          setEditF(prev.id);
          pendingFocus.current = { bid: prev.id, pos: 'end' };
        } else {
          const back = prev && isText(prev) ? prev : textNeighbour(i, -1);
          pendingFocus.current = { bid: back ? back.id : '__title', pos: 'end' };
        }
        return;
      }
      if (prev && isText(prev)) {
        e.preventDefault();
        const pos = prev.text.length;
        act({ type: 'merge', id: b.id, into: prev.id });
        pendingFocus.current = { bid: prev.id, pos };
        return;
      }
    }

    if (e.key === 'ArrowUp' && st === 0 && !e.shiftKey) {
      e.preventDefault();
      const pv = textNeighbour(i, -1);
      focusNow(pv ? pv.id : '__title', 'end');
      return;
    }
    if (e.key === 'ArrowDown' && st === v.length && !e.shiftKey) {
      const nx = textNeighbour(i, 1);
      if (nx) {
        e.preventDefault();
        focusNow(nx.id, 0);
      }
    }
  };

  const onTexKey = (i: number, e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      pendingFormula.current = blocksRef.current[i]?.id ?? null;
      setEditF(null);
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    setEditF(null);
    const nx = blocksRef.current[i + 1];
    if (nx && isText(nx)) pendingFocus.current = { bid: nx.id, pos: 0 };
    else insertAt(i + 1, makeBlock('p'));
  };

  // ---------------------------------------------------------------- charts
  const readFiles = async (files: readonly File[], at: number) => {
    const target = replaceBid.current;
    replaceBid.current = null;
    const html = files.filter(isHtmlFile);
    if (html.length === 0) {
      toast(files.length ? 'Only HTML files become live charts.' : 'Nothing to add.');
      return;
    }
    let placed = 0;
    for (const f of html) {
      if (f.size > MAX_CHART_BYTES) {
        toast(`${f.name} is over 4 MB; charts that large cannot be saved.`);
        continue;
      }
      try {
        const out = await upload.mutateAsync({ file: f });
        const warning = out.warnings[0];
        if (target && placed === 0 && indexOf(target) >= 0) {
          act({ type: 'patch', id: target, patch: { assetId: out.assetId, name: out.name } });
          setFrameKeys((k) => ({ ...k, [target]: (k[target] ?? 0) + 1 }));
          toast(warning ?? `Replaced with ${out.name}.`);
        } else {
          const block: ChartBlock = { id: newId(), type: 'chart', assetId: out.assetId, name: out.name, height: 380, caption: '' };
          insertAt(Math.min(at + placed, blocksRef.current.length), block, false);
          toast(warning ?? `${out.name} is live on this page.`);
        }
        placed++;
      } catch (error) {
        toast(isRemiApiError(error, 'PAYLOAD_TOO_LARGE') ? error.message : `Couldn’t add ${f.name}. Try again.`);
      }
    }
  };

  const chartOps = (b: ChartBlock) => ({
    onSize: (height: number) => {
      act({ type: 'patch', id: b.id, patch: { height } });
    },
    onReplay: () => {
      setFrameKeys((k) => ({ ...k, [b.id]: (k[b.id] ?? 0) + 1 }));
    },
    onReplace: () => {
      replaceBid.current = b.id;
      openFilePicker();
    },
    onFull: () => {
      openFull(b.id);
    },
    onRemove: () => {
      act({ type: 'remove', id: b.id });
      toast('Chart removed.');
    },
    onCaption: (caption: string) => {
      act({ type: 'patch', id: b.id, patch: { caption } });
    },
    onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setResizing({ bid: b.id, y0: e.clientY, h0: b.height });
    },
    onResizeMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (resizing?.bid !== b.id) return;
      const h = clampChartHeight(resizing.h0 + (e.clientY - resizing.y0) / (stage.s || 1));
      if (h !== b.height) act({ type: 'patch', id: b.id, patch: { height: h } });
    },
    onResizeEnd: () => {
      setResizing(null);
    },
  });

  // ---------------------------------------------------------------- drag and drop
  const dropIndexAt = (clientY: number) => {
    const rows = [...(mainRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].map((r) => {
      const box = r.getBoundingClientRect();
      return { index: Number(r.dataset.row), top: box.top, height: box.height };
    });
    return dropIndex(rows, clientY);
  };

  const scrollDrag = {
    onDragEnter: (e: ReactDragEvent<HTMLDivElement>) => {
      if (hasFiles(e) || dragBid.current) e.preventDefault();
    },
    onDragOver: (e: ReactDragEvent<HTMLDivElement>) => {
      const files = hasFiles(e);
      if (!files && !dragBid.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = files ? 'copy' : 'move';
      const idx = dropIndexAt(e.clientY);
      if (idx !== drop) setDrop(idx);
      if (files !== dropFiles) setDropFiles(files);
    },
    onDragLeave: (e: ReactDragEvent<HTMLDivElement>) => {
      const r = scrollRef.current?.getBoundingClientRect();
      if (r && (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom)) setDrop(null);
    },
    onDrop: (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const bl = blocksRef.current;
      const idx = drop ?? bl.length;
      setDrop(null);
      if (e.dataTransfer.files.length) {
        const t = bl[idx];
        if (t?.type === 'chart' && t.assetId === null) replaceBid.current = t.id;
        void readFiles([...e.dataTransfer.files], idx);
        return;
      }
      const moving = dragBid.current;
      dragBid.current = null;
      if (!moving) return;
      const from = indexOf(moving);
      if (from >= 0) act({ type: 'move', from, to: idx });
    },
  };

  const endBlockDrag = () => {
    dragBid.current = null;
    setDrop(null);
  };

  // ---------------------------------------------------------------- outline
  const goHeading = (id: string) => {
    const el = mainRef.current?.querySelector<HTMLElement>(`[data-bid="${CSS.escape(id)}"]`);
    const sc = scrollRef.current;
    if (!el || !sc) return;
    const box = sc.getBoundingClientRect();
    const k = box.height > 0 ? sc.offsetHeight / box.height : 1;
    sc.scrollTo({ top: sc.scrollTop + (el.getBoundingClientRect().top - box.top) * k - 40, behavior: tb.reduced ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };

  // ---------------------------------------------------------------- render
  const nums = headingNumbers(blocks);
  const outline = outlineOf(blocks);
  const still = drop !== null || resizing !== null;
  const crumb = crumbFor(tb.tree, pageId, title);
  const inside = tb.tree ? descendantsOf(tb.tree.pages, pageId).length : 0;
  const fullBlock = full ? blocks.find((b): b is ChartBlock => b.id === full && b.type === 'chart') : undefined;
  /** The full-screen chart covers the page: nothing under it takes focus meanwhile. */
  const covered = Boolean(fullBlock?.assetId);
  const slashItems = slash ? filterSlash(slash.q) : [];
  const slashActive = slash ? slashItems[slash.i] : undefined;

  const textProps = (b: TextBlock, i: number) => ({
    'data-bid': b.id,
    value: b.text,
    'aria-label': TYPE_LABEL[b.type],
    // While this block's slash menu is open the text keeps the focus, so it points at the menu
    // and its active item for assistive tech.
    'aria-controls': slash?.bid === b.id ? slashMenuId : undefined,
    'aria-activedescendant': slash?.bid === b.id && slashActive ? slashOptionId(slashMenuId, slashActive.type) : undefined,
    onChange: (e: { currentTarget: HTMLTextAreaElement }) => {
      onTextChange(b, e.currentTarget);
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      onTextKey(b, i, e);
    },
    onFocus: () => {
      if (slash && slash.bid !== b.id) setSlash(null);
    },
    onBlur: () => {
      if (slash?.bid === b.id) setSlash(null);
    },
  });

  const content = (b: Block, i: number) => {
    switch (b.type) {
      case 'h1':
      case 'h2':
      case 'h3': {
        const m = HEAD[b.type];
        return (
          <div className={s.headGrid} style={{ gridTemplateColumns: `${String(m.numW)}px minmax(0,1fr)` }}>
            <span className={s.headNum} style={{ fontSize: m.numFs }}>
              {nums[i]}
            </span>
            <AutoTextarea {...textProps(b, i)} className={m.cls} placeholder="Heading" />
          </div>
        );
      }
      case 'p':
      case 'bullet': {
        const bullet = b.type === 'bullet';
        const last = i === blocks.length - 1;
        return (
          <div className={s.textGrid} style={{ gridTemplateColumns: `${bullet ? '22px' : '0'} minmax(0,1fr)` }}>
            <span className={s.bullet}>{bullet ? '•' : ''}</span>
            <AutoTextarea
              {...textProps(b, i)}
              className={s.text}
              placeholder={bullet ? 'List item' : last || !b.text ? 'Type / for blocks' : ''}
            />
          </div>
        );
      }
      case 'callout':
        return (
          <div className={s.callout}>
            <span className={s.calloutMark} />
            <AutoTextarea {...textProps(b, i)} className={s.calloutText} placeholder="A note worth remembering" />
          </div>
        );
      case 'formula':
        return (
          <div className={s.formulaWrap}>
            {editF === b.id ? (
              <div className={s.formulaEdit}>
                <AutoTextarea
                  data-bid={b.id}
                  className={s.tex}
                  value={b.tex}
                  aria-label="Formula (LaTeX)"
                  placeholder="LaTeX, e.g. \frac{\Delta P}{P} \approx -D \times \Delta y"
                  spellCheck={false}
                  onChange={(e) => {
                    act({ type: 'setText', id: b.id, text: e.target.value });
                  }}
                  onKeyDown={(e) => {
                    onTexKey(i, e);
                  }}
                  onBlur={() => {
                    setEditF((cur) => (cur === b.id ? null : cur));
                  }}
                />
                <div className={s.mathPreview}>
                  <MathView tex={b.tex} />
                </div>
              </div>
            ) : (
              <div
                className={s.math}
                title="Click to edit"
                role="button"
                tabIndex={0}
                aria-label="Edit formula"
                data-formula={b.id}
                onClick={() => {
                  setEditF(b.id);
                  pendingFocus.current = { bid: b.id, pos: 'end' };
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditF(b.id);
                    pendingFocus.current = { bid: b.id, pos: 'end' };
                  }
                }}
              >
                <MathView tex={b.tex} />
              </div>
            )}
          </div>
        );
      case 'page': {
        const target = b.targetPageId ? tb.tree?.pages.find((x) => x.id === b.targetPageId) : undefined;
        const meta = target ? (target.childCount ? `${count(target.childCount, 'page')} inside` : '') : 'missing';
        return (
          <button
            type="button"
            className={s.pageLink}
            onClick={() => {
              if (target) tb.openPage(target.id);
            }}
          >
            <Icon name="description" className={s.pageLinkIcon} />
            <span className={s.pageLinkTitle}>{titleOf(target?.title ?? '')}</span>
            <span className={s.pageLinkMeta}>{meta}</span>
            <span className={s.spacer} />
            <Icon name="chevron_right" className={s.pageLinkChev} />
          </button>
        );
      }
      case 'divider':
        return (
          <div
            className={s.divider}
            onClick={() => {
              setSlash(null);
            }}
          >
            <div />
          </div>
        );
      case 'chart':
        return (
          <ChartBlockView
            block={b}
            frameKey={frameKeys[b.id] ?? 0}
            still={still}
            resizing={resizing?.bid === b.id}
            dropping={drop !== null && dropFiles}
            {...chartOps(b)}
          />
        );
    }
  };

  return (
    <>
      <main ref={mainRef} className={s.main}>
        <TopBar crumb={crumb} inert={covered}>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,text/html"
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const files = e.target.files ? [...e.target.files] : [];
              e.target.value = '';
              const at = dropAt.current ?? blocksRef.current.length;
              dropAt.current = null;
              void readFiles(files, at);
            }}
          />
          <button
            type="button"
            className={s.addChart}
            onClick={() => {
              replaceBid.current = null;
              dropAt.current = blocksRef.current.length;
              openFilePicker();
            }}
          >
            <Icon name="upload_file" />
            Add live chart
          </button>
          <TwoStepConfirmButton
            label="Delete"
            armedLabel={inside ? `Click again to delete with ${String(inside)} inside` : 'Click again to delete'}
            variant="ghost"
            timeout={3500}
            title="Delete page"
            className={s.deletePage}
            onConfirm={() => {
              tb.deletePage(pageId);
            }}
          />
        </TopBar>

        <div
          ref={scrollRef}
          className={s.scroll}
          inert={covered || undefined}
          {...scrollDrag}
          onScroll={() => {
            if (!slash) return;
            const el = mainRef.current?.querySelector<HTMLElement>(`[data-bid="${CSS.escape(slash.bid)}"]`);
            if (el) setSlash({ ...slash, anchor: anchorOf(el) });
          }}
        >
          <div className={clsx(s.page, s.fx)} data-fade={fade || entering}>
            <div className={s.titleWrap}>
              <AutoTextarea
                data-bid="__title"
                className={s.title}
                value={title}
                placeholder="Untitled"
                aria-label="Page title"
                onChange={(e) => {
                  onTitle(e.target.value);
                }}
                onKeyDown={onTitleKey}
              />
              <div className={s.pageMeta}>{metaLine(blocks, localDate(editedAt))}</div>
            </div>

            <div className={s.blocks}>
              {blocks.map((b, i) => (
                <div key={b.id} className={s.row} data-row={i} data-type={b.type} data-block-type={b.type} data-fresh={justAdded === b.id}>
                  <div className={s.dropLine} data-on={drop === i} />
                  <div className={s.gutter}>
                    <button
                      type="button"
                      className={s.gutterAdd}
                      title="Add a block below"
                      onClick={() => {
                        insertAt(i + 1, makeBlock('p'));
                      }}
                    >
                      <Icon name="add" />
                    </button>
                    <span
                      className={s.handle}
                      draggable
                      title="Drag to move"
                      onDragStart={(e) => {
                        dragBid.current = b.id;
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', b.id);
                        const row = e.currentTarget.closest('[data-row]');
                        if (row) e.dataTransfer.setDragImage(row, 20, 20);
                      }}
                      onDragEnd={endBlockDrag}
                    >
                      <Icon name="drag_indicator" />
                    </span>
                  </div>
                  <div className={s.content}>{content(b, i)}</div>
                </div>
              ))}
              <div className={s.endRow} data-row={blocks.length}>
                <div className={s.dropLine} data-on={drop === blocks.length} />
                <button
                  type="button"
                  className={s.addEnd}
                  aria-label="Add a block"
                  onClick={() => {
                    const last = blocksRef.current[blocksRef.current.length - 1];
                    if (last?.type === 'p' && !last.text) focusNow(last.id, 0);
                    else insertAt(blocksRef.current.length, makeBlock('p'));
                  }}
                />
              </div>
            </div>
          </div>
          <div className={s.toastDock}>
            <Toast message={tb.toastMessage} className={s.toast} />
          </div>
        </div>

        <div className={s.dropFx} data-on={drop !== null && dropFiles} aria-hidden="true">
          <div className={s.dropFrame} />
          <div className={s.dropLabel}>
            <Icon name="insert_chart" />
            Drop to add a live chart here
          </div>
        </div>

        {slash ? (
          <SlashMenu
            id={slashMenuId}
            anchor={slash.anchor}
            items={slashItems}
            active={slash.i}
            onPick={(type) => {
              applySlash(slash.bid, type);
            }}
            onHover={(i) => {
              setSlash({ ...slash, i });
            }}
          />
        ) : null}

        {fullBlock?.assetId ? (
          <div className={s.full} role="dialog" aria-label={fullBlock.name || 'chart.html'}>
            <div className={s.fullHead}>
              <span className={s.fiDot} />
              <span className={s.fullName}>{fullBlock.name || 'chart.html'}</span>
              <span className={s.spacer} />
              <button
                ref={closeRef}
                type="button"
                className={s.close}
                onClick={closeFull}
              >
                <Icon name="close" />
                Close
              </button>
            </div>
            <iframe
              title={fullBlock.name || 'chart.html'}
              src={chartUrl(fullBlock.assetId)}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className={s.fullFrame}
            />
            {fullBlock.caption ? <div className={s.fullCaption}>{fullBlock.caption}</div> : null}
          </div>
        ) : null}
      </main>
      <OutlineNav items={outline} empty="Headings appear here, numbered." onGo={goHeading} />
    </>
  );
}
