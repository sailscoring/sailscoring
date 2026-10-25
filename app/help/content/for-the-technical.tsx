'use client';

import { Section } from '../ui';

/** The “For the technical” chapter — rendered by the /help/for-the-technical route and,
 *  loaded on demand, by the help panel. */
export default function ForTheTechnical() {
  return (
    <>
      <Section id="rest-api" title="The REST API">
        <p>
          Sail Scoring’s public API, under{' '}
          <code className="text-foreground text-sm">/api/public/v1</code>, has two parts. The
          published results need no sign-in: standings, race results, entry lists and schedules,
          as the published pages show them, for a club website or a clubhouse screen. Beside them,
          a preview, an app can act in a workspace for someone who has connected it: read the
          series, set up races, starts and courses, and publish. Those calls take an OAuth access
          token the app gets when its user connects it (see{' '}
          <a href="/help/collaboration#connected-apps" className="underline">Connecting an app</a>).
        </p>
        <p>
          The API is described in OpenAPI at{' '}
          <code className="text-foreground text-sm">/api/public/v1/openapi.json</code>, and in{' '}
          <code className="text-foreground text-sm">docs/public-api.md</code> with the application
          source. Within version 1 it changes only by adding. To register an app, get in touch at{' '}
          <a href="mailto:mark@hyc.ie" className="underline">mark@hyc.ie</a>.
        </p>
      </Section>
      <Section id="cli" title="The sailscoring CLI">
        <p>
          The <code className="text-foreground text-sm">sailscoring</code> command-line tool imports
          and exports series, publishes results, and reads standings from the terminal: no
          database access, nothing the app itself couldn’t do. It’s the right tool for scripted
          season automation, such as re-importing a weekly export from another system.
        </p>
        <p>
          <code className="text-foreground text-sm">sailscoring auth login</code> signs it in as
          you: it prints a page and a code, you approve the code in your browser, and the tool
          then works in every workspace you belong to. It appears under Connected apps on your
          account page, where you can sign it out. Automation with nobody there to approve a code
          uses an API key instead; ask at{' '}
          <a href="mailto:mark@hyc.ie" className="underline">mark@hyc.ie</a>. The CLI ships with
          the application source, which is MIT-licensed.
        </p>
      </Section>
    </>
  );
}
