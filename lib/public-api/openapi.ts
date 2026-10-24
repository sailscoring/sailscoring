import { z } from 'zod';

import { publicApiV1Descriptions, publicApiV1Registry } from '../validation/public-api-v1';

/**
 * The published results API's OpenAPI 3.1 description (ADR-015), generated
 * from the Zod schemas the responses are built to, so it cannot describe a
 * shape the API does not serve.
 *
 * Generated rather than committed: there is no second copy to fall out of
 * date. Two adjustments to Zod's output. Each component loses its `$schema`
 * and `$id`, which OpenAPI's components do not carry. And objects lose
 * `additionalProperties: false`: within a version the API adds fields, and a
 * client generated from a closed schema would reject the first one.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

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

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

function response(id: string, description: string) {
  return {
    description,
    headers: {
      ETag: { description: 'Send back as `If-None-Match` to be answered 304 while unchanged.', schema: { type: 'string' } },
    },
    content: { 'application/json': { schema: ref(id) } },
  };
}

const errors = {
  '304': { description: 'Unchanged since the `If-None-Match` ETag.' },
  '400': { description: 'A query parameter was sent; the API takes none.', content: { 'application/json': { schema: ref('Error') } } },
  '404': { description: 'No such publication, or it publishes no such resource.', content: { 'application/json': { schema: ref('Error') } } },
};

const publicationId = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'The publication, as its `index.json` entry links it.',
  schema: { type: 'string', format: 'uuid' },
};

function operation(summary: string, id: string, extraParams: object[] = []) {
  return {
    get: {
      summary,
      parameters: [publicationId, ...extraParams],
      responses: { '200': response(id, summary), ...errors },
    },
  };
}

export function publicApiOpenApi(origin: string): Json {
  const generated = z.toJSONSchema(publicApiV1Registry, {
    uri: (id) => `#/components/schemas/${id}`,
  }).schemas as Record<string, Json>;
  const schemas: Record<string, Json> = {};
  for (const [id, schema] of Object.entries(generated)) {
    const opened = open(schema) as { [key: string]: Json };
    schemas[id] = { description: publicApiV1Descriptions[id] ?? '', ...opened };
  }
  return open({
    openapi: '3.1.0',
    info: {
      title: 'Sail Scoring published results API',
      version: '1',
      description:
        'Read-only results as their published pages show them. Each resource follows the page that shows it, and changes when that page is published. Find publications from /p/index.json and each workspace\'s index.json. Within v1 changes are additive; a breaking change is a new version, and the old one serves for a year after it.',
    },
    servers: [{ url: `${origin}/api/public/v1` }],
    paths: {
      '/publications/{id}': operation('The publication, and which resources it publishes', 'Publication'),
      '/publications/{id}/standings': operation('Every fleet\'s standings', 'Standings'),
      '/publications/{id}/standings/{fleet}': operation('One fleet\'s standings', 'Standings', [
        { name: 'fleet', in: 'path', required: true, description: 'The fleet\'s `key`.', schema: { type: 'string' } },
      ]),
      '/publications/{id}/races': operation('The sailed races', 'Races'),
      '/publications/{id}/races/{n}': operation('One race\'s results, by fleet', 'Race', [
        { name: 'n', in: 'path', required: true, description: 'The race\'s number in the series.', schema: { type: 'integer', minimum: 1 } },
      ]),
      '/publications/{id}/competitors': operation('The entry list', 'Competitors'),
      '/publications/{id}/schedule': operation('Every race, sailed or not, as of the Schedule page', 'Schedule'),
    },
    components: { schemas },
  } as unknown as Json);
}
