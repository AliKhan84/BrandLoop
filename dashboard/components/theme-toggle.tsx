'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';

/**
 * Light/dark toggle.
 *
 * ## Why there is no `mounted` state here
 *
 * The usual pattern for a theme toggle is a `mounted` flag set in an effect,
 * because the server does not know which theme the visitor prefers and
 * rendering a resolved icon during SSR causes a hydration mismatch.
 *
 * That pattern calls `setState` inside an effect, which React 19's lint rules
 * correctly flag: it causes a cascading render on every mount. It is also
 * unnecessary. Both icons can be rendered at all times and let CSS decide which
 * one is visible, using the same `.dark` class that next-themes writes onto
 * `<html>` before hydration. No state, no effect, no mismatch — the correct
 * icon is simply painted.
 *
 * ## Why the label does not name a destination
 *
 * The label has to read the same on the server and the client, or it becomes
 * the very hydration mismatch this avoids. "Toggle theme" is accurate in both
 * directions, so it stays stable.
 *
 * @returns The toggle button.
 * @sideeffect Changes the theme class on <html> when pressed.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {/* Both are rendered; exactly one is ever visible. */}
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
      <Moon className="size-4 dark:hidden" aria-hidden="true" />
    </Button>
  );
}
