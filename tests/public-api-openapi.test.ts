import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { publicApiOpenApi } from '@/lib/public-api/openapi';

type Operation = {
  responses: Record<string, unknown>;
  security?: Record<string, string[]>[];
  'x-stability-level'?: string;
  requestBody?: unknown;
};
type Doc = {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, { description: string }> };
};

const doc = publicApiOpenApi('https://app.example') as unknown as Doc;

function refs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => refs(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else refs(v, out);
    }
  }
  return out;
}

describe('the published results API description', () => {
  it('is OpenAPI 3.1, served from the instance', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://app.example/api/public/v1' }]);
  });

  it('describes every call the API serves, with the methods its routes export', () => {
    // Every route file below app/api/public/v1, as an OpenAPI path.
    const root = join(__dirname, '..', 'app', 'api', 'public', 'v1');
    const routes = new Map<string, string[]>();
    const walk = (dir: string, path: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name.startsWith('_') || name === 'openapi.json') continue;
          walk(full, `${path}/${name}`);
        } else if (name === 'route.ts') {
          const methods = [...readFileSync(full, 'utf8').matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1].toLowerCase());
          routes.set(path, methods);
        }
      }
    };
    walk(root, '');
    const described = new Map(Object.entries(doc.paths).map(([path, ops]) => [path, Object.keys(ops).sort()]));
    for (const [route, methods] of routes) {
      if (route.includes('[[...resource]]')) continue; // the publications' catch-all, described resource by resource
      const path = route.replace(/\[(\w+)\]/g, '{$1}');
      expect(described.get(path), path).toEqual(methods.sort());
    }
    expect(Object.keys(doc.paths).filter((p) => p.startsWith('/publications/{id}')).sort()).toEqual([
      '/publications/{id}',
      '/publications/{id}/competitors',
      '/publications/{id}/races',
      '/publications/{id}/races/{n}',
      '/publications/{id}/schedule',
      '/publications/{id}/standings',
      '/publications/{id}/standings/{fleet}',
    ]);
  });

  it('needs no token for the published results, and a scoped one for the rest, as a preview', () => {
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const op of Object.values(ops)) {
        if (path.startsWith('/publications/{id}')) {
          expect(op.security, path).toEqual([]);
          expect(op['x-stability-level'], path).toBeUndefined();
        } else {
          expect(op.security?.[0]?.oauth, path).toHaveLength(1);
          expect(op['x-stability-level'], path).toBe('alpha');
        }
      }
    }
  });

  it('resolves every reference to a described component', () => {
    const names = new Set(Object.keys(doc.components.schemas));
    for (const ref of refs(doc)) {
      expect(names).toContain(ref.replace('#/components/schemas/', ''));
    }
    for (const schema of Object.values(doc.components.schemas)) {
      expect(schema.description).not.toBe('');
    }
  });

  it('leaves responses open, as additive changes within v1 require, and request bodies closed', () => {
    const { CreateRaces, StartChange, Publish, ...responses } = doc.components.schemas;
    expect(JSON.stringify(responses)).not.toContain('"additionalProperties":false');
    for (const input of [CreateRaces, StartChange, Publish]) {
      expect(JSON.stringify(input)).toContain('"additionalProperties":false');
    }
    expect(JSON.stringify(doc)).not.toContain('"$schema"');
  });

  it('is committed as generated', () => {
    // The copy CI compares for breaking changes. Regenerate with `pnpm openapi:generate`.
    const committed = readFileSync(join(__dirname, '..', 'docs', 'openapi', 'public-v1.json'), 'utf8');
    expect(JSON.parse(committed)).toEqual(publicApiOpenApi('https://app.sailscoring.ie'));
  });
});
