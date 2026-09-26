import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary, ErrorNotice } from './ErrorBoundary';

let broken = true;
function Flaky(): ReactNode {
  if (broken) throw new Error('Specimen failure');
  return <p>Recovered</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    broken = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // React logs caught errors
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the quiet notice naming the area, reports the error, and retries', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary area="Timeline" onError={onError}>
        <Flaky />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Timeline hit a problem.');
    expect(alert).toHaveTextContent('Your plan is safe; nothing was changed.');
    expect(alert).not.toHaveAttribute('data-inset');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Specimen failure' }), expect.anything());

    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('pads the notice when inset, and uses a custom fallback when given', () => {
    const { unmount } = render(
      <ErrorBoundary inset>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-inset');
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong here.');
    unmount();

    render(
      <ErrorBoundary fallback={(error) => <p>Custom: {error.message}</p>}>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom: Specimen failure')).toBeInTheDocument();
  });

  it('resets when a reset key changes', () => {
    function Harness() {
      const [key, setKey] = useState(0);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              broken = false;
              setKey((k) => k + 1);
            }}
          >
            Navigate
          </button>
          <ErrorBoundary resetKeys={[key]}>
            <Flaky />
          </ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});

describe('ErrorNotice', () => {
  it('renders a title, body and action', () => {
    render(
      <ErrorNotice inset title="Remi couldn’t show this page." action={<a href="/">Back to home</a>}>
        404 Not Found
      </ErrorNotice>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Remi couldn’t show this page.');
    expect(alert).toHaveTextContent('404 Not Found');
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
