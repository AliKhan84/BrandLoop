import { redirect } from 'next/navigation';

import { DiscordLinkPanel } from '@/components/discord-link-panel';
import { ProfileForm } from '@/components/profile-form';
import { QuotaMeter } from '@/components/quota-meter';
import { ApiError, getMe, getUsage } from '@/lib/api';
import { getSessionToken } from '@/lib/session';
import type { User, UsageSummary } from '@/lib/types';

export const metadata = { title: 'Settings · BrandLoop' };

/**
 * Settings.
 *
 * ## Ordering, and why
 *
 * Discord linking sits above the profile form, not below it. It is the one
 * thing on this page that is *blocking* — without it, generated drafts have
 * nowhere to go and the product does not work at all. The profile fields
 * improve output quality; this one gates delivery.
 *
 * Each section states its consequence in a sentence rather than just labelling
 * itself, because every field here changes what the generator produces and a
 * bare "Niche" label does not communicate that.
 *
 * @returns The settings screen.
 * @sideeffect Makes two API calls.
 */
export default async function SettingsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let user: User;
  try {
    user = await getMe(token);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) redirect('/login');
    throw err;
  }

  const usage: UsageSummary | null = await getUsage(token).catch(() => null);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Everything here changes what BrandLoop writes for you.
        </p>
      </header>

      <section aria-labelledby="discord-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="discord-heading" className="text-sm font-semibold tracking-tight">
            Discord
          </h2>
          <p className="text-muted-foreground text-sm">
            Where drafts are delivered and approved.
          </p>
        </div>
        <DiscordLinkPanel initialLinked={user.discordLinked} />
      </section>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="profile-heading" className="text-sm font-semibold tracking-tight">
            Profile
          </h2>
          <p className="text-muted-foreground text-sm">
            The niche and the points of view every post is written from.
          </p>
        </div>
        <ProfileForm user={user} />
      </section>

      {usage && (
        <section aria-labelledby="usage-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="usage-heading" className="text-sm font-semibold tracking-tight">
              Daily allowance
            </h2>
            <p className="text-muted-foreground text-sm">
              Generation runs on a free tier with a hard daily ceiling. This is what is left.
            </p>
          </div>
          <div className="border-border rounded-lg border p-4">
            <QuotaMeter usage={usage} variant="inline" />
          </div>
        </section>
      )}

      <section aria-labelledby="account-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="account-heading" className="text-sm font-semibold tracking-tight">
            Account
          </h2>
        </div>
        <dl className="border-border divide-border flex flex-col divide-y rounded-lg border text-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Platforms</dt>
            <dd className="font-medium">
              {user.platforms.map((p) => (p === 'x' ? 'X' : 'LinkedIn')).join(' · ')}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
