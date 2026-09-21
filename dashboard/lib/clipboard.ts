/**
 * Clipboard helpers for post text.
 *
 * RESPONSIBILITY
 *   Put a draft on the clipboard in the flavour the paste target actually
 *   understands.
 *
 * ## Why this is not `writeText`
 *
 * A plain-text clipboard write carries no structure: LinkedIn (and every other
 * rich editor) receives exactly the characters, so a paragraph break is only as
 * good as the blank lines in the string, and a list marker is only ever a
 * character. A pasted `-` never becomes a bullet — LinkedIn builds a list only
 * when the marker is typed. Writing the `text/html` flavour as well means the
 * editor receives real `<p>` and `<li>` elements and renders them as such.
 *
 * Both flavours go in one write, so a target that prefers plain text still gets
 * clean text rather than the HTML source.
 *
 * DOES NOT OWN: where the copy button lives, or what the draft says. The text
 * is passed through unchanged.
 */

/** A line that is a list item, whichever marker it uses. */
const BULLET_PATTERN = /^[ \t]*(?:•|[-*])[ \t]+/;

/**
 * Escapes the characters that would otherwise be read as markup.
 *
 * Post bodies are model output and user edits, so they can contain anything —
 * an `<` in "growth < 5%" must survive as text rather than opening a tag.
 *
 * @param value - Text to escape.
 * @returns The escaped text.
 * @sideeffect none (pure)
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Converts a draft into the HTML clipboard flavour.
 *
 * Blank-line-separated blocks become paragraphs, runs of bullet lines become a
 * real `<ul>`, and single newlines inside a paragraph become `<br>` so a
 * deliberate short line stays on its own line.
 *
 * Both `•` and `-` are treated as list markers: posts stored before the
 * generator started normalising bullets still paste as lists.
 *
 * @param text - The draft body, hashtags included.
 * @returns An HTML fragment (`<p>` and `<ul>` blocks).
 * @sideeffect none (pure)
 */
export function draftToHtml(text: string): string {
  const parts: string[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(`<p>${paragraph.map(escapeHtml).join('<br>')}</p>`);
    paragraph = [];
  };

  const flushBullets = () => {
    if (bullets.length === 0) return;
    parts.push(`<ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    bullets = [];
  };

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      flushBullets();
      flushParagraph();
      continue;
    }

    if (BULLET_PATTERN.test(line)) {
      flushParagraph();
      bullets.push(line.replace(BULLET_PATTERN, ''));
      continue;
    }

    flushBullets();
    paragraph.push(line);
  }

  flushBullets();
  flushParagraph();

  return parts.join('');
}

/**
 * Copies a draft as both rich HTML and plain text.
 *
 * @param text - The exact published text: body plus hashtags.
 * @returns Resolves when the clipboard holds the draft.
 * @throws {Error} When the browser refuses both flavours — callers already
 *   treat that as the degraded path (the text is on screen and selectable).
 * @sideeffect Writes to the system clipboard.
 */
export async function writeDraftToClipboard(text: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([draftToHtml(text)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // Some browsers refuse a multi-flavour write, and Safari refuses anything
      // but image/png unless the page is focused. Falling through to plain text
      // still copies the right characters — only the formatting is lost — which
      // is strictly better than reporting a failure.
    }
  }

  await navigator.clipboard.writeText(text);
}
