import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import s from './ErrorBoundary.module.css';

export interface ErrorNoticeProps {
  title: ReactNode;
  /** Muted body copy under the title. */
  children?: ReactNode;
  /** A button or link under the body ('Try again', 'Back to home'). */
  action?: ReactNode;
  /** Pads the notice for a bare container (a screen, the drawer, the page) that has no padding. */
  inset?: boolean;
}

/** The quiet in-place notice a failed area shows: the boundary's fallback and the route error. */
export function ErrorNotice({ title, children, action, inset = false }: ErrorNoticeProps) {
  return (
    <div className={s.fallback} data-inset={inset ? '' : undefined} role="alert">
      <div className={s.title}>{title}</div>
      {children != null && <div className={s.body}>{children}</div>}
      {action != null && <div className={s.action}>{action}</div>}
    </div>
  );
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback. Receives the error and a reset function. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Names the area in the default fallback ('Timeline', 'the check-in'). */
  area?: string;
  /** Pads the default fallback for a bare container (see ErrorNotice). */
  inset?: boolean;
  /** Changing any of these resets the boundary (e.g. the route). */
  resetKeys?: readonly unknown[];
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  keys: readonly unknown[] | undefined;
}

const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a?.length !== b?.length || (a ?? []).some((v, i) => !Object.is(v, b?.[i]));

/**
 * Isolates a screen or the drawer, like the prototype runtime isolated each component: one
 * failure shows a quiet notice in place instead of taking the whole app down. This is the only
 * boundary implementation; app/ErrorBoundary adapts it for the shell.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, keys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    if (changed(props.resetKeys, state.keys)) return { error: null, keys: props.resetKeys };
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <ErrorNotice
        inset={this.props.inset}
        title={this.props.area ? `${this.props.area} hit a problem.` : 'Something went wrong here.'}
        action={
          <button type="button" className={s.retry} onClick={this.reset}>
            Try again
          </button>
        }
      >
        Your plan is safe; nothing was changed. Try again, or reload the page.
      </ErrorNotice>
    );
  }
}
