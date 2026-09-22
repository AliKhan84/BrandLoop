import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Geist, Geist_Mono, Source_Serif_4 } from 'next/font/google';

import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

/**
 * Root layout.
 *
 * ## Typography
 *
 * Two families, each with a job:
 *
 *   • **Geist Sans** for all interface chrome. It ships with Next, so there is
 *     no network fetch at build time and no layout shift on first paint.
 *   • **Source Serif 4** for generated post drafts only. The drafts are prose
 *     meant to be read the way a reader on X or LinkedIn will read them, so
 *     they get a reading face while every control stays sans. That is the line
 *     between the interface and the thing the interface produced.
 *
 * Both are exposed as CSS variables and consumed through `--font-sans` and
 * `--font-serif` in `globals.css`, so no component names a font directly.
 */

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const sourceSerif = Source_Serif_4({
  variable: '--font-source-serif',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'BrandLoop',
  description: 'Turn your expertise into a consistent presence on X and LinkedIn.',
};

/**
 * Renders the application's outermost shell.
 *
 * ## The theme is decided here, before any of it is sent
 *
 * The visitor's choice is a cookie, so the server can put `data-theme` on
 * `<html>` in the HTML itself. Nothing has to run before the first paint, which
 * is what removed the last inline `<script>` from this app: React 19 logs an
 * error whenever it client-renders one, and an error recovery re-renders the
 * whole root tree (see `lib/theme.ts` for the full account).
 *
 * `system` renders no attribute at all. That leaves `color-scheme: light dark`
 * in charge, and `globals.css` resolves the palette from the media query —
 * the one input no server can know.
 *
 * The cost is that reading a cookie makes every route render per request
 * instead of being prerendered. That is a fair trade here: this dashboard is
 * served by its own Node process, and what it buys is a theme that is correct
 * in the first byte, with or without JavaScript.
 *
 * @param props - Standard layout props.
 * @param props.children - The active route.
 * @returns The HTML document.
 * @sideeffect Reads the theme cookie.
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    // `suppressHydrationWarning` is not about the theme — that is server
    // rendered and agrees with the client. It is for browser extensions, which
    // rewrite `<html>` (a forced-dark mode is the usual one) before React
    // hydrates, and which React would otherwise report as a mismatch on every
    // page.
    <html
      lang="en"
      suppressHydrationWarning
      data-theme={theme === 'system' ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable}`}
    >
      {/*
        `suppressHydrationWarning` is on `<body>` for the same reason it is on
        `<html>`: browser extensions rewrite this element before React hydrates.
        Grammarly adds `data-new-gr-c-s-check-loaded` and `data-gr-ext-installed`,
        which React then reports as a mismatch it cannot patch — pointing at our
        markup for something we did not write. The attribute is inherited by
        nothing and hides no real mismatch, because nothing in this tree renders
        an attribute on `body` at all.
      */}
      <body className="bg-background text-foreground min-h-full antialiased" suppressHydrationWarning>
        <ThemeProvider initialTheme={theme}>
          {children}
          {/* Mounted at the root so any route can raise a toast without
              rendering its own container. */}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
