/**
 * Persistent in-app notice for stealth-beta self-service users.
 *
 * "Self-service" is detected per-user as `memberships.length === 1`: the
 * only workspace they belong to is the personal one auto-created at
 * sign-up by `lib/auth.ts`. Trial users (added to a club workspace via
 * `scripts/provision-org.ts add-member`) always have ≥2 memberships and
 * never see the banner. The same predicate will gate the future
 * delete-and-email policy (#121).
 */
export function StealthBetaBanner() {
  return (
    <div
      data-testid="stealth-beta-banner"
      className="border-b bg-muted/40 px-6 py-2 text-xs text-muted-foreground"
    >
      Stealth beta — your data may be deleted after a couple of weeks.
      Feedback:{' '}
      <a href="mailto:mark@hyc.ie" className="underline">
        mark@hyc.ie
      </a>
    </div>
  );
}
