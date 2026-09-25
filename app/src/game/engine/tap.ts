/**
 * Whether a press on the field was a tap, or the end of a pan or a pinch.
 *
 * The field is one surface for three gestures: drag to pan, pinch to zoom, tap
 * to inspect a figure or send your hero somewhere. The renderer reports a tap
 * whenever a pointer goes down and up on the same target, which on a phone
 * includes the last finger lifting off after a pinch and a pan short enough
 * not to look like one -- so every zoom ended by marching the hero to wherever
 * a thumb happened to be. That is what "the touch controls are inaccurate"
 * felt like.
 *
 * So a tap is a press that barely moved and was never joined by a second
 * finger. A finger is allowed to wander further than a mouse before the press
 * stops being a tap, because fingertips roll.
 */
export interface Press {
  x: number;
  y: number;
  /** A second pointer went down before this one came up. */
  multi: boolean;
}

/** How far, in screen pixels, a press may travel and still be a tap. */
export function tapSlop(pointerType: string): number {
  return pointerType === "touch" || pointerType === "pen" ? 14 : 6;
}

export function isTap(press: Press | undefined, x: number, y: number, pointerType: string): boolean {
  if (!press || press.multi) return false;
  return Math.hypot(x - press.x, y - press.y) <= tapSlop(pointerType);
}

/**
 * How much further than drawn a figure answers a press, in screen pixels.
 *
 * A fingertip covers far more of the screen than a cursor's point, and a
 * figure zoomed out on a phone is smaller than the finger aiming at it.
 */
export function pickSlop(pointerType: string): number {
  return pointerType === "touch" || pointerType === "pen" ? 24 : 0;
}
