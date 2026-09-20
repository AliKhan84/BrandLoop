import Image from 'next/image';

import { cn } from '@/lib/utils';

/** Intrinsic size of `public/BrandLoop-logo.png`. Square. */
const LOGO_INTRINSIC_SIZE = 1254;

/**
 * The BrandLoop logo.
 *
 * ## About the asset, and why it is drawn as a tile
 *
 * `public/BrandLoop-logo.png` is RGB with **no alpha channel** — its background
 * is opaque white — and the wordmark is part of the image. That works as an app
 * icon and fails as a floating mark: on the dark sidebar an unclipped white
 * square reads as a rendering mistake rather than a logo. So it is rounded into
 * a tile with a hairline edge, which sits deliberately on either theme.
 *
 * Two consequences, both handled at the call sites rather than here:
 *
 *   • The wordmark inside the image is small at UI sizes, so every placement
 *     keeps a readable "BrandLoop" label beside it instead of relying on the
 *     image alone.
 *   • Because that label carries the name, this component's alt text is empty.
 *     A screen reader would otherwise announce the product twice.
 *
 * @param props - Component props.
 * @param props.className - Sizing classes, e.g. `size-8`.
 * @param props.priority - Preload the image. True above the fold — the sidebar
 *   and the auth screens — false anywhere else.
 * @returns The logo tile.
 * @sideeffect none
 */
export function BrandLogo({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/BrandLoop-logo.png"
      alt=""
      width={LOGO_INTRINSIC_SIZE}
      height={LOGO_INTRINSIC_SIZE}
      priority={priority}
      className={cn(
        // The radius is what turns the opaque white background into a
        // deliberate tile; the ring gives that tile an edge in light mode,
        // where white on near-white would otherwise have none.
        'rounded-md ring-1 ring-black/5 select-none dark:ring-white/10',
        className,
      )}
    />
  );
}
