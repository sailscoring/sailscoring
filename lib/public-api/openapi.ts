import { z } from 'zod';

import { publicApiV1Descriptions, publicApiV1Registry } from '../validation/public-api-v1';
// Registers the authenticated part's schemas alongside the published results'.
import '../validation/public-api-v1-authenticated';
import { SCOPE_DESCRIPTIONS } from '../oauth-scopes';

/**
 * The public API's OpenAPI 3.1 description: the authenticated calls (ADR-016)
 * and the published results beside them (ADR-015), generated from the Zod
 * schemas the requests and responses are built to, so it cannot describe a
 * shape the API does not serve.
 *
 * Generated, and also committed (`docs/openapi/public-v1.json`), so that a
 * change to it shows in review and CI can refuse a breaking one. Two
 * adjustments to Zod's output. Each component loses its `$schema` and `$id`,
 * which OpenAPI's components do not carry. And a response's objects lose
 * `additionalProperties: false`: within a version the API adds fields, and a
 * client generated from a closed schema would reject the first one. A
 * request body stays closed, because a field the server doesn't know is
 * refused.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The request bodies, which stay closed. */
const INPUTS = new Set(['CreateRaces', 'StartChange', 'Publish']);

function open(value: Json): Json {
  if (Array.isArray(value)) return value.map(open);
  if (value === null || typeof value !== 'object') return value;
  const out: { [key: string]: Json } = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '$schema' || k === '$id') continue;
    if (k === 'additionalProperties' && v === false) continue;
    out[k] = open(v);
  }
  return out;
}

function strip(value: Json): Json {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== 'object') return value;
  const out: { [key: string]: Json } = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '$schema' || k === '$id') continue;
    out[k] = strip(v);
  }
  return out;
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const errorBody = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } });

// ─── The published results ───────────────────────────────────────────────────

function response(id: string, description: string) {
  return {
    description,
    headers: {
      ETag: { description: 'Send back as `If-None-Match` to be answered 304 while unchanged.', schema: { type: 'string' } },
    },
    content: { 'application/json': { schema: ref(id) } },
  };
}

const publishedErrors = {
  '304': { description: 'Unchanged since the `If-None-Match` ETag.' },
  '400': errorBody('A query parameter was sent; the API takes none.'),
  '404': errorBody('No such publication, or it publishes no such resource.'),
};

const publicationId = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'The publication, as its `index.json` entry links it.',
  schema: { type: 'string', format: 'uuid' },
};

function published(summary: string, id: string, extraParams: object[] = []) {
  return {
    get: {
      tags: ['Published results'],
      summary,
      security: [],
      parameters: [publicationId, ...extraParams],
      responses: { '200': response(id, summary), ...publishedErrors },
    },
  };
}

// ─── The authenticated part ──────────────────────────────────────────────────

const workspaceHeader = {
  name: 'x-sailscoring-workspace',
  in: 'header',
  required: false,
  description:
    'The workspace to act in, by id or slug. An app\'s token reaches only the workspace its grant names, and may leave this out; the CLI\'s names one of its user\'s.',
  schema: { type: 'string' },
};
const idempotencyKey = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description: 'Any string: a retried write with the same key is answered as the first was, and not done again.',
  schema: { type: 'string' },
};
const ifMatch = {
  name: 'If-Match',
  in: 'header',
  required: false,
  description: 'Refuse the write (409) if the start has changed since this version.',
  schema: { type: 'string' },
};
const pathParam = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', format: 'uuid' },
});
const seriesId = pathParam('id', 'The series.');
const raceId = pathParam('raceId', 'The race.');
const startId = pathParam('startId', 'The start.');

const authErrors = {
  '400': errorBody('The request isn\'t what the call takes: `invalid`, with the fields at fault in `problems`.'),
  '401': errorBody('No access token, or one that has expired or been revoked: `unauthenticated`.'),
  '403': errorBody('Outside the grant\'s scopes or workspace, or the user\'s role there: `forbidden`.'),
  '404': errorBody('No such series, race or start in the workspace: `not-found`.'),
  '423': errorBody('The series is archived or final, and read-only: `archived`.'),
  '429': errorBody('Too many calls for this grant; `Retry-After` says how long to wait.'),
};

function authenticated(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  scope: string,
  summary: string,
  opts: {
    params?: object[];
    body?: { schema: Json; description?: string };
    result?: string;
    description?: string;
    conflict?: string;
  } = {},
) {
  const write = method !== 'get';
  return {
    [method]: {
      tags: ['Workspace'],
      summary,
      ...(opts.description ? { description: opts.description } : {}),
      security: [{ oauth: [scope] }],
      parameters: [...(opts.params ?? []), workspaceHeader, ...(write ? [idempotencyKey] : [])],
      ...(opts.body
        ? {
            requestBody: {
              required: true,
              ...(opts.body.description ? { description: opts.body.description } : {}),
              content: { 'application/json': { schema: opts.body.schema } },
            },
          }
        : {}),
      responses: {
        ...(opts.result
          ? { '200': { description: summary, content: { 'application/json': { schema: ref(opts.result) } } } }
          : { '204': { description: 'Done.' } }),
        ...authErrors,
        ...(opts.conflict ? { '409': errorBody(opts.conflict) } : {}),
      },
    },
  };
}

export function publicApiOpenApi(origin: string): Json {
  const generated = z.toJSONSchema(publicApiV1Registry, {
    uri: (id) => `#/components/schemas/${id}`,
  }).schemas as Record<string, Json>;
  const schemas: Record<string, Json> = {};
  for (const [id, schema] of Object.entries(generated)) {
    const shaped = (INPUTS.has(id) ? strip(schema) : open(schema)) as { [key: string]: Json };
    schemas[id] = { description: publicApiV1Descriptions[id] ?? '', ...shaped };
  }
  const scopes = Object.fromEntries(Object.entries(SCOPE_DESCRIPTIONS));
  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'Sail Scoring public API',
      version: '1',
      description:
        'Two parts. The workspace calls act in a workspace for a signed-in user, through an OAuth access token their app obtained with the authorization code flow (PKCE): read its series, set up races, starts and courses, and publish; the CLI signs in with the device authorization grant (RFC 8628) at /api/auth/device/code. The published results need no sign-in: results as their published pages show them, each resource following the page that shows it; find publications from /p/index.json and each workspace\'s index.json. Within v1 changes are additive; a breaking change is a new version, and the old one serves for a year after it.',
    },
    servers: [{ url: `${origin}/api/public/v1` }],
    tags: [
      { name: 'Workspace', description: 'Acting in a workspace for a signed-in user.' },
      { name: 'Published results', description: 'Read-only, no sign-in.' },
    ],
    paths: {
      '/publications/{id}': published('The publication, and which resources it publishes', 'Publication'),
      '/publications/{id}/standings': published('Every fleet\'s standings', 'Standings'),
      '/publications/{id}/standings/{fleet}': published('One fleet\'s standings', 'Standings', [
        { name: 'fleet', in: 'path', required: true, description: 'The fleet\'s `key`.', schema: { type: 'string' } },
      ]),
      '/publications/{id}/races': published('The sailed races', 'Races'),
      '/publications/{id}/races/{n}': published('One race\'s results, by fleet', 'Race', [
        { name: 'n', in: 'path', required: true, description: 'The race\'s number in the series.', schema: { type: 'integer', minimum: 1 } },
      ]),
      '/publications/{id}/competitors': published('The entry list', 'Competitors'),
      '/publications/{id}/schedule': published('Every race, sailed or not, as of the Schedule page', 'Schedule'),

      '/workspaces': authenticated('get', 'read', 'The workspaces this token can act in', { result: 'Workspaces' }),
      '/workspace/seasons': authenticated('get', 'read', 'The workspace\'s seasons', { result: 'Seasons' }),
      '/publications': authenticated('get', 'read', 'Every publication in the workspace', { result: 'WorkspacePublications' }),
      '/series': authenticated('get', 'read', 'Every series in the workspace', { result: 'SeriesList' }),
      '/series/{id}': authenticated('get', 'read', 'A series', { params: [seriesId], result: 'Series' }),
      '/series/{id}/fleets': authenticated('get', 'read', 'A series\' fleets', { params: [seriesId], result: 'Fleets' }),
      '/series/{id}/competitors': authenticated('get', 'read', 'A series\' entry list', { params: [seriesId], result: 'CompetitorList' }),
      '/series/{id}/races': {
        ...authenticated('get', 'read', 'A series\' races, with their starts', { params: [seriesId], result: 'RaceList' }),
        ...authenticated('post', 'races', 'Add races, with their starts', {
          params: [seriesId],
          body: { schema: ref('CreateRaces') },
          result: 'RaceList',
          description: 'Added after the series\' last race, and numbered by the server. A fleet starts once per race.',
        }),
      },
      '/series/{id}/races/{raceId}': {
        ...authenticated('get', 'read', 'A race, with its starts', { params: [seriesId, raceId], result: 'Race' }),
        ...authenticated('delete', 'races', 'Delete a race', {
          params: [seriesId, raceId],
          description: 'Later races are renumbered.',
        }),
      },
      '/races/{raceId}/finishes': authenticated('get', 'read', 'A race\'s finishes, in finishing order', {
        params: [raceId],
        result: 'FinishList',
      }),
      '/races/{raceId}/starts/{startId}': {
        ...authenticated('patch', 'races', 'Change a start\'s gun time or fleets', {
          params: [raceId, startId, ifMatch],
          body: { schema: ref('StartChange') },
          result: 'Start',
          conflict: 'Changed since the `If-Match` version: `conflict`.',
        }),
        ...authenticated('delete', 'races', 'Delete a start', { params: [raceId, startId] }),
      },
      '/races/{raceId}/starts/{startId}/course': authenticated('put', 'races', 'Set a start\'s course from an ORC constructed course document', {
        params: [
          raceId,
          startId,
          ifMatch,
          { name: 'replace', in: 'query', required: false, description: '`true` to replace legs the start already has.', schema: { type: 'boolean' } },
        ],
        body: {
          schema: { type: 'object', description: 'An ORC constructed course document (`"format": "orc-constructed-course"`), as written: magnetic, with an anchor where there is one.' },
        },
        result: 'Start',
        description: 'Read and converted as the race-start dialog\'s import does: bearings to true at the variation where the course is, on the race\'s day.',
        conflict: 'The start already has legs and `replace` wasn\'t `true`, or it changed since the `If-Match` version: `conflict`.',
      }),
      '/series/{id}/publish': {
        ...authenticated('get', 'read', 'A series\' publication', { params: [seriesId], result: 'SeriesPublication' }),
        ...authenticated('post', 'publish', 'Publish the series', {
          params: [seriesId],
          body: { schema: ref('Publish') },
          result: 'SeriesPublication',
        }),
        ...authenticated('delete', 'publish', 'Unpublish the series', { params: [seriesId] }),
      },
    },
    components: {
      schemas,
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          description: 'OAuth 2.0 with PKCE; apps are registered by Sail Scoring, not by themselves. Ask for `offline_access` to get a refresh token.',
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/api/auth/oauth2/authorize`,
              tokenUrl: `${origin}/api/auth/oauth2/token`,
              refreshUrl: `${origin}/api/auth/oauth2/token`,
              scopes,
            },
          },
        },
      },
    },
  };
  return doc as unknown as Json;
}
