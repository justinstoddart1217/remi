import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useUi } from '../stores/ui';
import { ScreenActivityContext, useArrival } from './arrival';

function Probe() {
  const { attrs } = useArrival();
  return <div data-testid="probe" {...attrs} />;
}

function Screen({ active }: { active: boolean }) {
  return (
    <ScreenActivityContext.Provider value={{ screen: 'today', active }}>
      <Probe />
    </ScreenActivityContext.Provider>
  );
}

describe('useArrival', () => {
  afterEach(() => {
    useUi.getState().setAppearance({ motion: 'system' });
  });

  it('waits for the first activation, then arrives and settles after 900ms', async () => {
    const { rerender } = render(<Screen active={false} />);
    const probe = screen.getByTestId('probe');
    await new Promise((r) => setTimeout(r, 50));
    expect(probe).not.toHaveAttribute('data-arrived');

    rerender(<Screen active />);
    await waitFor(() => {
      expect(probe).toHaveAttribute('data-arrived');
    });
    expect(probe).not.toHaveAttribute('data-settled');
    await waitFor(
      () => {
        expect(probe).toHaveAttribute('data-settled');
      },
      { timeout: 1500 },
    );

    // Once per mount: hiding and showing again keeps it arrived.
    rerender(<Screen active={false} />);
    rerender(<Screen active />);
    expect(probe).toHaveAttribute('data-arrived');
    expect(probe).toHaveAttribute('data-settled');
  });

  it('is settled immediately under reduced motion', () => {
    useUi.getState().setAppearance({ motion: 'reduced' });
    render(<Screen active={false} />);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-arrived');
    expect(screen.getByTestId('probe')).toHaveAttribute('data-settled');
  });
});
