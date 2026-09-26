import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InlineList } from './InlineList';

const base = {
  label: 'Constraints',
  placeholder: 'A limit to respect',
  emptyText: 'None noted yet.',
};

describe('InlineList', () => {
  it('shows the empty copy, and a focused blank line after Add', () => {
    render(<InlineList {...base} items={[]} onAdd={vi.fn()} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('None noted yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.queryByText('None noted yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('adds the typed line on blur, and drops an untouched blank line', () => {
    const onAdd = vi.fn();
    render(<InlineList {...base} items={[]} onAdd={onAdd} onChange={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No new vendors' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onAdd).toHaveBeenCalledWith('No new vendors');
  });

  it('keeps an async-added line showing its text until the item arrives', async () => {
    let resolve: () => void = () => undefined;
    const save = new Promise<void>((r) => {
      resolve = r;
    });
    const props = { ...base, onAdd: () => save, onChange: vi.fn(), onRemove: vi.fn() };
    const { rerender } = render(<InlineList {...props} items={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No new vendors' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.getByRole('textbox')).toHaveValue('No new vendors');
    expect(screen.queryByText('None noted yet.')).not.toBeInTheDocument();

    rerender(<InlineList {...props} items={[{ id: 'n1', text: 'No new vendors' }]} />);
    const rows = screen.getAllByRole('textbox');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAccessibleName('Constraints 1');
    await act(async () => {
      resolve();
      await save;
    });
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('drops an async-added line when the save rejects', async () => {
    let reject: (e: Error) => void = () => undefined;
    const save = new Promise<void>((_, r) => {
      reject = r;
    });
    render(<InlineList {...base} items={[]} onAdd={() => save} onChange={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No new vendors' } });
    fireEvent.blur(screen.getByRole('textbox'));
    await act(async () => {
      reject(new Error('500'));
      await save.catch(() => undefined);
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('None noted yet.')).toBeInTheDocument();
  });

  it('keeps an in-flight add read-only, so editing it cannot add twice', () => {
    const onAdd = vi.fn(() => new Promise<void>(() => undefined));
    render(<InlineList {...base} items={[]} onAdd={onAdd} onChange={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No new vendors' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onAdd).toHaveBeenCalledTimes(1);

    const line = screen.getByRole('textbox');
    expect(line).toHaveAttribute('readonly');
    line.focus();
    fireEvent.change(line, { target: { value: 'No new vendors, ever' } });
    fireEvent.keyDown(line, { key: 'Enter' });
    fireEvent.blur(line);
    fireEvent.change(line, { target: { value: '' } });
    fireEvent.blur(line);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('No new vendors');
  });

  it('opens a fresh blank line once the item lands when Add is pressed mid-save', async () => {
    let resolve: () => void = () => undefined;
    const save = new Promise<void>((r) => {
      resolve = r;
    });
    const onAdd = vi.fn<(text: string) => unknown>(() => save);
    const props = { ...base, onAdd, onChange: vi.fn(), onRemove: vi.fn() };
    const { rerender } = render(<InlineList {...props} items={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No new vendors' } });
    fireEvent.blur(screen.getByRole('textbox'));

    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.getAllByRole('textbox')).toHaveLength(1); // still the saving line
    expect(screen.getByRole('textbox')).toHaveValue('No new vendors');

    rerender(<InlineList {...props} items={[{ id: 'n1', text: 'No new vendors' }]} />);
    const fresh = screen.getByRole('textbox', { name: 'New constraints item' });
    expect(fresh).toHaveValue('');
    expect(fresh).not.toHaveAttribute('readonly');
    expect(fresh).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Constraints 1' })).toHaveValue('No new vendors');

    await act(async () => {
      resolve();
      await save;
    });
    // The first save settling does not close the line it no longer owns.
    expect(screen.getByRole('textbox', { name: 'New constraints item' })).toBe(fresh);

    onAdd.mockReturnValueOnce(undefined);
    fireEvent.change(fresh, { target: { value: 'Keep the budget' } });
    fireEvent.blur(fresh);
    expect(onAdd).toHaveBeenLastCalledWith('Keep the budget');
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('textbox', { name: 'New constraints item' })).not.toBeInTheDocument();
  });

  it('keeps the saving line when another row is removed mid-save', async () => {
    let resolve: () => void = () => undefined;
    const save = new Promise<void>((r) => {
      resolve = r;
    });
    const props = { ...base, onAdd: () => save, onChange: vi.fn(), onRemove: vi.fn() };
    const a = { id: 'a', text: 'First' };
    const b = { id: 'b', text: 'Second' };
    const { rerender } = render(<InlineList {...props} items={[a, b]} />);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New constraints item' }), {
      target: { value: 'No new vendors' },
    });
    fireEvent.blur(screen.getByRole('textbox', { name: 'New constraints item' }));

    rerender(<InlineList {...props} items={[b]} />);
    expect(screen.getByRole('textbox', { name: 'New constraints item' })).toHaveValue('No new vendors');

    // The item lands but the count nets out: the save settling closes the line.
    rerender(<InlineList {...props} items={[b, { id: 'n1', text: 'No new vendors' }]} />);
    await act(async () => {
      resolve();
      await save;
    });
    expect(screen.queryByRole('textbox', { name: 'New constraints item' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('opens the queued blank line when the save fails', async () => {
    let reject: (e: Error) => void = () => undefined;
    const save = new Promise<void>((_, r) => {
      reject = r;
    });
    render(<InlineList {...base} items={[]} onAdd={() => save} onChange={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No new vendors' } });
    fireEvent.blur(screen.getByRole('textbox'));
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    await act(async () => {
      reject(new Error('500'));
      await save.catch(() => undefined);
    });
    const fresh = screen.getByRole('textbox');
    expect(fresh).toHaveValue('');
    expect(fresh).not.toHaveAttribute('readonly');
    expect(fresh).toHaveFocus();
  });

  it('numbers rows, edits and removes by id, and toggles checkable rows', () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    const onToggle = vi.fn();
    render(
      <InlineList
        {...base}
        numbered
        items={[
          { id: 'a', text: 'First', done: false },
          { id: 'b', text: 'Second', done: true, meta: 'done' },
        ]}
        onAdd={vi.fn()}
        onChange={onChange}
        onRemove={onRemove}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('02')).toBeInTheDocument();
    const [first, second] = screen.getAllByRole('textbox');
    if (!first || !second) throw new Error('rows missing');
    fireEvent.change(first, { target: { value: 'First, edited' } });
    fireEvent.blur(first);
    expect(onChange).toHaveBeenCalledWith('a', 'First, edited');
    fireEvent.change(second, { target: { value: '' } });
    fireEvent.blur(second);
    expect(onRemove).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));
    expect(onToggle).toHaveBeenCalledWith('a', true);
  });

  it('has no Add without onAdd, and takes a head aside and a label tone', () => {
    render(
      <InlineList
        {...base}
        labelTone="fi"
        labelAs="h3"
        headAside={<span>2 of 5 ready</span>}
        items={[]}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Constraints' })).toBeInTheDocument();
    expect(screen.getByText('2 of 5 ready')).toBeInTheDocument();
  });

  it('shows the checkbox state a toggle promise holds until it settles', async () => {
    let resolve: () => void = () => undefined;
    const save = new Promise<void>((r) => {
      resolve = r;
    });
    render(
      <InlineList {...base} items={[{ id: 'a', text: 'First', done: false }]} onChange={vi.fn()} onRemove={vi.fn()} onToggle={() => save} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));
    expect(screen.getByRole('checkbox', { name: 'First' })).toBeChecked();
    await act(async () => {
      resolve();
      await save;
    });
    // The item never changed: the box goes back to what `items` says.
    expect(screen.getByRole('checkbox', { name: 'First' })).not.toBeChecked();
  });
});

describe('InlineList row="line"', () => {
  const lineBase = { ...base, row: 'line' as const, addVisibility: 'hover' as const };

  it('reads each line as text, with its note, and marks hover-only Add', () => {
    const { container } = render(
      <InlineList
        {...lineBase}
        items={[
          { id: 'a', text: 'Desk access', done: true, meta: 'done' },
          { id: 'b', text: 'Bloomberg login', done: false },
        ]}
        onAdd={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desk access' })).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-add', 'hover');
    expect(root).not.toHaveAttribute('data-empty');
    expect(screen.getByRole('button', { name: /Add/ }).className).toMatch(/headAdd/);
  });

  it('turns a line into a field on click and holds the saved text until the save settles', async () => {
    let resolve: () => void = () => undefined;
    const save = new Promise<void>((r) => {
      resolve = r;
    });
    const onChange = vi.fn(() => save);
    render(<InlineList {...lineBase} items={[{ id: 'a', text: 'Desk access' }]} onAdd={vi.fn()} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desk access' }));
    const field = screen.getByRole('textbox', { name: 'Constraints: Desk access' });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: 'Desk and badge' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledWith('a', 'Desk and badge');
    expect(screen.getByRole('button', { name: 'Desk and badge' })).toBeInTheDocument();
    await act(async () => {
      resolve();
      await save;
    });
    expect(screen.getByRole('button', { name: 'Desk access' })).toBeInTheDocument();
  });

  it('hides a cleared line while its removal saves', () => {
    const onRemove = vi.fn(() => new Promise<void>(() => undefined));
    render(<InlineList {...lineBase} items={[{ id: 'a', text: 'Desk access' }]} onAdd={vi.fn()} onChange={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desk access' }));
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(onRemove).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('button', { name: 'Desk access' })).not.toBeInTheDocument();
  });

  it('adds with a ghost row until the item arrives, and shows the empty copy when empty', async () => {
    let resolve: () => void = () => undefined;
    const save = new Promise<void>((r) => {
      resolve = r;
    });
    const props = { ...lineBase, onAdd: vi.fn(() => save), onChange: vi.fn(), onRemove: vi.fn() };
    const { container, rerender } = render(<InlineList {...props} items={[]} />);
    expect(screen.getByText('None noted yet.')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-empty');
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    const field = screen.getByRole('textbox', { name: 'New constraints item' });
    fireEvent.change(field, { target: { value: 'Desk access' } });
    fireEvent.blur(field);
    expect(props.onAdd).toHaveBeenCalledWith('Desk access');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Desk access').closest('[aria-busy]')).not.toBeNull();
    rerender(<InlineList {...props} items={[{ id: 'n', text: 'Desk access' }]} />);
    expect(screen.getAllByText('Desk access')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Desk access' })).toBeInTheDocument();
    await act(async () => {
      resolve();
      await save;
    });
  });

  it('derives headAside from the displayed rows, so a count follows pending ticks and removals', async () => {
    let resolve: () => void = () => undefined;
    const save = new Promise<void>((r) => {
      resolve = r;
    });
    const onToggle = vi.fn(() => save);
    const onRemove = vi.fn(() => new Promise<void>(() => undefined));
    const count = (shown: readonly { done?: boolean }[]) => `${String(shown.filter((x) => x.done).length)} of ${String(shown.length)} ready`;
    render(
      <InlineList
        {...lineBase}
        items={[
          { id: 'a', text: 'Desk access', done: true },
          { id: 'b', text: 'Bloomberg login', done: false },
          { id: 'c', text: 'Risk sign-off', done: false },
        ]}
        headAside={(shown) => (shown.length > 0 ? <span data-testid="count">{count(shown)}</span> : null)}
        onAdd={vi.fn()}
        onChange={vi.fn()}
        onRemove={onRemove}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByTestId('count')).toHaveTextContent('1 of 3 ready');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bloomberg login' }));
    expect(onToggle).toHaveBeenCalledWith('b', true);
    // The save has not settled: the count already reads the ticked box.
    expect(screen.getByRole('checkbox', { name: 'Bloomberg login' })).toBeChecked();
    expect(screen.getByTestId('count')).toHaveTextContent('2 of 3 ready');
    // A row whose removal is saving no longer counts.
    fireEvent.click(screen.getByRole('button', { name: 'Risk sign-off' }));
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(onRemove).toHaveBeenCalledWith('c');
    expect(screen.getByTestId('count')).toHaveTextContent('2 of 2 ready');
    await act(async () => {
      resolve();
      await save;
    });
    // `items` never changed: the tick falls back to what it says (the removal is still saving).
    expect(screen.getByTestId('count')).toHaveTextContent('1 of 2 ready');
  });

  it('derives a function note from the displayed tick, so it flips before the save settles', async () => {
    const saves: (() => void)[] = [];
    const onToggle = vi.fn(
      () =>
        new Promise<void>((r) => {
          saves.push(r);
        }),
    );
    const due = (label: string) => (done: boolean) => (done ? 'done' : label);
    render(
      <InlineList
        {...lineBase}
        items={[
          { id: 'a', text: 'Desk access', done: true, meta: due('Mon 12 Oct') },
          { id: 'b', text: 'Bloomberg login', done: false, meta: due('Fri 18 Dec') },
        ]}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onToggle={onToggle}
      />,
    );
    expect(screen.getAllByText('done')).toHaveLength(1);
    expect(screen.getByText('Fri 18 Dec')).toBeInTheDocument();

    // Tick: the note reads 'done' while the save is still in flight.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bloomberg login' }));
    expect(onToggle).toHaveBeenCalledWith('b', true);
    expect(screen.getAllByText('done')).toHaveLength(2);
    expect(screen.queryByText('Fri 18 Dec')).not.toBeInTheDocument();
    await act(async () => {
      saves[0]?.();
      await Promise.resolve();
    });
    // `items` never changed: the note goes back with the box.
    expect(screen.getByText('Fri 18 Dec')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Bloomberg login' })).not.toBeChecked();

    // Untick: the due date is back at once, and 'done' returns once the save settles.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Desk access' }));
    expect(onToggle).toHaveBeenCalledWith('a', false);
    expect(screen.getByText('Mon 12 Oct')).toBeInTheDocument();
    expect(screen.queryByText('done')).not.toBeInTheDocument();
    await act(async () => {
      saves[1]?.();
      await Promise.resolve();
    });
    expect(screen.queryByText('Mon 12 Oct')).not.toBeInTheDocument();
    expect(screen.getAllByText('done')).toHaveLength(1);
  });

  it('evaluates a function note on field rows too', () => {
    render(
      <InlineList
        {...base}
        items={[{ id: 'a', text: 'First', done: false, meta: (done) => (done ? 'done' : 'Fri 18 Dec') }]}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Fri 18 Dec')).toBeInTheDocument();
  });

  it('still accepts a plain node as headAside', () => {
    render(<InlineList {...lineBase} items={[]} headAside={<span>Static</span>} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('Static')).toBeInTheDocument();
  });

  it('renders a footer inside the list', () => {
    render(<InlineList {...lineBase} items={[]} onChange={vi.fn()} onRemove={vi.fn()} footer={<p>Forecast ready Mon 4 Jan</p>} />);
    expect(screen.getByText('Forecast ready Mon 4 Jan')).toBeInTheDocument();
  });
});
