// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The fetcher against a stand-in for Firebase: what it sends, what it keeps,
 * and the sentence it produces for each way the read can fail. The module
 * caches its anonymous token across calls, so the module is re-imported for
 * every test.
 */

type Call = { url: string; init: RequestInit | undefined };

const REGATTA = 'projects/vakaros-racesense/databases/(default)/documents/regattas/abc123abc123abc123ab';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SIGN_UP = jsonResponse(200, { idToken: 'tok-1', expiresIn: '3600', localId: 'anon' });

const DOCUMENT = {
  name: REGATTA,
  fields: {
    name: { stringValue: 'Autumn League' },
    divisions: { arrayValue: { values: [{ mapValue: { fields: {
      name: { stringValue: 'Gold' },
      participants: { arrayValue: {} },
      races: { arrayValue: {} },
    } } }] } },
  },
};

let calls: Call[];
let answers: Array<Response | Error>;

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected fetch of ${url}`);
    if (next instanceof Error) throw next;
    return next;
  }));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fresh() {
  return await import('@/lib/racesense-player');
}

describe('fetchRaceSenseRegattaDocument', () => {
  it('signs in anonymously, then reads the document as that user', async () => {
    const { fetchRaceSenseRegattaDocument: read } = await fresh();
    answers.push(SIGN_UP.clone(), jsonResponse(200, DOCUMENT));

    const doc = await read('abc123abc123abc123ab');
    expect(doc.fields?.name).toEqual({ stringValue: 'Autumn League' });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toMatch(/^https:\/\/identitytoolkit\.googleapis\.com\/v1\/accounts:signUp\?key=/);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[1].url).toBe(
      'https://firestore.googleapis.com/v1/projects/vakaros-racesense/databases/(default)/documents/regattas/abc123abc123abc123ab',
    );
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
  });

  it('keeps the token for the next read rather than minting one per fetch', async () => {
    const { fetchRaceSenseRegattaDocument: read } = await fresh();
    answers.push(SIGN_UP.clone(), jsonResponse(200, DOCUMENT), jsonResponse(200, DOCUMENT));

    await read('abc123abc123abc123ab');
    await read('abc123abc123abc123ab');
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([
      'identitytoolkit.googleapis.com',
      'firestore.googleapis.com',
      'firestore.googleapis.com',
    ]);
  });

  it('says so, in words, when there is no such regatta', async () => {
    const { fetchRaceSenseRegattaDocument: read } = await fresh();
    answers.push(SIGN_UP.clone(), jsonResponse(404, { error: { code: 404 } }));

    const err = await read('abc123abc123abc123ab').catch((e) => e);
    expect(err.name).toBe('RaceSensePlayerError');
    expect(err.failure).toBe('not-found');
    expect(err.message).toContain('no regatta with the id abc123abc123abc123ab');
  });

  it('says so when the read is refused, and signs in afresh next time', async () => {
    const { fetchRaceSenseRegattaDocument: read } = await fresh();
    answers.push(SIGN_UP.clone(), jsonResponse(403, { error: { code: 403 } }));

    const err = await read('abc123abc123abc123ab').catch((e) => e);
    expect(err.failure).toBe('refused');
    expect(err.message).toContain('refused the read (HTTP 403)');
    expect(err.message).toContain('Import the committee’s RaceSense export instead.');

    // The token was dropped: the next read signs in again.
    answers.push(jsonResponse(200, { idToken: 'tok-2', expiresIn: '3600' }), jsonResponse(200, DOCUMENT));
    await read('abc123abc123abc123ab');
    expect(calls).toHaveLength(4);
    expect((calls[3].init?.headers as Record<string, string>).authorization).toBe('Bearer tok-2');
  });

  it('says so when the sign-in itself is refused', async () => {
    const { fetchRaceSenseRegattaDocument: read } = await fresh();
    answers.push(jsonResponse(400, { error: { message: 'ADMIN_ONLY_OPERATION' } }));

    const err = await read('abc123abc123abc123ab').catch((e) => e);
    expect(err.failure).toBe('refused');
    expect(err.message).toContain('refused an anonymous sign-in (HTTP 400)');
  });

  it('says so when the player cannot be reached at all', async () => {
    const { fetchRaceSenseRegattaDocument: read } = await fresh();
    answers.push(new TypeError('fetch failed'));

    const err = await read('abc123abc123abc123ab').catch((e) => e);
    expect(err.failure).toBe('unreachable');
    expect(err.message).toContain('Couldn’t reach the RaceSense player’s data (fetch failed)');
  });

  it('says so when the answer is not a document', async () => {
    const { fetchRaceSenseRegattaDocument: read } = await fresh();
    answers.push(SIGN_UP.clone(), jsonResponse(200, { unexpected: true }));

    const err = await read('abc123abc123abc123ab').catch((e) => e);
    expect(err.failure).toBe('unreachable');
    expect(err.message).toContain('something other than a regatta');
  });
});

describe('fetchRaceSenseRegatta', () => {
  it('narrows the document to the regatta the import reads', async () => {
    const { fetchRaceSenseRegatta: read } = await fresh();
    answers.push(SIGN_UP.clone(), jsonResponse(200, DOCUMENT));

    const regatta = await read('abc123abc123abc123ab');
    expect(regatta.id).toBe('abc123abc123abc123ab');
    expect(regatta.name).toBe('Autumn League');
    expect(regatta.divisions.map((d) => d.name)).toEqual(['Gold']);
  });
});
