/**
 * Shared presentational types for the component library. Components never fetch data; these
 * are the shapes they take as props.
 */

/** The two business domains. Every accent colour in Remi is keyed by one of these. */
export type Domain = 'pc' | 'fi';

/** CSS colour expressions for a domain, read from tokens.css only. */
export const DOMAIN_ACCENT: Readonly<Record<Domain, string>> = {
  pc: 'var(--pc-accent)',
  fi: 'var(--fi-accent)',
};

export const DOMAIN_SOFT: Readonly<Record<Domain, string>> = {
  pc: 'var(--pc-accent-soft)',
  fi: 'var(--fi-accent-soft)',
};

export const DOMAIN_NAME: Readonly<Record<Domain, string>> = {
  pc: 'Private Credit',
  fi: 'Fixed Income',
};

/** One contributor to a business day's load (a BAU run or a project's hours). */
export interface LoadItem {
  /** `project` hours are soft fills; `routine` and `rotation` hours are notched BAU. */
  readonly refType: 'routine' | 'rotation' | 'project';
  readonly refId: string;
  readonly domain: Domain;
  /** Hours on this day. */
  readonly h: number;
  readonly name: string;
}

/** A business day's load, as the server's read model sends it (`GET /plan` loads[iso]). */
export interface DayLoad {
  readonly items: readonly LoadItem[];
  readonly bau: number;
  readonly proj: number;
  readonly total: number;
  readonly free: number;
  /** Working-day capacity in hours (8 in the design). */
  readonly capacity: number;
  readonly over: boolean;
}

export const isBauItem = (item: LoadItem): boolean => item.refType !== 'project';

/** The prototype's `hrs`: round to 2 dp and suffix 'h' ('6h', '0.75h', '9.5h'). */
export function formatHours(h: number): string {
  return `${String(Math.round(h * 100) / 100)}h`;
}
