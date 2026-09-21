'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreditCard, FileText, LayoutGrid, Settings, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/types';

/**
 * The navigation model, defined once.
 *
 * Both the desktop sidebar and the mobile bottom bar render from this list, so
 * adding a route cannot leave one of them behind. The icons are chosen for
 * meaning rather than decoration: a grid for the workspace where things are
 * produced, a page for the drafts they produced, a gear for configuration.
 */
const NAV_ITEMS = [
  { href: '/workspace', label: 'Workspace', icon: LayoutGrid },
  { href: '/drafts', label: 'Drafts', icon: FileText },
  { href: '/billing', label: 'Billing', icon: CreditCard },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/**
 * The item only an administrator sees.
 *
 * Kept out of `NAV_ITEMS` because it is conditional. The API refuses these
 * routes to a non-admin regardless — this only avoids showing a door that will
 * not open.
 */
const ADMIN_ITEM = { href: '/admin/coupons', label: 'Admin', icon: ShieldCheck } as const;

/**
 * The nav list for a role.
 *
 * @param role - The signed-in user's role.
 * @returns The nav items, including the admin entry when it applies.
 * @sideeffect none (pure)
 */
function navItemsFor(role: UserRole) {
  return role === 'admin' ? [...NAV_ITEMS, ADMIN_ITEM] : [...NAV_ITEMS];
}

/**
 * Reports whether a nav item is the active one.
 *
 * Uses a prefix match so `/plans/abc123` still highlights "Workspace" — a
 * nested route that belongs to a section should not leave the rail with nothing
 * selected.
 *
 * @param pathname - The current path.
 * @param href - The nav item's target.
 * @returns True when the item should render as current.
 * @sideeffect none (pure)
 */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Desktop sidebar navigation.
 *
 * A vertical list with a filled active state. The active item is marked with
 * `aria-current="page"` as well as colour — colour alone would leave the
 * current section invisible to anyone who cannot distinguish the tint.
 *
 * @returns The nav list.
 * @sideeffect none
 */
export function SidebarNav({ role }: { role: UserRole }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {navItemsFor(role).map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Mobile bottom navigation.
 *
 * Placed at the bottom rather than the top because the lower quarter of a phone
 * screen is what a thumb reaches without adjusting grip. The row is four items
 * across the full width, which still clears the 44px minimum touch target — at
 * 320px each item is 80px wide — and the labels are short enough not to wrap.
 *
 * @returns The bottom bar.
 * @sideeffect none
 */
export function BottomNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = navItemsFor(role);

  return (
    <nav
      aria-label="Main"
      className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur lg:hidden"
      // Clears the home indicator on notched devices, so the last row is not
      // sitting underneath it.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* The column count is derived from the list rather than hardcoded. It was
          `grid-cols-4`, which silently broke the row the moment a fifth item
          existed — the admin entry. Tailwind cannot build a class name at run
          time, so the count is set inline. */}
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
