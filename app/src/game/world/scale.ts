/**
 * How much larger than their tuned sizes things are drawn on the field.
 *
 * Two dials rather than a camera zoom, because a zoom would enlarge the
 * distances too: the country would get bigger and nobody in it would get any
 * easier to see relative to it. These enlarge what stands on the map and leave
 * the map the size it is.
 *
 * Kept apart, and kept here, so the figures and the buildings can be tuned
 * separately and so the scatter (which is `world/`, and may not import from
 * `pixi/`) reads the same number the renderer does.
 */

/** Heroes, soldiers, the watch and the Unmade. */
export const ACTOR_SCALE = 1.5;

/** The holdings, the camps, the castle, and the trees inside the border. */
export const STRUCTURE_SCALE = 1.5;

/**
 * How far a holding's buildings are moved out from its middle.
 *
 * Enlarging a building in place grows it into its neighbours: the Keep's hall
 * and chapel ended up standing inside the castle wall. So the layout opens up
 * as well -- by less than the art grows, because a holding's paved ground does
 * not grow, and a building pushed a full half again out from the middle stood
 * on the grass beyond its own yard.
 */
export const LAYOUT_SPREAD = 1.25;

/** Where a holding's building actually stands, once the layout has opened up. */
export function builtAt(
  holding: { x: number; y: number },
  building: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: holding.x + (building.x - holding.x) * LAYOUT_SPREAD,
    y: holding.y + (building.y - holding.y) * LAYOUT_SPREAD,
  };
}
