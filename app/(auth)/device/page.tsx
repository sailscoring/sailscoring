import { redirect } from 'next/navigation';

import { getOptionalSession } from '@/lib/auth/require-session';
import { DeviceApproval } from './device-approval';

export const dynamic = 'force-dynamic';

/**
 * Where `sailscoring auth login` sends its user (ADR-016): the CLI prints
 * this page's address and a code, and approving the code here signs the CLI
 * in as the person approving.
 */
export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const { user_code: userCode } = await searchParams;
  const session = await getOptionalSession();
  if (!session) {
    const back = `/device${userCode ? `?user_code=${encodeURIComponent(userCode)}` : ''}`;
    redirect(`/sign-in?callbackURL=${encodeURIComponent(back)}`);
  }
  return <DeviceApproval initialCode={userCode ?? ''} email={session.user.email} />;
}
