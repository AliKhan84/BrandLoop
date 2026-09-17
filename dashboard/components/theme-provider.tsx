'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Theme provider.
 *
 * Must be a Client Component because it holds theme state and writes the
 * `class` attribute on <html>. Wrapping the tree once in the root layout means
 * no individual screen has to think about it.
 *
 * The design system defines a full dark palette in `globals.css`, so this is
 * what makes it reachable rather than dead CSS.
 *
 * @param props - Provider props, forwarded to next-themes.
 * @param props.children - The application tree.
 * @returns The wrapped tree.
 * @sideeffect Writes a theme class onto <html>.
 */
export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
