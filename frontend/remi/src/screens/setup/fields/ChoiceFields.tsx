import { SegmentedControl } from '../../../components';
import type { AiProvider, HolidayRegion, RegionOption } from '../model';
import { PROVIDER_LABELS, regionLabel } from '../model';
import f from './Fields.module.css';

export interface RegionFieldProps {
  value: HolidayRegion;
  regions: readonly RegionOption[];
  onChange: (region: HolidayRegion) => void;
}

/** Holiday region: the sliding-pill segmented control (Timeline zoom, brand-deep), 140px options. */
export function RegionField({ value, regions, onChange }: RegionFieldProps) {
  return (
    <SegmentedControl
      label="Holiday region"
      className={f.seg}
      variant="pill"
      itemWidth={140}
      value={value}
      onChange={onChange}
      options={regions.map((r) => ({ value: r.code, label: regionLabel(r.label) }))}
    />
  );
}

const PROVIDERS: readonly AiProvider[] = ['none', 'anthropic', 'ollama'];

export interface ProviderFieldProps {
  value: AiProvider;
  onChange: (provider: AiProvider) => void;
}

/** Tell Remi's reader: None · Anthropic · Ollama. */
export function ProviderField({ value, onChange }: ProviderFieldProps) {
  return (
    <SegmentedControl
      label="Check-in reader"
      className={f.seg}
      variant="pill"
      itemWidth={104}
      value={value}
      onChange={onChange}
      options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
    />
  );
}

export interface ProviderStatusProps {
  tone: 'ok' | 'wait' | 'off';
  children: string;
}

/** One line of provider status with a 7px dot: green when ready, risk when it needs something. */
export function ProviderStatus({ tone, children }: ProviderStatusProps) {
  const dot = tone === 'ok' ? 'var(--good)' : tone === 'wait' ? 'var(--risk)' : 'var(--ink-faint)';
  return (
    <span className={f.providerStatus}>
      <span className={f.statusDot} style={{ background: dot }} aria-hidden="true" />
      {children}
    </span>
  );
}
