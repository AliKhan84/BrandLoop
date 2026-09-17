import type { Metadata } from 'next';

import { AuthForm } from '@/components/auth-form';
import { signUpAction } from '@/lib/actions';

export const metadata: Metadata = {
  title: 'Create account · BrandLoop',
};

/**
 * Sign-up route.
 *
 * Deliberately asks only for name, email and password. Niche and input points
 * are collected on the settings screen immediately afterwards, because asking
 * for them here would make the form long enough that people abandon it — and
 * the settings screen can explain *why* they matter, which a signup field
 * cannot.
 *
 * @returns The sign-up screen.
 * @sideeffect none
 */
export default function SignUpPage() {
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground text-sm">
          Takes a moment. You will set your niche next.
        </p>
      </header>

      <AuthForm mode="signup" action={signUpAction} submitLabel="Create account" />
    </>
  );
}
