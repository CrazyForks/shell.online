/**
 * The face everything that is not a place name is set in, on the canvas.
 *
 * The same stack as `--keep-font` in game.css, so a plate over a soldier and
 * the panel describing it are in one hand. Pirata One stays for the names of
 * places; this is for everything read rather than admired.
 *
 * A canvas does not wait for webfonts: see the `document.fonts.load` in
 * keepScene.ts, which holds the first draw until this has arrived.
 */
export const BODY_FONT = '"Pirata One", Georgia, serif';

/**
 * Body text on the canvas in the face's lowercase, as it is in the DOM (see
 * the rule on .keep in game.css). A canvas has no text-transform, so it is
 * done to the string.
 */
export function bodyText(text: string): string {
  return text.toLowerCase();
}
