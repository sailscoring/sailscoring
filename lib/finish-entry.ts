/**
 * Computes the displayed finish position for each competitor in the ordering,
 * accounting for ties. Boats in tiedWithPrevious share the position of the
 * competitor immediately before them; subsequent positions skip numbers to fill
 * the tied slots.
 *
 * Example: order=[A, B, C, D], tiedWithPrevious={C} → [1, 2, 2, 4]
 *
 * @param order - Finishing order (array of competitor IDs)
 * @param tiedWithPrevious - IDs of boats tied with the boat immediately before them
 * @returns 1-based finish positions, parallel to order
 */
export function computePositions(order: string[], tiedWithPrevious: Set<string>): number[] {
  const positions: number[] = [];
  let nextPos = 1;
  for (let i = 0; i < order.length; i++) {
    if (i > 0 && tiedWithPrevious.has(order[i])) {
      positions.push(positions[i - 1]);
    } else {
      positions.push(nextPos);
    }
    nextPos++;
  }
  return positions;
}

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
