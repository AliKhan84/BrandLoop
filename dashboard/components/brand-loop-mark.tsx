/**
 * BrandLoop's mark.
 *
 * A broken ring: two arcs with gaps at opposite corners, so the shape reads as
 * a cycle that continues rather than a closed circuit. That is the product —
 * plan, draft, approve, publish, repeat — and it is drawable in two strokes,
 * which means it stays legible at 16px in a sidebar.
 *
 * Drawn with `currentColor` for the ring and the accent for the leading arc, so
 * it inherits whatever surface it sits on instead of needing a variant per
 * context.
 *
 * @param props - Component props.
 * @param props.className - Sizing and spacing classes.
 * @returns The mark.
 * @sideeffect none
 */
export function BrandLoopMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      // Decorative: the wordmark beside it already names the product, so
      // announcing the shape again would just add noise for a screen reader.
      aria-hidden="true"
      focusable="false"
    >
      {/* Leading arc in the accent — the part of the loop that is in motion. */}
      <path
        d="M12 3a9 9 0 0 1 8.5 6"
        stroke="var(--primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Trailing arc in the inherited colour. */}
      <path
        d="M20 15a9 9 0 0 1-15.5 3.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.35"
      />
      {/* The second gap closes the cycle visually without closing the ring. */}
      <path
        d="M3 12a9 9 0 0 1 2.5-6.2"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  );
}
