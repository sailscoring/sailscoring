/**
 * Moves a competitor to a new position in the finishing order.
 *
 * @param order - Current finishing order (array of competitor IDs, 0-indexed)
 * @param competitorId - The competitor to move
 * @param newPosition - Target position (1-based); must be in range [1, order.length]
 * @returns New finishing order array (original is not mutated)
 */
export function reorderFinisher(
  order: string[],
  competitorId: string,
  newPosition: number,
): string[] {
  const next = [...order];
  const currentIndex = next.indexOf(competitorId);
  if (currentIndex === -1) return next;

  next.splice(currentIndex, 1);
  next.splice(newPosition - 1, 0, competitorId);
  return next;
}
