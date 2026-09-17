import type { Metadata } from 'next';
import { Geist, Geist_Mono, Source_Serif_4 } from 'next/font/google';

import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
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
 * @param props - Standard layout props.
 * @param props.children - The active route.
 * @returns The HTML document.
 * @sideeffect none
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // `suppressHydrationWarning` because next-themes writes the theme class onto
    // <html> before React hydrates. That is intentional and not a mismatch.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable}`}
    >
      <body className="bg-background text-foreground min-h-full antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          {/* Mounted at the root so any route can raise a toast without
              rendering its own container. */}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
