'use client';

/**
 * Root error boundary.
 *
 * ## Why this file has to be completely self-contained
 *
 * `global-error.tsx` **replaces the root layout** when an error escapes it. That
 * means none of the app's context is available here: no ThemeProvider, no
 * Toaster, and no assumption that `globals.css` has loaded. Rendering anything
 * that reads context from this file is what breaks the build — Next prerenders
 * this route, and a client component reaching for `useContext` outside a
 * provider tree throws before the page can be generated.
 *
 * So this renders its own `<html>` and `<body>`, and styles itself with inline
 * values rather than design tokens. It is the one screen in the product that
 * cannot depend on the design system, because the design system may be exactly
 * what failed.
 *
 * Its job is narrow: say what happened in plain language, and give the user a
 * way to try again.
 *
 * @param props - Component props.
 * @param props.error - The error that escaped the root layout.
 * @param props.reset - Re-renders the tree, retrying the failed render.
 * @returns A standalone error document.
 * @sideeffect Logs the error to the console.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#fdfcfa',
          color: '#2b2823',
        }}
      >
        <div style={{ maxWidth: '32rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>
            BrandLoop could not start this screen
          </h1>

          <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6, color: '#5c5851' }}>
            Something failed before the page finished loading. Trying again is safe — nothing was
            changed, and no posts were generated.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.25rem' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                height: '2.5rem',
                padding: '0 1rem',
                borderRadius: '0.375rem',
                border: 'none',
                background: '#c8811f',
                color: '#1f1c18',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>

            {/* A plain anchor, not next/link, and deliberately so.
                globals.css is imported by the root layout — which this file
                REPLACES. Hard-coding the palette here is the only way to be
                sure the styles survive whatever took the layout down. A full
                page load is also the right recovery from a root-level failure,
                since the client router cannot be trusted at that point. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                height: '2.5rem',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 1rem',
                borderRadius: '0.375rem',
                border: '1px solid #ddd8d0',
                color: '#2b2823',
                fontSize: '0.9rem',
                textDecoration: 'none',
              }}
            >
              Go to the workspace
            </a>
          </div>

          {process.env.NODE_ENV === 'development' && (
            <pre
              style={{
                marginTop: '0.5rem',
                padding: '0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #ddd8d0',
                background: '#f5f2ee',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#5c5851',
              }}
            >
              {error.message}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
