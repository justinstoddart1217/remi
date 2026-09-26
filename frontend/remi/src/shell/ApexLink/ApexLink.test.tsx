import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ApexLink } from './ApexLink';

function setBase(href: string | null): void {
  document.head.querySelectorAll('base').forEach((b) => {
    b.remove();
  });
  if (href === null) return;
  const base = document.createElement('base');
  base.href = href;
  document.head.prepend(base);
}

afterEach(() => {
  setBase(null);
});

describe('ApexLink (R-76)', () => {
  it('links back to APEX when Remi is mounted at /remi/', () => {
    setBase('/remi/');
    render(<ApexLink />);
    const link = screen.getByRole('link', { name: 'Back to APEX' });
    expect(link.getAttribute('href')).toBe('/');
    expect(link).toHaveTextContent('APEX');
  });

  it('renders nothing on its own at the root (the laptop)', () => {
    setBase('/');
    const { container } = render(<ApexLink />);
    expect(container).toBeEmptyDOMElement();
  });
});
