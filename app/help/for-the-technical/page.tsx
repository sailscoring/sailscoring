import type { Metadata } from 'next';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';

import { HelpShell } from '../shell';
import { Section } from '../ui';

export const metadata: Metadata = {
  title: 'For the technical — Help — Sail Scoring',
};

export const dynamic = 'force-dynamic';

export default async function Page() {
  const features = await getEffectiveFeatures();
  return (
    <HelpShell slug="for-the-technical" features={features}>
      <Section id="rest-api" title="The REST API">
        <p>
          Everything the app does goes through a public REST API under{' '}
          <code className="text-foreground text-sm">/api/v1</code> — series, competitors,
          races, results, standings, and publishing. Requests authenticate with an API key
          sent as a bearer token, and writes accept an{' '}
          <code className="text-foreground text-sm">Idempotency-Key</code> header so a
          retried request is applied once.
        </p>
        <p>
          The API is how clubs automate the repetitive parts — bulk-importing a season,
          publishing from a script, pulling results into a club website. If you’d like an
          API key for your workspace, get in touch at{' '}
          <a href="mailto:mark@hyc.ie" className="underline">mark@hyc.ie</a>.
        </p>
      </Section>
      <Section id="cli" title="The sailscoring CLI">
        <p>
          The <code className="text-foreground text-sm">sailscoring</code> command-line tool
          is a first-party client of the same API: import and export series, publish
          results, and read standings from the terminal — no database access, nothing the
          app itself couldn’t do. It’s the right tool for scripted season automation, such
          as re-importing a weekly export from another system.
        </p>
        <p>
          The CLI ships with the application source, which is MIT-licensed. Ask at{' '}
          <a href="mailto:mark@hyc.ie" className="underline">mark@hyc.ie</a> and we’ll set
          you up with a key and the tool.
        </p>
      </Section>
    </HelpShell>
  );
}
