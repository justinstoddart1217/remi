import clsx from 'clsx';
import type { ReactNode } from 'react';

import { DOMAIN_NAME } from '../shared/domain';
import type { Domain } from '../shared/domain';
import s from './DomainTag.module.css';

export interface DomainTagProps {
  domain: Domain;
  /** Defaults to 'Private Credit' / 'Fixed Income'. */
  children?: ReactNode;
  className?: string;
}

/** 22px soft chip with a 6px accent dot, 11/600 at 0.04em (Workspace header, Timeline panel). */
export function DomainTag({ domain, children, className }: DomainTagProps) {
  return (
    <span className={clsx(s.tag, s[domain], className)}>
      <span className={s.dot} aria-hidden="true" />
      {children ?? DOMAIN_NAME[domain]}
    </span>
  );
}
