'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A value with a button that copies it.
 *
 * ## Why this exists rather than reusing `copy-and-open`
 *
 * That component copies text and then opens a URL — the right shape for a
 * composer link, and the wrong one for an account number, where opening anything
 * would be a surprise. A customer reading a 24-character IBAN off the screen and
 * retyping it into a bank app is exactly the failure this prevents.
 *
 * ## Why the confirmation is on the button
 *
 * The clipboard write is asynchronous and can be refused by the browser. Showing
 * "Copied" unconditionally would be a lie in that case, so the label only changes
 * after the promise resolves — and the value stays on screen either way, so a
 * refusal leaves the customer no worse off than before they pressed it.
 *
 * @param props - Component props.
 * @param props.label - What the value is, e.g. "Account number".
 * @param props.value - The text to copy and display.
 * @param props.detail - Optional second line, e.g. the bank and holder.
 * @returns The copy row.
 * @sideeffect Writes to the clipboard.
 */
export function CopyValue({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Back to the resting label, so a second copy is obviously still available.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
        <span className="font-mono text-sm break-all tabular-nums">{value}</span>
        {detail && <span className="text-muted-foreground text-xs">{detail}</span>}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        // The label is the confirmation, so a screen reader hears the change too.
        aria-live="polite"
      >
        {copied ? (
          <>
            <Check className="size-4 text-status-approved" aria-hidden="true" />
            Copied
          </>
        ) : (
          <>
            <Copy className="size-4" aria-hidden="true" />
            Copy
          </>
        )}
      </Button>
    </div>
  );
}

export default CopyValue;
