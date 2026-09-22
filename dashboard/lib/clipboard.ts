/**
 * Clipboard helper for post text.
 *
 * RESPONSIBILITY
 *   Put a draft on the clipboard in the form LinkedIn actually honours.
 *
 * ## Why this writes plain text and not HTML
 *
 * This first shipped writing both flavours — `text/html` with real `<p>` and
 * `<ul>` elements, and `text/plain` beside it — on the theory that a rich editor
 * would build a list out of the markup. It does not survive contact with the
 * target: pasting the HTML flavour into LinkedIn reflows it and drops the
 * paragraph breaks, so a draft that reads correctly in the dashboard arrives in
 * the composer as one cramped block. Confirmed by pasting a freshly generated
 * post.
 *
 * ## Why a blank line carries a character
 *
 * Plain text alone was still not enough. LinkedIn's composer collapses a run of
 * newlines on paste, so `\n\n` — a genuine blank line in the string — arrives as
 * a single line break and the paragraphs close up. Typing Enter twice produces a
 * blank line; pasting two newlines does not.
 *
 * The blank line therefore gets one non-breaking space in it. It renders as
 * nothing, but it makes the line non-empty, which is the difference between a
 * paragraph break the editor keeps and whitespace it discards. Discord and the X
 * composer are untouched — they are given the stored text, which stays clean.
 *
 * WHAT THIS COSTS: one extra character per paragraph break reaches the composer.
 * The generator targets ~85% of the platform limit precisely so this kind of
 * overhead has room, and a LinkedIn post would need twenty paragraphs for it to
 * matter.
 *
 * DOES NOT OWN: what the draft says, or where the copy button lives.
 */

/**
 * Rewrites a draft for the clipboard.
 *
 * @param text - The stored post text.
 * @returns The same text with every blank line holding a non-breaking space.
 * @sideeffect none (pure)
 */
export function forClipboard(text: string): string {
  // Runs of two or more newlines collapse to a single blank line, which is then
  // filled with U+00A0. A regular space would be trimmed by some editors; a
  // non-breaking space survives.
  return text.replace(/\n{2,}/g, '\n\u00A0\n');
}

/**
 * Copies a draft to the clipboard.
 *
 * @param text - The exact published text: body plus hashtags.
 * @returns Resolves when the clipboard holds the draft.
 * @throws {Error} When the browser refuses the write — callers already treat
 *   that as the degraded path, because the text is on screen and selectable.
 * @sideeffect Writes to the system clipboard.
 */
export async function writeDraftToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(forClipboard(text));
}
