import 'katex/dist/katex.min.css';

import { useMemo } from 'react';

import { renderTex } from './tex';
import s from './Textbook.module.css';

/** Rendered math, memoised on the TeX (KaTeX output is escaped; see tex.ts). */
export function MathView({ tex }: { tex: string }) {
  const html = useMemo(() => renderTex(tex, s.texTeX ?? ''), [tex]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
