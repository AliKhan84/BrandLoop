'use client';

import { LogOut, User as UserIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/lib/actions';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/types';

/**
 * Account menu.
 *
 * ## Why sign-out lives in a form
 *
 * Signing out is a state-changing action, so it is a POST through a server
 * action rather than a link. A plain `<Link>` would make it a GET, which means
 * any page that embeds the URL could sign the user out — the classic
 * logout-CSRF. The `form` wrapper is invisible and costs nothing.
 *
 * ## Why there are two variants
 *
 * The trigger was `w-full` everywhere, which is correct in the sidebar where it
 * should fill its column — and wrong in the mobile top bar, where it sits in a
 * row beside the theme toggle. There it measured 231px inside a 320px viewport
 * and pushed the whole page to 395px wide, giving every mobile screen a
 * horizontal scrollbar.
 *
 * `compact` is not a width patch; it is the right content for the context. A
 * 320px header has no room for a name and an email, and the avatar alone
 * identifies the account at that size. The full identity stays in the
 * dropdown, where there is space to read it.
 *
 * @param props - Component props.
 * @param props.user - The signed-in user.
 * @param props.compact - Avatar only, content-sized. For the mobile top bar.
 * @returns The account menu.
 * @sideeffect none until an item is chosen
 */
export function UserMenu({ user, compact = false }: { user: User; compact?: boolean }) {
  const initial = (user.name?.trim() || user.email).charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={cn(
              // `px-3` to match the nav items above it. At `px-2` the avatar sat
              // four pixels left of every nav icon, which reads as a misaligned
              // row rather than a deliberate grouping.
              'h-auto gap-3 px-3 py-2',
              // `w-full` only where there is a full-width column to fill.
              compact ? 'w-auto' : 'w-full justify-start',
            )}
            aria-label={compact ? 'Account menu' : undefined}
          />
        }
      >
        <span
          // `leading-none` because the line box otherwise pushes the initial up
          // by a pixel or two inside a circle this small.
          className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm leading-none font-semibold"
          aria-hidden="true"
        >
          {initial}
        </span>

        {!compact && (
          <span className="flex min-w-0 flex-col items-start">
            <span className="max-w-[9rem] truncate text-sm font-medium">
              {user.name?.trim() || 'Your account'}
            </span>
            <span className="text-muted-foreground max-w-[9rem] truncate text-xs">{user.email}</span>
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side={compact ? 'bottom' : 'top'} className="w-56">
        {/* The full identity, which the compact trigger does not have room for. */}
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{user.name?.trim() || 'Your account'}</span>
          <span className="text-muted-foreground text-xs font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {user.discordLinked ? 'Discord linked' : 'Discord not linked'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href="/settings" />}>
          <UserIcon className="size-4" aria-hidden="true" />
          Profile settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem
            // `MenuItem` already defaults `nativeButton` to false, and the
            // element below is a real submit button, so no override is needed
            // here — unlike Base UI's `Button`, which defaults it to true and
            // complains when handed an anchor.
            render={<button type="submit" className="w-full" />}
            variant="destructive"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
