import { notFound } from 'next/navigation';

import { AdminFeedbackPanel } from '@/components/admin-feedback-panel';
import { ApiError, getMe, listFeedback } from '@/lib/api';
import { getSessionToken } from '@/lib/session';

/**
 * Admin — the feedback inbox.
 *
 * Same shape as the coupon page: the API refuses a non-admin regardless, and
 * this check exists so a signed-in non-admin who guesses the URL sees a 404
 * rather than a page of failed requests.
 *
 * @returns The inbox.
 * @sideeffect Reads the session and the message list.
 */
export default async function AdminFeedbackPage() {
  const token = await getSessionToken();
  if (!token) notFound();

  let user;
  try {
    user = await getMe(token);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) notFound();
    throw err;
  }

  if (user.role !== 'admin') notFound();

  const messages = await listFeedback(token);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Feedback inbox</h1>
        <p className="text-muted-foreground text-sm">
          Newest first. Marking a message read is what tells the next reader it has been seen — the
          note is for what came of it.
        </p>
      </header>

      <AdminFeedbackPanel messages={messages} />
    </div>
  );
}
