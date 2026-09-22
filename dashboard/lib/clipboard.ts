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
 * post, not by reasoning about it.
 *
 * Plain text keeps its newlines through a paste, and the string is normalised
 * long before it reaches here (`normalizePostText` in the API), so paragraphs
 * arrive as blank lines and list items start with a real bullet character. That
 * is the whole fix: the formatting has to live in the text, not in markup the
 * receiving editor is free to reinterpret.
 *
 * DOES NOT OWN: what the draft says, or where the copy button lives.
 */

/**
 * Copies a draft to the clipboard as plain text.
 *
 * @param text - The exact published text: body plus hashtags.
 * @returns Resolves when the clipboard holds the draft.
 * @throws {Error} When the browser refuses the write — callers already treat
 *   that as the degraded path, because the text is on screen and selectable.
 * @sideeffect Writes to the system clipboard.
 */
export async function writeDraftToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
