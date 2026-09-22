'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { writeDraftToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

/**
 * Copies the post text, then opens the platform's composer.
 *
 * ## Why this is a page and not just a link
 *
 * X pre-fills the composer from a URL parameter, so its link always worked.
 * LinkedIn has no such parameter — verified against LinkedIn's own share
 * documentation, which says the card is built from the destination page's Open
 * Graph tags and nothing else. So a LinkedIn link always opens an empty
 * composer, and the text has to be copied by hand.
 *
 * A Discord bot cannot reach the OS clipboard. Discord's Copy button only exists
 * on code blocks, and those cap at 2000 characters while a LinkedIn post can
 * reach 3000 — so the longest posts, which need the most help, have no Copy
 * button at all. That is the gap this closes: the clipboard write happens in a
 * real page instead, where it is allowed.
 *
 * ## Why copy before opening
 *
 * `window.open` is called immediately after the clipboard write, in the same
 * click handler, so the user gesture still covers it. Opening first and copying
 * after would lose the gesture and the copy would be refused.
 *
 * ## Why the clipboard write is plain text
 *
 * Both flavours were written at first, so LinkedIn could receive real list and
 * paragraph elements. It reflows them on paste and drops the breaks, so a
 * correctly formatted draft arrived as one block. Plain text keeps its newlines;
 * the formatting lives in the string. See `lib/clipboard.ts`.
 *
 * @param props - Component props.
 * @param props.text - The exact text to put on the clipboard.
 * @param props.composerUrl - Where to send the user once it is copied.
 * @param props.platformLabel - Used in the button and the status line.
 * @returns The copy-and-open control.
 * @sideeffect Writes to the clipboard and opens a new tab.
 */
export function CopyAndOpen({
  text,
  composerUrl,
  platformLabel,
}: {
  text: string;
  composerUrl: string;
  platformLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function handleClick() {
    let copied = false;

    try {
      await writeDraftToClipboard(text);
      copied = true;
      setState('copied');
    } catch {
      // Clipboard access is denied over plain http on a non-localhost host, and
      // in some browsers without focus. The text is on the page and selectable,
      // so this is a degraded path rather than a dead end — and the composer is
      // still opened, because that is still useful.
      setState('failed');
    }

    window.open(composerUrl, '_blank', 'noopener,noreferrer');

    if (copied) {
      // Reverts so the button is reusable without a reload.
      setTimeout(() => setState('idle'), 4000);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={handleClick} className="h-11 w-fit gap-2 px-5 font-semibold">
        {state === 'copied' ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        {state === 'copied' ? 'Copied — paste into LinkedIn' : `Copy & open ${platformLabel}`}
      </Button>

      {/* Announced politely so a screen reader is not interrupted mid-sentence. */}
      <p
        role="status"
        className={cn(
          'text-xs leading-relaxed',
          state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {state === 'failed' ? (
          <>
            Could not copy automatically. The composer is open — select the text above and copy it
            manually.
          </>
        ) : state === 'copied' ? (
          <>
            Copied. {platformLabel} is open in a new tab — paste and post.
          </>
        ) : (
          <>
            <ExternalLink className="mr-1 inline size-3" aria-hidden="true" />
            Puts the text on your clipboard and opens {platformLabel}. Paste, then post.
          </>
        )}
      </p>
    </div>
  );
}
