/** Shown when a consent page is reached for an app that isn't registered,
 *  or has been switched off. */
export function UnknownApp() {
  return (
    <section className="max-w-md mx-auto mt-8 bg-card border rounded-lg p-6" data-testid="oauth-unknown-app">
      <h1 className="text-2xl font-semibold mb-1">App not recognised</h1>
      <p className="text-sm text-muted-foreground">
        The app that sent you here isn&apos;t one Sail Scoring knows, or it has been switched off.
        Nothing has been shared with it. If you expected this to work, contact{' '}
        <a href="mailto:mark@hyc.ie" className="underline">mark@hyc.ie</a>.
      </p>
    </section>
  );
}
