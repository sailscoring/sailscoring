/**
 * Persistent in-app notice for self-service users working alone in their
 * personal workspace: it invites feedback and points clubs and class
 * associations at the shared-workspace request flow on the account page.
 *
 * "Self-service" is detected per-user as `memberships.length === 1`: the
 * only workspace they belong to is the personal one auto-created at
 * sign-up by `lib/auth.ts`. Users on a club workspace (added via
 * invitation or `scripts/provision-org.ts add-member`) always have ≥2
 * memberships and never see the banner.
 */
export function PersonalWorkspaceBanner() {
  return (
    <div
      data-testid="personal-workspace-banner"
      className="border-b bg-muted/40 px-6 py-2 text-xs text-muted-foreground"
    >
      You&apos;re in your personal workspace. Scoring for a club or class?
      Request a shared workspace from{' '}
      <a href="/account" className="underline">
        your account page
      </a>
      . Feedback:{' '}
      <a href="mailto:mark@hyc.ie" className="underline">
        mark@hyc.ie
      </a>
    </div>
  );
}
