// A fake AI provider for the check-in drawer states, standing in for the prototype's stubbed
// window.claude (drivers/common.ts installClaudeStub). It speaks the two Ollama endpoints the
// backend's Ollama provider uses (backend/remi/services/ai/ollama_provider.py), on 127.0.0.1 and an
// OS-assigned port, so no backend change is needed and nothing leaves the machine:
//
//   GET  /api/tags   lists FAKE_MODEL (GET /api/ai/status probes it)
//   POST /api/chat   answers according to the current mode:
//                      fixture  message.content = golden/claude-fixture.mjs CLAUDE_FIXTURE_REPLY
//                      error    message.content = CLAUDE_ERROR_RAW (no JSON: 502 AI_BAD_REPLY)
//                      pending  never answers (the drawer stays in its thinking phase)
//   GET|POST /__parity/mode   read or set the mode ({"mode": "..."}); answers {mode, calls, held}
//                             (held: pending chats still open, so a flow can see a cancel land)
//
// The drivers switch the backend to provider "ollama" at this URL for those states only
// (remi/api.ts useAiStub) and back to "none" for the rest. globalSetup runs it inside the
// Playwright runner process; globalTeardown closes it.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { CLAUDE_ERROR_RAW, CLAUDE_FIXTURE_REPLY } from '../golden/claude-fixture.mjs';
import { HOST } from './env.ts';

export type FakeAiMode = 'fixture' | 'error' | 'pending';
export const FAKE_MODEL = 'remi-parity-fixture';

export interface FakeAi {
  url: string;
  close(): Promise<void>;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeAi(): Promise<FakeAi> {
  let mode: FakeAiMode = 'fixture';
  const held = new Set<http.ServerResponse>();
  let calls = 0;

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${HOST}`);
      const body = await readBody(req);
      if (url.pathname === '/__parity/mode') {
        if (req.method === 'POST') {
          const next = (JSON.parse(body || '{}') as { mode?: string }).mode;
          if (next !== 'fixture' && next !== 'error' && next !== 'pending') return send(res, 422, { error: `bad mode ${String(next)}` });
          mode = next;
        }
        return send(res, 200, { mode, calls, held: held.size });
      }
      if (url.pathname === '/api/tags') {
        return send(res, 200, { models: [{ name: FAKE_MODEL, model: FAKE_MODEL, size: 1, digest: 'parity' }] });
      }
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        calls += 1;
        if (mode === 'pending') {
          held.add(res);
          res.on('close', () => held.delete(res));
          return;
        }
        const content = mode === 'fixture' ? JSON.stringify(CLAUDE_FIXTURE_REPLY) : CLAUDE_ERROR_RAW;
        return send(res, 200, { model: FAKE_MODEL, created_at: '2026-10-05T08:30:00Z', message: { role: 'assistant', content }, done: true });
      }
      return send(res, 404, { error: 'not found' });
    })().catch((e: unknown) => {
      if (!res.headersSent) send(res, 500, { error: String(e) });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${HOST}:${String(port)}`,
    close: async () => {
      for (const res of held) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
