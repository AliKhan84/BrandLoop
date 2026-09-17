'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Copy, Loader2, Unplug } from 'lucide-react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { checkDiscordLinkedAction, createLinkCodeAction } from '@/lib/actions';

/**
 * Where "Add to Discord" sends the user.
 *
 * Read from env rather than hardcoded so a different Discord application can be
 * pointed at without editing a component. See `dashboard/.env.local` for why
 * this is a User Install link and not a bot invite.
 */
const INSTALL_URL = process.env.NEXT_PUBLIC_DISCORD_INSTALL_URL ?? '';

/**
 * Discord account linking.
 *
 * ## The flow, and why it is shaped like this
 *
 *   1. The user adds the app to their Discord account. Without this the bot
 *      cannot open a DM with them and `/connect` does not exist for them.
 *   2. They ask for a code here. The API generates a six-digit one and stores
 *      it with a 15-minute expiry.
 *   3. They type `/connect <code>` into Discord.
 *   4. The bot pairs the accounts, entirely outside this app.
 *
 * Step 4 happens somewhere this page cannot observe, so there is no event to
 * listen for. The panel therefore polls until the link appears — which means
 * the user never has to come back and refresh, and the panel flipping on its
 * own is the confirmation that the thing worked.
 *
 * ## Why step 1 is in the UI and not just in the docs
 *
 * It was previously only in the setup notes, which assumed the user already had
 * a server with the bot in it. They usually do not, and the bot is in no servers
 * at all — so the install link is the first thing that has to happen and the
 * only place to say so is here. A user who skips it finds no `/connect` command
 * and has no way to tell whether that means "not installed" or "not yet
 * propagated".
 *
 * ## Why a code rather than an OAuth redirect
 *
 * The drafts are delivered by DM, so the bot needs to know which Discord
 * account belongs to which BrandLoop account. A code typed in Discord proves
 * control of the Discord side without this app ever handling Discord
 * credentials, and without asking anyone to type a password into a chat app.
 *
 * @param props - Component props.
 * @param props.initialLinked - Whether the account was already paired on load.
 * @returns The linking panel.
 * @sideeffect Issues a link code; polls the API while a code is outstanding.
 */
export function DiscordLinkPanel({ initialLinked }: { initialLinked: boolean }) {
  const [linked, setLinked] = useState(initialLinked);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Holds the interval id so it can be cleared on unmount or when the link
   * completes. Without this, navigating away mid-poll leaves a timer calling a
   * server action for a page that no longer exists.
   */
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Stops the poller if one is running.
   *
   * @returns nothing.
   * @sideeffect Clears the interval.
   */
  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Always clean up on unmount.
  useEffect(() => stopPolling, []);

  // Poll only while there is an unexpired code outstanding.
  useEffect(() => {
    if (!code || linked || !expiresAt) return;

    pollRef.current = setInterval(async () => {
      // Stop at expiry rather than polling forever for a code that can no
      // longer be redeemed.
      if (new Date() > expiresAt) {
        stopPolling();
        setCode(null);
        setExpiresAt(null);
        setError('That code expired. Generate a new one.');
        return;
      }

      const isLinked = await checkDiscordLinkedAction();
      if (isLinked) {
        stopPolling();
        setLinked(true);
        setCode(null);
        setExpiresAt(null);
        toast.success('Discord linked', { description: 'Your drafts will arrive by DM.' });
      }
    }, 4000);

    return stopPolling;
  }, [code, linked, expiresAt]);

  /**
   * Requests a fresh link code.
   *
   * @returns Resolves when the request settles.
   * @sideeffect Calls the server action and starts the poller.
   */
  async function handleGenerateCode() {
    setIsLoading(true);
    setError(null);

    const result = await createLinkCodeAction();
    setIsLoading(false);

    if (!result.ok) {
      setError(result.error);
      toast.error('Could not create a code', { description: result.error });
      return;
    }

    setCode(result.code);
    setExpiresAt(new Date(result.expiresAt));
  }

  /**
   * Copies the `/connect` command, not just the digits.
   *
   * The user is about to paste this into a chat box, so giving them the whole
   * command removes a step that is easy to get wrong.
   *
   * @returns Resolves when the copy attempt finishes.
   * @sideeffect Writes to the clipboard.
   */
  async function handleCopyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`/connect ${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy', { description: 'Type the command into Discord manually.' });
    }
  }

  if (linked) {
    return (
      <div className="border-border flex items-start gap-3 rounded-lg border p-4">
        <CheckCircle2 className="text-status-approved mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">Discord linked</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Every generated draft is sent to your DMs with Approve, Reject and Edit buttons.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <Unplug className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">Discord not linked</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Drafts are delivered by Discord DM, which is where you approve or reject them. Without a
            linked account there is nowhere to send them.
          </p>
        </div>
      </div>

      {/* Three numbered steps rather than one button, because the first step
          happens on Discord's site and the second cannot work without it. */}
      <ol className="flex flex-col gap-4">
        {/* ── Step 1 ─────────────────────────────────────────────────────── */}
        <li className="flex gap-3">
          <StepNumber>1</StepNumber>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium">Add BrandLoop to your Discord account</p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                When Discord asks, choose <span className="font-medium">Add to My Apps</span> — not
                a server. No permissions are requested.
              </p>
            </div>
            {/* An <a>, not a <Button render={<a/>}>. This navigates to an
                external URL, so it is a link and should be one in the tree.
                Base UI's Button asserts native button semantics by default and
                logged a console error for the anchor; setting
                `nativeButton={false}` would silence it while still claiming
                button semantics for a link, which is the wrong way round.
                `buttonVariants()` gives the same look with correct semantics. */}
            <a
              href={INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'outline' }), 'h-9 gap-1.5 font-semibold')}
            >
              Add to Discord
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </li>

        {/* ── Step 2 ─────────────────────────────────────────────────────── */}
        <li className="flex gap-3">
          <StepNumber>2</StepNumber>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium">Get a link code</p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Valid for 15 minutes, and single use.
              </p>
            </div>

            {code ? (
              <div className="border-border bg-muted/50 flex w-full items-center justify-between gap-3 rounded-md border px-4 py-3">
                <code className="font-mono text-2xl font-semibold tracking-[0.2em] tabular-nums">
                  {code}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopyCode} className="gap-1.5">
                  <Copy className="size-3.5" aria-hidden="true" />
                  {copied ? 'Copied' : 'Copy command'}
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleGenerateCode}
                disabled={isLoading}
                className="h-10 gap-2 font-semibold"
              >
                {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {isLoading ? 'Creating code…' : 'Get a link code'}
              </Button>
            )}
          </div>
        </li>

        {/* ── Step 3 ─────────────────────────────────────────────────────── */}
        <li className="flex gap-3">
          <StepNumber>3</StepNumber>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="text-sm font-medium">Open the BrandLoop DM and send the code</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Send{' '}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                {code ? `/connect ${code}` : '/connect <code>'}
              </code>{' '}
              <span className="font-medium">in a direct message with BrandLoop</span> — not a
              server channel. Drafts are delivered by DM, so the DM is the context this command is
              built for.
            </p>
            {/* The DM has no obvious entry point until it exists, so the ways
                to find it are spelled out rather than left to be guessed. */}
            <p className="text-muted-foreground text-sm leading-relaxed">
              <span className="font-medium">Can&apos;t find the DM?</span> It appears in your
              Direct Messages list on the left once step 1 is done. If it is not there:
            </p>
            <ul className="text-muted-foreground flex flex-col gap-1 text-sm leading-relaxed">
              <li className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>
                  Press{' '}
                  <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-xs">Ctrl</kbd>{' '}
                  <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-xs">R</kbd> to
                  refresh Discord — the list is often stale right after installing.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>
                  Press{' '}
                  <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-xs">Ctrl</kbd>{' '}
                  <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-xs">K</kbd> and
                  type <span className="font-medium">BrandLoop</span> to jump straight to it.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>
                  If it is still missing, step 1 did not complete. Run it again and make sure you
                  pick <span className="font-medium">Add to My Apps</span>.
                </span>
              </li>
            </ul>
          </div>
        </li>
      </ol>

      {code && (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Waiting for you to link in Discord… this panel updates on its own.
        </p>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The step marker.
 *
 * A plain span rather than an `<li>` marker so the number sits in its own
 * column and the step's content — heading, help text, and sometimes a button —
 * shares one left edge across all three steps.
 *
 * @param props - Component props.
 * @param props.children - The step number.
 * @returns The circle.
 */
function StepNumber({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="border-border text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
