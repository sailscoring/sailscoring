/**
 * Generate a placeholder series name from nautical adjective + noun pairs.
 * These are clearly temporary (no scorer would name their event this) but
 * recognisably nautical — a small signal that the application has a personality.
 */

const ADJECTIVES = [
  'Gusty', 'Briny', 'Choppy', 'Leaky', 'Squalling',
  'Breezy', 'Foggy', 'Rusty', 'Salty', 'Stormy',
  'Slack', 'Lumpy', 'Fluky', 'Drifty', 'Tangled',
];

const NOUNS = [
  'Halyard', 'Barnacle', 'Rudder', 'Cleat', 'Mizzen',
  'Tiller', 'Bowsprit', 'Fairlead', 'Shroud', 'Shackle',
  'Bollard', 'Batten', 'Spinnaker', 'Keel', 'Jib',
];

export function generatePlaceholderName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun} Series`;
}

/**
 * Like `generatePlaceholderName`, but won't collide with names in `existing`.
 * Tries a handful of random draws; if all collide, falls back to disambiguation
 * so a suffix like ` (2)` is appended to a random draw.
 */
export function generateUniquePlaceholderName(existing: Iterable<string>): string {
  const taken = new Set<string>();
  for (const name of existing) taken.add(name.trim().toLowerCase());
  for (let i = 0; i < 10; i++) {
    const candidate = generatePlaceholderName();
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // All draws collided; fall back to suffixed disambiguation via a re-imported
  // helper to avoid pulling in the full series-name module at callers that only
  // need `generatePlaceholderName`.
  const fallback = generatePlaceholderName();
  let n = 2;
  while (taken.has(`${fallback.toLowerCase()} (${n})`)) n++;
  return `${fallback} (${n})`;
}
