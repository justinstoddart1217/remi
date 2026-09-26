import { ErrorBoundary as Boundary } from '../components/ErrorBoundary';
import type { ErrorBoundaryProps } from '../components/ErrorBoundary';

interface Props extends Omit<ErrorBoundaryProps, 'area' | 'inset'> {
  /** Names the failed area in the notice and the console, e.g. the screen name. */
  label?: string;
}

/**
 * The shell's boundary (one per screen, one for the drawer, one around the app). It is the
 * component library's ErrorBoundary, the only implementation, preset for a bare container and
 * logging which area failed.
 */
export function ErrorBoundary({ label, onError, ...rest }: Props) {
  return (
    <Boundary
      {...rest}
      area={label}
      inset
      onError={(error, info) => {
        console.error(`Remi: ${label ?? 'a view'} failed to render`, error, info.componentStack);
        onError?.(error, info);
      }}
    />
  );
}
