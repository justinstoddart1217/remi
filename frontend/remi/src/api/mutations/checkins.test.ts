import { act, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { errorResponse, renderWithClient, server, setupMockApi } from '../../test/msw';
import type { ProposalOut } from '../types';
import { useCheckinPreview } from '../queries/checkins';
import { createCheckinParser } from './checkins';

setupMockApi();

interface Seen {
  path: string;
  parseId: string;
  text: string;
}

function proposal(parseId: string, summary = 'One change'): ProposalOut {
  return { parseId, changes: [], model: null, provider: 'none', source: 'simple', summary, unplaced: [] };
}

/** Parse endpoints that echo the parseId after `wait` ms, and record cancels. */
function parseApi(wait: (text: string) => number = () => 0) {
  const seen: Seen[] = [];
  const cancelled: string[] = [];
  const answer = async ({ request }: { request: Request }) => {
    const body = (await request.json()) as { parseId: string; text: string };
    seen.push({ path: new URL(request.url).pathname, parseId: body.parseId, text: body.text });
    await delay(wait(body.text));
    return HttpResponse.json(proposal(body.parseId, body.text));
  };
  server.use(
    http.post('*/api/checkins/parse', answer),
    http.post('*/api/checkins/parse-simple', answer),
    http.delete('*/api/checkins/parse/:parseId', ({ params }) => {
      cancelled.push(String(params.parseId));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { seen, cancelled };
}

describe('check-in parse sessions', () => {
  it('sends a fresh parseId and returns the proposal', async () => {
    const { seen } = parseApi();
    const parser = createCheckinParser();
    const out = await parser.parse({ text: '+6h returns', focusProjectId: 'ret' });
    expect(out?.summary).toBe('+6h returns');
    expect(seen).toHaveLength(1);
    expect(out?.parseId).toBe(seen[0]?.parseId);
    expect(seen[0]?.path).toBe('/api/checkins/parse');
    expect(parser.current()).toBeNull();
  });

  it('uses the offline simple reading when asked', async () => {
    const { seen } = parseApi();
    await createCheckinParser().parse({ text: 'done the ManCo pack', mode: 'simple' });
    expect(seen[0]?.path).toBe('/api/checkins/parse-simple');
  });

  it('a newer parse supersedes the older one: the old resolves null and is cancelled on the server', async () => {
    const { seen, cancelled } = parseApi((text) => (text === 'slow' ? 200 : 0));
    const parser = createCheckinParser();
    const first = parser.parse({ text: 'slow' });
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    const firstId = parser.current();
    const second = parser.parse({ text: 'fast' });

    expect(await first).toBeNull();
    expect((await second)?.summary).toBe('fast');
    await waitFor(() => {
      expect(cancelled).toEqual([firstId]);
    });
  });

  it('cancel() aborts, resolves null and tells the server', async () => {
    const { cancelled } = parseApi(() => 5_000);
    const parser = createCheckinParser();
    const pending = parser.parse({ text: 'thinking…' });
    const id = parser.current();
    expect(id).not.toBeNull();
    parser.cancel();
    expect(await pending).toBeNull();
    expect(parser.current()).toBeNull();
    await waitFor(() => {
      expect(cancelled).toEqual([id]);
    });
  });

  it('rejects a reply that echoes another parseId, and ends the session', async () => {
    const { cancelled } = parseApi();
    server.use(http.post('*/api/checkins/parse', () => HttpResponse.json(proposal('someone-else'))));
    const parser = createCheckinParser();
    await expect(parser.parse({ text: 'x' })).rejects.toMatchObject({ status: 200, code: 'BAD_RESPONSE' });
    // Nothing is in flight any more, so cancel() has nothing to stop on the server.
    expect(parser.current()).toBeNull();
    parser.cancel();
    await act(async () => {
      await Promise.resolve();
    });
    expect(cancelled).toEqual([]);
  });

  it('rejects with the provider error for the current session', async () => {
    server.use(http.post('*/api/checkins/parse', () => errorResponse(502, 'AI_BAD_REPLY', 'No usable proposal.')));
    await expect(createCheckinParser().parse({ text: 'x' })).rejects.toMatchObject({ status: 502, code: 'AI_BAD_REPLY' });
  });
});

describe('check-in preview', () => {
  it('waits for ticks to settle, keeps the last effect, and sends nothing for no changes', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/checkins/preview', async ({ request }) => {
        const body = (await request.json()) as { changes: { hours: number }[] };
        bodies.push(body);
        const hours = body.changes[0]?.hours ?? 0;
        return HttpResponse.json({
          projects: [
            {
              projectId: 'ret',
              from: '2026-12-02',
              to: hours > 3 ? '2026-12-07' : '2026-12-03',
              deltaBd: hours > 3 ? 3 : 1,
              label: hours > 3 ? '+3 BD' : '+1 BD',
              late: true,
              targetAfter: '2026-11-27',
              newOver: [],
              missesKeyRun: false,
            },
          ],
        });
      }),
    );
    const change = (hours: number) => [{ type: 'scope_add' as const, projectId: 'ret', hours, text: '' }];
    const { result, rerender } = renderWithClient(
      ({ changes }: { changes: ReturnType<typeof change> | [] }) => useCheckinPreview(changes),
      { initialProps: { changes: change(6) } },
    );
    await waitFor(() => {
      expect(result.current.data?.projects[0]?.label).toBe('+3 BD');
    });
    expect(bodies).toHaveLength(1);

    // Two quick toggles within 150ms: one request, for the last one.
    rerender({ changes: change(2) });
    rerender({ changes: change(1) });
    expect(result.current.data?.projects[0]?.label).toBe('+3 BD');
    await waitFor(() => {
      expect(result.current.data?.projects[0]?.label).toBe('+1 BD');
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual({ changes: change(1) });

    rerender({ changes: [] });
    await waitFor(() => {
      expect(result.current.data?.projects).toEqual([]);
    });
    expect(bodies).toHaveLength(2);
    await act(async () => {
      await Promise.resolve();
    });
  });
});
