/**
 * Match a competitor's free-text boat class against the bundled RYA PY register
 * — the class-name analogue of `rating-match.ts` (which matches by sail number).
 *
 * Pure: no `server-only`, no network. The PY list is matched by *class*, not by
 * boat, so a whole one-design fleet collapses to a single lookup. Matching runs
 * in two tiers so a precise full-name hit always beats a looser alias:
 *  1. the class's canonical name, exactly;
 *  2. aliases — the register slug, each `/`-separated alternative (so "Laser"
 *     resolves "ILCA 7 / Laser"), and the name with any trailing parenthetical
 *     dropped ("Flying Fifteen Silver" ↔ "Flying Fifteen Silver (2701-3400)").
 *
 * A key that resolves to more than one distinct class is reported as ambiguous
 * (e.g. two Comet Trio rigs) for the scorer to disambiguate; the planner and
 * dialog never guess between them.
 */

import { RYA_PY_CLASSES } from './generated/py-list';
import type { RyaPyClass } from './types';

/** Canonicalise a class name for comparison: lowercase, drop accents and
 *  everything that isn't a letter or digit. `"ILCA 7 / Laser"` → `"ilca7laser"`. */
export function normalizeClassName(name: string | undefined): string {
  if (!name) return '';
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/** Stable identity for a class — its Class ID, or its normalised name for the
 *  no-ID limited-data long tail. Used to tell "one class, several match keys"
 *  apart from "several classes". */
export function classKey(cls: RyaPyClass): string {
  return cls.classId !== undefined ? `id:${cls.classId}` : `nm:${normalizeClassName(cls.name)}`;
}

export type ClassMatch =
  /** A single class matched — `via` records whether on the canonical name or a
   *  looser alias, so the dialog can show the basis. */
  | { kind: 'matched'; cls: RyaPyClass; via: 'name' | 'alias' }
  /** The key resolved to several distinct classes; the scorer must pick. */
  | { kind: 'ambiguous'; candidates: RyaPyClass[] }
  | { kind: 'none' };

export interface ClassMatcher {
  match(enteredClass: string | undefined): ClassMatch;
  /** All classes, sorted by name — for the manual-picker dropdown. */
  all(): readonly RyaPyClass[];
}

/** Alias keys for a class, excluding its full-name key (that's the exact tier).
 *  Slug, each `/`-separated part, and the name without a trailing parenthetical. */
function aliasKeysFor(cls: RyaPyClass, fullKey: string): string[] {
  const keys = new Set<string>();
  const add = (s: string) => {
    const k = normalizeClassName(s);
    if (k && k !== fullKey) keys.add(k);
  };
  if (cls.slug) add(cls.slug.replace(/_/g, ' '));
  for (const part of cls.name.split('/')) add(part);
  add(cls.name.replace(/\([^)]*\)/g, ' '));
  return [...keys];
}

function dedupe(classes: readonly RyaPyClass[] | undefined): RyaPyClass[] {
  if (!classes) return [];
  const seen = new Set<string>();
  const out: RyaPyClass[] = [];
  for (const c of classes) {
    const k = classKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

function push(map: Map<string, RyaPyClass[]>, key: string, cls: RyaPyClass): void {
  const list = map.get(key);
  if (list) list.push(cls);
  else map.set(key, [cls]);
}

/** Build a matcher over an arbitrary class list (the bundled list, or a fixture
 *  in tests). */
export function createClassMatcher(classes: readonly RyaPyClass[]): ClassMatcher {
  const byName = new Map<string, RyaPyClass[]>();
  const byAlias = new Map<string, RyaPyClass[]>();
  for (const cls of classes) {
    const fullKey = normalizeClassName(cls.name);
    if (fullKey) push(byName, fullKey, cls);
    for (const a of aliasKeysFor(cls, fullKey)) push(byAlias, a, cls);
  }
  const sorted = [...classes].sort((a, b) => a.name.localeCompare(b.name));

  return {
    all: () => sorted,
    match(enteredClass) {
      const key = normalizeClassName(enteredClass);
      if (!key) return { kind: 'none' };

      const named = dedupe(byName.get(key));
      if (named.length === 1) return { kind: 'matched', cls: named[0], via: 'name' };
      if (named.length > 1) return { kind: 'ambiguous', candidates: named };

      const aliased = dedupe(byAlias.get(key));
      if (aliased.length === 1) return { kind: 'matched', cls: aliased[0], via: 'alias' };
      if (aliased.length > 1) return { kind: 'ambiguous', candidates: aliased };

      return { kind: 'none' };
    },
  };
}

/** The default matcher over the bundled RYA PY dataset. */
export const ryaPyMatcher: ClassMatcher = createClassMatcher(RYA_PY_CLASSES);
