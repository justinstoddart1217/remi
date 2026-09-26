import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import FoundationsPage from './index';
import LibraryPage from './LibraryPage';

describe('Foundations page', () => {
  it('renders the prototype page: five sections, no library', () => {
    render(<FoundationsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'A notebook that recalculates itself' })).toBeInTheDocument();
    const sections = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(sections).toEqual(['Colour', 'Type', 'Space, radius and grid', 'Motion', 'Components']);
    expect(screen.getAllByRole('button', { name: 'Replay' })).toHaveLength(1);
    // The prototype's own copy and values.
    expect(screen.getByRole('link', { name: 'Remi.dc.html' })).toHaveAttribute('href', '/app/today');
    expect(screen.getByText('oklch(0.5 0.1 128)')).toBeInTheDocument();
    expect(screen.getByText('oklch(0.5 0.1 265)')).toBeInTheDocument();
  });
});

describe('Library page', () => {
  it('renders every library specimen on its own page', () => {
    render(<LibraryPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Library' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Foundations' })).toHaveAttribute('href', '/foundations');
  });
});
