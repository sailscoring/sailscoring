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
