// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The fetcher against a stand-in for the player's endpoint: what it asks
 * for, and the sentence it produces for each way the read can fail. The
 * module is re-imported per test so nothing carries over.
 */

type Call = { url: string; init: RequestInit | undefined };

const REGATTA_ID = 'abc123abc123abc123ab';
const URL_FOR = `https://player.vakaros.com/api/regatta?event=${REGATTA_ID}`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const HISTORY = {
  eventId: REGATTA_ID,
  source: 'firestore-snapshot',
  revisions: [
    { validFrom: null, doc: { name: 'Autumn League', divisions: [{ name: 'Gold', participants: [], races: [] }] } },
  ],
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

/** The error a read failed with, or a failure saying it didn't fail. */
async function failureOf(read: Promise<unknown>): Promise<Error & { failure: string }> {
  try {
    await read;
  } catch (e) {
    return e as Error & { failure: string };
  }
  throw new Error('expected the read to fail, and it did not');
}

describe('fetchRaceSenseRegattaHistory', () => {
  it('reads the regatta in one request, with no credential', async () => {
    const { fetchRaceSenseRegattaHistory: read } = await fresh();
    answers.push(jsonResponse(200, HISTORY));

    const history = await read(REGATTA_ID);
    expect(history.revisions).toHaveLength(1);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_FOR);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.accept).toBe('application/json');
    expect(Object.keys(headers)).toEqual(['accept']);
  });

  it('says so, in words, when there is no such regatta', async () => {
    const { fetchRaceSenseRegattaHistory: read } = await fresh();
    answers.push(jsonResponse(404, { error: `Regatta not found: ${REGATTA_ID}` }));

    const err = await failureOf(read(REGATTA_ID));
    expect(err.name).toBe('RaceSensePlayerError');
    expect(err.failure).toBe('not-found');
    expect(err.message).toContain(`no regatta with the id ${REGATTA_ID}`);
  });

  it('says so when the read is refused, and points at the export', async () => {
    const { fetchRaceSenseRegattaHistory: read } = await fresh();
    answers.push(jsonResponse(403, { error: 'no' }));

    const err = await failureOf(read(REGATTA_ID));
    expect(err.failure).toBe('refused');
    expect(err.message).toContain('refused the read (HTTP 403)');
    expect(err.message).toContain('Import the committee’s RaceSense export instead.');
  });

  it('says so when the player answers with anything else', async () => {
    const { fetchRaceSenseRegattaHistory: read } = await fresh();
    answers.push(jsonResponse(500, { error: 'boom' }));

    const err = await failureOf(read(REGATTA_ID));
    expect(err.failure).toBe('unreachable');
    expect(err.message).toContain('answered HTTP 500');
  });

  it('says so when the player cannot be reached at all', async () => {
    const { fetchRaceSenseRegattaHistory: read } = await fresh();
    answers.push(new TypeError('fetch failed'));

    const err = await failureOf(read(REGATTA_ID));
    expect(err.failure).toBe('unreachable');
    expect(err.message).toContain('Couldn’t reach the RaceSense player’s data (fetch failed)');
  });

  it('says so when the answer is not a regatta', async () => {
    const { fetchRaceSenseRegattaHistory: read } = await fresh();
    answers.push(jsonResponse(200, { unexpected: true }));

    const err = await failureOf(read(REGATTA_ID));
    expect(err.failure).toBe('unreachable');
    expect(err.message).toContain('something other than a regatta');
  });

  it('says so when the answer is not JSON at all', async () => {
    const { fetchRaceSenseRegattaHistory: read } = await fresh();
    answers.push(new Response('<html>maintenance</html>', { status: 200 }));

    const err = await failureOf(read(REGATTA_ID));
    expect(err.failure).toBe('unreachable');
    expect(err.message).toContain('something other than a regatta');
  });
});

describe('fetchRaceSenseRegatta', () => {
  it('narrows the current revision to the regatta the import reads', async () => {
    const { fetchRaceSenseRegatta: read } = await fresh();
    answers.push(jsonResponse(200, HISTORY));

    const regatta = await read(REGATTA_ID);
    expect(regatta.id).toBe(REGATTA_ID);
    expect(regatta.name).toBe('Autumn League');
    expect(regatta.divisions.map((d) => d.name)).toEqual(['Gold']);
  });

  it('reads the current revision, not the first', async () => {
    const { fetchRaceSenseRegatta: read } = await fresh();
    answers.push(jsonResponse(200, {
      ...HISTORY,
      revisions: [
        { validFrom: null, doc: { name: 'Autumn League', divisions: [] } },
        { validFrom: 2, doc: { name: 'Autumn League', divisions: [{ name: 'Gold' }, { name: 'Silver' }] } },
      ],
    }));

    const regatta = await read(REGATTA_ID);
    expect(regatta.divisions.map((d) => d.name)).toEqual(['Gold', 'Silver']);
  });
});
