'use client';

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

import {
  persistTheme,
  readStoredTheme,
  readSystemDark,
  subscribeToSystemTheme,
  subscribeToTheme,
  type ResolvedTheme,
  type Theme,
} from '@/lib/theme';

/** What `useTheme` returns. The shape the app used from `next-themes`. */
interface ThemeContextValue {
  /** The visitor's choice, including `system`. */
  theme: Theme;
  /** What is actually painted — never `system`. */
  resolvedTheme: ResolvedTheme;
  /** Remembers a new choice and applies it. */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Holds the theme and keeps `<html data-theme>` in step with it.
 *
 * ## Why this is a provider at all
 *
 * The palette itself is decided in CSS (`light-dark()` against `color-scheme`),
 * and the right value is already in the HTML the server sent. What the provider
 * adds is the part React needs: a value to read (the toggle's label, the
 * toaster's palette) and a way to change it.
 *
 * ## Why `useSyncExternalStore` and not `useState`
 *
 * The choice lives in a cookie and the OS preference lives in `matchMedia`:
 * both are outside React, and both can change without React knowing.
 * `useSyncExternalStore` is the API for reading exactly that. The server
 * snapshot is the theme the root layout already read, so the first client
 * render agrees with the HTML rather than correcting it after hydration — and
 * no `setState` runs inside an effect, which is the pattern React 19's lint
 * rules flag and which this app avoids (see the note in `theme-toggle`).
 *
 * @param props - Component props.
 * @param props.children - The application tree.
 * @param props.initialTheme - The theme the root layout read from the cookie.
 * @returns The provider.
 * @sideeffect Writes the theme attribute onto <html> when the choice changes.
 */
export function ThemeProvider({
  children,
  initialTheme,
}: {
  children: React.ReactNode;
  initialTheme: Theme;
}) {
  const theme = useSyncExternalStore(subscribeToTheme, readStoredTheme, () => initialTheme);
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, readSystemDark, () => false);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;

    // `system` removes the attribute rather than naming it, because an absent
    // attribute is what leaves the media query in charge of the palette — and
    // it is what the server rendered for `system` in the first place.
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    withoutTransitions(() => persistTheme(next));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Reads the current theme.
 *
 * @returns The chosen theme, the resolved one, and the setter.
 * @throws {Error} When used outside a `ThemeProvider` — a component reaching
 *   for context that is not there is a bug to surface, not to paper over with a
 *   default. (`global-error.tsx` replaces the root layout, so it deliberately
 *   renders neither this nor anything that reads it.)
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside a ThemeProvider.');
  return value;
}

/**
 * Applies a theme change with CSS transitions suppressed.
 *
 * Without this, every element carrying a colour transition sweeps from one
 * palette to the other and the switch reads as a slow cross-fade. The rule is
 * removed on the next frame, so nothing else is affected.
 *
 * @param mutate - The change to apply while transitions are off.
 * @sideeffect Injects and removes a temporary <style> element.
 */
function withoutTransitions(mutate: () => void): void {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none !important}';
  document.head.appendChild(style);

  mutate();

  // Reading layout forces the class change to be committed while the rule is
  // still in place. Without it the browser is free to coalesce both changes
  // into one frame, in which case the transition runs anyway.
  void document.body?.offsetHeight;
  requestAnimationFrame(() => style.remove());
}
