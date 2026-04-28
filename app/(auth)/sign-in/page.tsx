import { Suspense } from 'react';

import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
