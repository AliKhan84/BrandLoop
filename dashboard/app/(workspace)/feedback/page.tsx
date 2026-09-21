import { FeedbackForm } from '@/components/feedback-form';

export const metadata = { title: 'Feedback · BrandLoop' };

/**
 * Feedback — where a user tells us what to build next.
 *
 * Deliberately inside the workspace rather than a marketing form: the people
 * worth hearing from are the ones already using the product, and asking them to
 * leave it to answer a survey loses most of them.
 *
 * @returns The feedback screen.
 * @sideeffect none (the form posts an action)
 */
export default function FeedbackPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Feedback</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          What is working, what is not, and what would make this more useful. Bug reports are the
          most valuable, and the most likely to be fixed.
        </p>
      </header>

      <FeedbackForm page="/feedback" />
    </div>
  );
}
