import { describe, expect, it } from 'vitest';

import { publicApiOpenApi } from '@/lib/public-api/openapi';

type Doc = {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, { get: { responses: Record<string, unknown> } }>;
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

  it('describes every resource the API serves', () => {
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/publications/{id}',
      '/publications/{id}/competitors',
      '/publications/{id}/races',
      '/publications/{id}/races/{n}',
      '/publications/{id}/standings',
      '/publications/{id}/standings/{fleet}',
    ]);
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

  it('leaves objects open, as additive changes within v1 require', () => {
    expect(JSON.stringify(doc)).not.toContain('"additionalProperties":false');
    expect(JSON.stringify(doc)).not.toContain('"$schema"');
  });
});
