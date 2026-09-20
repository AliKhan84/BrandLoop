'use client';

import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Puts the post's image on the clipboard, ready to paste into the composer.
 *
 * ## Why the clipboard, and not a link
 *
 * LinkedIn's share endpoint builds its card from the destination page's Open
 * Graph tags: there is no parameter that seeds the post body (see
 * `CopyAndOpen`), and none that attaches an image. The version that *can*
 * attach one is the Community Management API, which needs an app review and
 * `w_member_social` — deliberately out of scope — and driving a real session to
 * fake it is worse, because it risks the user's own account.
 *
 * What is left is the clipboard, which can carry an image, and LinkedIn's
 * composer, which accepts a pasted one. So the image is copied here and pasted
 * there: the same handoff as the text, one paste later.
 *
 * ## Why the JPEG is re-encoded as PNG
 *
 * Clipboard writes accept a narrow set of types, and Chromium rejects
 * `image/jpeg` outright ("Type image/jpeg not supported on write"). PNG is
 * accepted wherever the API exists at all. The generated images are flat
 * illustrations, so the PNG costs a fraction of a megabyte rather than the
 * several a photograph would.
 *
 * ## Why one clipboard slot matters to the copy
 *
 * A clipboard holds one thing at a time, so copying the image replaces the
 * copied text. The order in the interface is therefore load-bearing: text
 * first, image second — which is why this control sits below the text and says
 * so.
 *
 * @param props - Component props.
 * @param props.src - Same-origin URL of the image to copy. See the route at
 *   `app/api/posts/[postId]/image` for why it is not the API's own URL.
 * @param props.filename - Name to use for the download fallback.
 * @param props.platformLabel - Used in the status line.
 * @returns The copy-image control.
 * @sideeffect Fetches the image and writes to the clipboard.
 */
export function CopyImageButton({
  src,
  filename,
  platformLabel,
}: {
  src: string;
  filename: string;
  platformLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function handleClick() {
    try {
      // The item is built with a *promise*, so `write` is still called inside
      // the click's user gesture while the fetch and the re-encode happen.
      // Awaiting the image first and calling `write` after is refused — Safari
      // requires the gesture to still be open.
      //
      // `ClipboardItem` is undefined in browsers without image clipboard
      // support (notably Firefox); that throws here and lands in the fallback
      // below, which is why this needs no feature detection of its own.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPngBlob(src) })]);
      setState('copied');
      // Reverts so the button is usable again without a reload.
      setTimeout(() => setState('idle'), 4000);
    } catch {
      // Denied over plain http on a non-localhost host, in a browser without
      // image clipboard support, or if the image could not be read. The
      // download link beside this button is the way through in every case.
      setState('failed');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleClick} variant="outline" className="gap-2">
          {state === 'copied' ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {state === 'copied' ? 'Image copied' : 'Copy image'}
        </Button>

        {/* A real anchor, not `<Button render={<a/>}>` — it downloads, so it
            should be a link in the accessibility tree. Same reasoning as the
            composer link in `draft-card`. */}
        <a
          href={src}
          download={filename}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-1.5')}
        >
          <Download className="size-3.5" aria-hidden="true" />
          Download
        </a>
      </div>

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
            Could not copy the image automatically — this browser may not allow images on the
            clipboard. Use Download, or drag the preview above into the {platformLabel} composer.
          </>
        ) : state === 'copied' ? (
          <>
            Image copied. Paste it into the same {platformLabel} composer as the text.
          </>
        ) : (
          <>
            A clipboard holds one thing at a time: paste the text first, then come back and copy the
            image.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Fetches the image and re-encodes it as a PNG blob.
 *
 * @param src - Same-origin image URL.
 * @returns The PNG bytes.
 * @throws {Error} When the image cannot be fetched, decoded, or encoded.
 * @sideeffect Reads the image through a canvas.
 */
async function toPngBlob(src: string): Promise<Blob> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}.`);
  }

  // Decoded off the main thread. The bytes come from our own origin, so the
  // canvas stays untainted and `toBlob()` is allowed to read it back — which is
  // the whole reason the image is proxied rather than taken from the API's URL.
  const bitmap = await createImageBitmap(await response.blob());

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('A 2D canvas is unavailable.');
  }

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))),
      'image/png',
    );
  });
}
