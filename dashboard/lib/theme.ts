/**
 * Theme state: one cookie, read by both the server and the browser.
 *
 * ## Why this is hand-written rather than `next-themes`
 *
 * This app used `next-themes` through Next 15. It applies a theme by rendering a
 * `<script>` from inside a Client Component, and React 19 no longer allows a
 * script to be rendered on the client: every time the provider's subtree was
 * client-rendered (an error, a remount) React logged "Encountered a script tag
 * while rendering React component", which the Next dev overlay reports as an
 * error. There is no release with a fix, and the approach is at odds with the
 * rule rather than being a bug in one version.
 *
 * ## Why there is no pre-paint script here either
 *
 * The first replacement kept a hand-written `<script>` in the root layout and
 * only removed the library. That was not enough, and for the same reason: the
 * rule is about *rendering* a script, not about who wrote it. Any client-side
 * re-render of the root tree logs it, and an error recovery does exactly that —
 * so one API failure anywhere in the app was enough to put the warning back on
 * screen. React could have executed nothing and it would still complain.
 *
 * The fix is therefore structural: **no script element exists**. The theme is
 * known before the document is generated.
 *
 * ## Why a cookie rather than `localStorage`
 *
 * A cookie is the only storage both sides can read. The root layout reads it
 * and renders `data-theme` onto `<html>`, so the correct theme is in the HTML —
 * nothing runs before paint because nothing needs to, and the page is themed
 * with JavaScript disabled. `localStorage` could never do that: it is invisible
 * to the server, which is the entire reason the script existed.
 *
 * ## What CSS owns, and what this file owns
 *
 * The palette resolves through `light-dark()` against `color-scheme`
 * (`globals.css`), which is why "follow the system" needs no help from here.
 * This module owns the *choice*: reading it, storing it, and telling React when
 * it changes. The attribute that carries it is `system`'s opposite — an absent
 * `data-theme` means system, and only the media query can resolve that.
 *
 * ## Cost, stated plainly
 *
 * Reading a cookie in the root layout makes every route render per request
 * instead of being prerendered. For a personal dashboard served by its own Node
 * process that is not a real cost, and it buys a flash-free theme with no
 * script in the tree.
 */

/** Where the visitor's choice is stored. Read by the server and the browser. */
export const THEME_COOKIE = 'brandloop-theme';

/** One year, in seconds. A display preference should outlive a session. */
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** What the visitor chose. `system` follows the operating system. */
export type Theme = 'light' | 'dark' | 'system';

/** What is actually painted. `system` is resolved away. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Reads a stored value into a theme.
 *
 * Shared by the server (a cookie from the request) and the browser (the same
 * cookie from `document.cookie`) so the two can never disagree about what a
 * value means — a disagreement here is a hydration mismatch.
 *
 * @param value - The raw cookie value, possibly absent or junk.
 * @returns The parsed theme; `system` for anything unrecognised.
 * @sideeffect none (pure)
 */
export function parseTheme(value: string | undefined): Theme {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/**
 * Reads the visitor's stored choice from the cookie.
 *
 * @returns The stored theme, or `system` when nothing valid is stored.
 * @sideeffect none (reads a cookie)
 */
export function readStoredTheme(): Theme {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`));
  return parseTheme(match?.[1]);
}

/**
 * Whether the operating system currently asks for dark.
 *
 * Only consulted for the `system` choice, where it produces the value React
 * needs (`resolvedTheme`) and where the media query in `globals.css` has
 * already painted the right palette.
 *
 * @returns True when the visitor's OS preference is dark.
 * @sideeffect none (reads a media query)
 */
export function readSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Listeners for changes made in this tab.
 *
 * There used to be a `storage` listener too, for changes made in another tab.
 * Cookies have no equivalent event, and mirroring the value into
 * `localStorage` purely to get one back would put the choice in two places that
 * can drift. A second tab picks the change up on its next load instead.
 */
const listeners = new Set<() => void>();

/**
 * Subscribes to theme changes in this tab.
 *
 * @param listener - Called whenever the stored theme may have changed.
 * @returns An unsubscribe function, as `useSyncExternalStore` expects.
 * @sideeffect Registers a listener.
 */
export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Subscribes to the operating system's colour-scheme preference.
 *
 * Only meaningful while the visitor's choice is `system`, but cheap enough to
 * keep subscribed — a `matchMedia` change listener fires only when the OS
 * preference actually changes.
 *
 * @param listener - Called when the OS preference changes.
 * @returns An unsubscribe function, as `useSyncExternalStore` expects.
 * @sideeffect Registers a media-query listener.
 */
export function subscribeToSystemTheme(listener: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', listener);

  return () => query.removeEventListener('change', listener);
}

/**
 * Stores the visitor's choice and notifies subscribers.
 *
 * The cookie is the whole persistence story: it is what the next request will
 * render from, so a reload, a new tab, or a server render all agree with what
 * is on screen now.
 *
 * @param theme - The theme to remember.
 * @sideeffect Writes the theme cookie and notifies listeners.
 */
export function persistTheme(theme: Theme): void {
  // `samesite=lax` because nothing here is authenticated or cross-site: the
  // value only ever needs to travel with a top-level navigation to this app.
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;

  for (const listener of listeners) listener();
}
