# Sail Scoring: Sustainability

*Working note — 2026-05-26. Organises my current thinking; not a commitment.
Several of the choices below (open-source vs. commercial, the funding model,
who operates the service) are deliberately deferred — see
[goals.md](goals.md#establish-a-sustainable-project-model).*

It is early in the project to be worrying about this. But a potential adopter
— a club, a class association, a national governing body — will ask the
question almost immediately, and they are right to. If they adopt Sail
Scoring, train their scorers on it, switch their workflows to it, and score
events with it, they are making an investment. Two questions follow:

**(a)** Will they be able to keep scoring events with this tool and this
workflow for the next 10–20 years or more?

**(b)** Will their data — the series held in the app, and the results
published from it — still be available over that same horizon?

This document is about both.

## The Sailwave benchmark

Sailwave is the bar. It has been extraordinarily sustainable, especially for a
free tool, and that sustainability is precisely why scorers will be reluctant
to switch away from it. Any credible alternative has to be zero- or
near-zero-cost to the user. A small fee is not a minor friction; against a free
incumbent it is a real barrier to adoption.

It is worth being honest about *why* Sailwave is so cheap to sustain. Its low
cost is structural, not generous. Sailwave is a Windows desktop application: it
runs on the scorer's own machine, its data lives in local files on that
machine, and there is no server anywhere that has to be paid for and kept
running for the tool to keep working. A copy installed today will still open
and still score in ten years whether or not anyone is maintaining it, because
nothing about it depends on a live service.

A web-based tool cannot inherit that property for free. There are unavoidable
infrastructure costs — compute, a database, storage, a domain — and they recur
for as long as the service is up.

That cost buys something real, and Sail Scoring is web-based by deliberate
choice, not reluctance. A web service does what Sailwave structurally cannot:
it works on any device with a browser with nothing to install, not just one
Windows laptop; a panel of scorers can work on the same series and see the same
current state instead of passing files around; the data lives on a server of
record rather than trapped on a machine that can be lost or replaced; and
results publish live. These are the benefits that lower the barrier for new
volunteers — which is the whole point of the project. The recurring cost is the
price of them.

This is the central tension: to be a credible
alternative to Sailwave, Sail Scoring needs to be zero-cost to users; but
unlike Sailwave it has running costs that someone must cover. "No funding" and
"a fee" are both barriers. The rest of this document is about finding the path
between them.

## Be transparent about the infrastructure costs

The first move is transparency. Before discussing who pays, I want to be able
to say *exactly* what it costs to run the service today, and how that projects
as adoption grows.

When I say infrastructure costs, I mean the recurring cost of running the
service — and **only** that. It explicitly does **not** include my time, for
development or for maintenance, and it does not include the substantial cost of
the AI-assistant subscriptions I develop with. Those are dealt with separately
below.

### Current costs

*Basis: current monthly charges × 12, expressed in EUR. The two services that
bill in USD and currently cost anything (S3 now; Neon and Resend once they leave
their free tiers) are converted at $1 ≈ €0.92 (mid-2026). These are run-rate
figures, not trailing 12-month spend.*

| Component | What it's for | Annual cost |
|-----------|---------------|-------------|
| `sailscoring.ie` domain | All public URLs; renews annually ([ADR-005](design/decisions/005-hosting-and-domains.md)) | **€47** |
| Vercel (Pro) | Compute + bandwidth; Pro tier required for the private repo | **€295** (€24.60/mo inc. VAT) |
| Neon Postgres | Server-of-record for all series data | **€0** — within the free plan |
| Vercel Blob | Published-results HTML storage | **€0** — within the Pro allowance |
| Resend | Magic-link sign-in + transactional email | **€0** — within the free plan |
| scupper (FTP relay) | Optional upload to a club's own web host | **€0** — runs on the existing Vercel compute |
| S3 backup storage | Out-of-Neon backups ([database-backup.md](database-backup.md)) | ~€0.12 — rounding error |
| **Total** | | **≈ €342/yr** |

Two things this table makes plain. First, the **total is small and almost
entirely fixed**: the domain (€47) and the Vercel Pro base (€295) are ~99% of it,
and neither moves with how much scoring happens. Second, **every usage-based
service is still well inside its free allowance**:

- **Neon** is at 11 of 100 free CU-hrs/month and 0.07 of 0.5 GB storage — roughly
  9× current usage before the free tier runs out (compute is the binding
  constraint), at which point [Launch pricing](#projecting-to-scale-and-amortizing-across-users)
  applies ($0.106/CU-hr, $0.35/GB-month).
- **Resend** has sent under 100 emails in the past month against a 3,000/month
  free ceiling (100/day) — ~30× headroom before the $20/mo Pro plan is needed.
- **Vercel Blob** is at 4 MB of 5 GB storage and ~0.5 MB/day of transfer against
  100 GB/month — it would not leave the allowance even at 100× usage.
- **Vercel compute** is flat at the Pro base. One month saw a roughly-double bill
  from build minutes; a build-compute config change fixed it, so it is excluded
  from the run-rate above.

### Projecting to scale, and amortizing across users

My hunch is that the marginal cost of scoring is tiny — that if you divide the
total infrastructure cost by something like competitors × races scored per
year, the per-competitor-per-race figure is miniscule. If that hunch holds,
then even the busiest, largest clubs adopting Sail Scoring would see a
negligible cost if they were ever asked to pay their share.

The figures above let us check that hunch. Treat one **finish** — one competitor
in one race — as the unit of scoring work; current usage is roughly **1,000
finishes/year** across **~18 series** and **~50 races** (under 400 distinct
competitors). Against the ≈ €342/yr total:

- **Per competitor-per-race: ≈ €0.34** (€342 ÷ 1,000 finishes).
- **Per series: ≈ €19** (€342 ÷ ~18 series).

But those per-unit numbers are high *precisely because volume is low*: €342 is
almost all fixed overhead spread thin over a small amount of scoring. The
*marginal* cost of one more competitor-race is effectively zero — every
usage-based service is deep inside a free tier. So the right way to read the
hunch is stronger than first stated: it isn't just that the per-unit cost is
small, it's that the **total cost is small and barely grows with scale**, and the
per-unit figure therefore *falls* as adoption rises.

Projecting that out — holding the fixed lines flat and stepping the usage-based
services up only as they cross their free tiers:

| Usage | What changes | Total/yr | Per competitor-race |
|-------|--------------|----------|---------------------|
| **1× (today)** | everything on free tiers except domain + Vercel | **≈ €342** | €0.34 |
| **10×** | Neon just crosses its free compute tier (~9×) | **€360–550** | €0.04 |
| **50×** | + Resend Pro ($20/mo); Neon on Launch | **≈ €770** | €0.015 |
| **100×** | same services; Blob & Vercel still within allowance | **≈ €770** | €0.008 |

Two assumptions do the work and are worth stating:

- **Neon** is the one genuinely variable line. On metered Launch rates
  ($0.106/CU-hr, $0.35/GB-month) even 100× usage is only ~€140/yr of compute plus
  storage — but if the Launch plan carries its ~$19/mo minimum, Neon is
  effectively **capped near €210/yr at any realistic scale**, since metered usage
  stays under that floor even at 100×. The table uses that capped figure for 50×
  and 100×.
- **Resend** crosses its 3,000-email/month free ceiling somewhere past ~30×, at
  which point the $20/mo (~€221/yr) Pro plan applies. **Vercel Blob** never leaves
  its allowance even at 100×, and **Vercel compute** is assumed flat at the Pro
  base.

The headline: even at **100× today's usage** — on the order of 100,000
competitor-races and ~1,800 series a year, a genuinely national-scale load — the
service runs for **under about €800/year**, and the cost per competitor-per-race
falls to **well under a cent**.

That projection matters because it reframes the funding question. We are not
looking for a way to recover a large cost; we are looking for a way to cover a
small one without making any individual user pay a fee that deters them.

## Funding models

### Charge clubs directly

The almost-automatic model: charge clubs directly — per club, per user, per
event, or per competitor. It is the obvious way to make the service
self-funding, and the amortization above suggests the fair price would be
small. But this is exactly the model that contrasts with Sailwave's zero cost,
and even a small fee is a barrier to adoption. I would rather avoid it if
another model can cover the (small) costs.

### A central organisation funds or operates the service

The more attractive model: a central organisation — a national governing body,
a large club, a government or public body, or a private donor — funds,
sponsors, or operates the service on behalf of all its users. Users pay
nothing; the service is sustained by an entity with an interest in the wider
sailing community having good scoring software.

This is much easier to achieve if the service has a **narrow, well-defined
userbase**. If `sailscoring.ie` is for Irish clubs and classes only, then a
sponsor is funding the service for a bounded, legible audience — not the
open-ended, potentially unconstrained cost of running it for the entire world.
A country-scoped service is a fundable thing in a way a global one is not.

The project is already set up to support country-scoped instances: the backup
runbook documents bootstrapping a separate instance — e.g. `sailscoring.uk` —
under its own Neon project and AWS account, "preferred if the new instance is
run by a different operator or legal entity"
([database-backup.md](database-backup.md#bootstrapping-a-new-instance)).

## The cost of my time

I have deliberately excluded my own time from the infrastructure costs above,
so I should address it directly.

Right now, this is an interest — a hobby. I think of the time I put into it as
no different from volunteering in a club, and I have no desire to turn Sail
Scoring into a product-driven business.

I can, however, foresee a future where the demands on me go beyond what is
reasonable for a volunteer role. If that happens, I think it would be fair for
me to be paid for my time in some way — as an employee, a contractor, or
whatever arrangement fits. That is a future possibility to keep open, not a
present need.

## The bus factor

A project with a bus factor of one is not sustainable, and today Sail Scoring's
bus factor is one. This is the part of question (a) that has nothing to do with
money: what happens if I am simply not around anymore, for whatever reason?

A few things raise the bus factor:

- **Co-maintainers.** As adoption grows, I might meet like-minded people who
  join me to co-develop and maintain the project. More hands, higher bus
  factor.
- **A sponsoring organisation that operates the service.** An organisation that
  runs `sailscoring.ie` would staff it like any other IT service, so its
  continuity would not depend on me.
- **Open source.** After 25+ years working on open source, my instinct is that
  open-sourcing the project changes this concern fundamentally. In the worst
  case — I disappear and no one is paid to take over — an open project can
  simply be forked, and developed and operated by someone else. Short of that
  worst case, open source makes everything about continuity easier: it is more
  natural to add co-maintainers, it is easier for others to step into a
  maintenance role when everything about the project is already in the open,
  and it takes some of the pressure off a country-scoped service, because an
  adopter who doesn't fit the funded audience can always host their own
  instance.

(Whether to open-source remains formally undecided — see the
open-source-vs-commercial question in
[goals.md](goals.md#establish-a-sustainable-project-model). The point here is
narrower: open source is the strongest single lever I have on the bus factor,
and that weighs on the decision.)

## Separating the code from the running service

There is a gap in the "fork it in the worst case" reassurance. A fork gives
someone the *code*. It does not give them the running service's **database** —
the live series — or its **published-results store**. Code is replaceable; the
accumulated data and the published URLs are not.

So the ideal is to **separate the governance of the code from the governance of
the running service.**

- The **code** can be open and community-governed, forkable by anyone.
- The **running service** (`sailscoring.ie`) should be in the hands of a
  trusted, sustainable organisation — a large club or an NGB — that can be
  relied on to keep it running, keep the data safe, and keep the published URLs
  alive, the way it would any other service it operates.

These two are independent, and that independence is the point. The code
surviving (open source) and the service surviving (a trusted operator) are
different guarantees, and a sustainable Sail Scoring needs both.

## The name, the trademark, and the domains

> This section is framing, not legal advice. Anything we actually do here needs
> a solicitor — trademark is jurisdictional and the wording matters. The point
> is to decide *what we want the arrangement to achieve* before drafting it.

Open source answers "can the *code* survive me?" It deliberately says nothing
about the **name**. Copyright and the code licence govern the software;
*trademark* governs the words "Sail Scoring" and the logo — and the two are
legally independent. That independence is exactly the lever this project wants:

- The **code** is open (MIT/Apache, assuming we go open source) — anyone may
  fork it, change it, and run it. We can't stop that, and don't want to.
- The **name** is the project's to grant — running a service *called* "Sail
  Scoring," or using the logo, is something an operator does *with permission*.
  A rescinded operator can keep running their fork; they just can't keep calling
  it Sail Scoring.

This is the standard open-source pattern, not an exotic one. The mark is the
quality bar the open licence can't provide on its own.

### What the grant is mainly for

It's tempting to read the mark as a *weapon* — something I wield against a
bad-faith operator. That's backwards. Its main job is the opposite: to give a
*good-faith* NGB the **certainty that it has the project's blessing**. An NGB
about to acquire `sailscoring.fr`, train its scorers on the tool, and stake its
events on it wants to know it is formally sanctioned — that it isn't quietly
stepping on someone's rights and can invest with confidence. A written grant
supplies exactly that reassurance, and that reassurance is the product.

Read that way, the two worries that usually dominate a trademark discussion —
*is the mark even defensible?* and *could I enforce it abroad?* — matter far
less than they first appear:

- A good-faith NGB will not lean on "it's probably not a valid trademark" or
  "you couldn't enforce it in France." Those are an adversary's arguments, and
  an adversary is not who we're contracting with. The partner *wants* the
  legitimacy — that's the whole reason it asks.
- The realistic worst case with a bad-faith operator isn't a lawsuit I might
  lose; it's that they fork and rename, which the open licence permits anyway
  and which the project survives fine. The downside is bounded, and we've
  already accepted it.

So the grant is a carrot, not a stick. It works because the recipient values
being blessed, not because I can credibly threaten them. That doesn't make
formalising the mark pointless — the formality is what makes the blessing *mean*
something — but it changes what "good enough" looks like: enough to confer real
legitimacy on a willing partner, not an airtight instrument for coercing an
unwilling one.

### Precedents

- **Linux** — Linus Torvalds personally owns the "Linux" trademark (administered
  via the Linux Mark Institute) while the code is GPL. The closest precedent for
  an individual holding the mark of an open project, which is where Sail Scoring
  would start.
- **Mozilla / Firefox → Debian Iceweasel** — Mozilla's trademark policy let
  anyone use the *code* (MPL) but required builds to meet its standards to carry
  the *Firefox* name and logo. Debian wanted to patch freely and the logo wasn't
  free, so for years it shipped the same browser as "Iceweasel." The cautionary
  tale for *how strict* the quality bar should be: too strict and your most
  committed downstream renames rather than complies.
- **Red Hat / RHEL → CentOS, Rocky, Alma** — the source is GPL, so rebuild
  distros are legal, but they must *strip Red Hat trademarks*. Trademark, not
  copyright, is the actual control point. Same model as Chromium vs. Chrome.
- **WordPress Foundation / Automattic vs. WP Engine (2024)** — a live, messy
  dispute over who may use the "WordPress" / "WP" marks commercially on top of
  GPL code. Worth reading as a warning about *vague* marks and *discretionary*
  enforcement: the fight is ugly precisely because the boundaries were never
  written down clearly.
- **Apache Software Foundation / Mozilla Foundation / Python Software
  Foundation** — the mature destination: the mark is held by a neutral
  non-profit with a published trademark policy, not an individual. More overhead,
  far better bus factor and credibility with an NGB.

### Who holds the mark

The lean is a progression, mirroring the bus-factor reasoning above — hold it
personally now, move it to a foundation later:

1. **Now: I hold it personally** (the Torvalds model). Cheapest, fastest,
   keeps control with the creator. Weakness: it's another single point of
   failure — if I'm gone, who owns and licenses the name? Ties straight into the
   [bus factor](#the-bus-factor), which is part of why this is a stop on the way,
   not the destination.
2. **Later: a neutral non-profit holds it** (the ASF/Mozilla model). The right
   home once there is more than one instance and more than one maintainer; a
   foundation licensing the mark to NGBs is far more credible than an individual
   doing so, and it survives me.

### What a trademark licence to an NGB would say

The concrete case: an NGB wants to acquire `sailscoring.fr` and operate a
French instance ([horizon: country-scoped
instances](design/horizon.md#country-scoped-instances)). We grant a written
trademark licence. First-draft intent of the terms:

- **Grant.** Permission to use the "Sail Scoring" name and logo to operate one
  country-scoped instance, and to register/use the country domain
  (`sailscoring.fr`). Probably one operator per country (territorial), so the
  NGB gets a clear, exclusive claim within its own jurisdiction.
- **Fork-and-extend is allowed.** They may fork the open code, add their own
  features, and *still call it Sail Scoring* — we are deliberately more
  permissive than Mozilla's "unmodified builds only" rule, because local
  adaptation (handicap systems, language) is the whole reason a national
  instance exists.
- **…within reasonable limits (quality clause).** The lean is *light touch*:
  rescind only for clear harm to the name — illegal use, misrepresenting the
  fork as the canonical project, or abandoning the core scoring purpose — not
  for divergence we merely dislike. Local adaptation is encouraged, so the bar
  is "don't damage the brand," not "stay close to upstream." One caveat keeps
  this honest: trademark law *requires* the owner to exercise *some* quality
  control — a licence with no oversight ("naked licensing") can forfeit the mark
  entirely. So even the light-touch version must name a few concrete things the
  instance has to keep doing (e.g. correct RRS scoring, data export preserved),
  enough to be real oversight without becoming Mozilla's strict-build regime.
- **Reliability clause.** We can rescind if they fail to operate the service
  reliably — this is the trademark doing the work of the "trusted operator"
  promise in the section above. Needs a definition of "reliably" (uptime?
  domain renewal? backups maintained?) rather than a feeling.
- **Data return on termination.** If the licence is rescinded, the operator must
  hand over a full database backup (and the published-results store) so the
  service can be re-instantiated elsewhere. This is the clause that protects
  *question (b)* — it closes the "a fork gives you the code but not the data"
  gap from the section above, by making the data return a *condition of having
  used the name*.
- **Domain hand-back.** On termination the country domain should transfer to us
  (or the foundation) too — otherwise a rescinded operator keeps
  `sailscoring.fr`, renames the service, and the country URL is lost to the
  project anyway.
- **Wind-down / user notice.** A transition period and notice to users so the
  local sailing community and its published URLs aren't stranded the day a
  licence ends.

### Caveats worth stating plainly

- **Defensibility matters less than it first looks.** "Sail Scoring" is close
  to descriptive — "scoring for sailing" — and descriptive marks are weak; the
  *logo* or a stylised wordmark would be more defensible than the bare words. We
  should register what we reasonably can. But per "what the grant is mainly
  for," airtight defensibility isn't the load-bearing requirement: we're
  conferring legitimacy on a willing partner, not arming for litigation. Even a
  modest registered mark makes the blessing concrete — that's the job.
- **This doesn't weaken the open-source guarantee.** A rescinded NGB can keep
  running their fork under a different name — that's fine and consistent with
  "fork it in the worst case." Trademark controls the *brand*, never the
  *freedom to run the software*. The two guarantees coexist.
- **Cross-border enforceability, likewise.** A data-return or domain-hand-back
  clause against a French body is only as strong as its enforceability there —
  but again, a good-faith operator honours the agreement it signed, and the
  bad-faith worst case is bounded (fork-and-rename). The foundation route helps
  as this grows mostly by making the agreement more *credible to sign*, not more
  coercible.

## Answering (b): will the data still be there?

Question (b) deserves a concrete answer beyond "a trusted org will keep the
lights on," because the strongest guarantee is the one that holds *even if the
service goes away entirely.* This is how a web tool earns back Sailwave's
structural "your files are yours, forever" property: not by promising the
server never dies, but by making the data independent of it.

- **Data portability.** Every series round-trips through an open JSON
  export/import format, and the design value is explicit: lock-in is contrary
  to the project's values ([goals.md](goals.md)). A club can export everything
  and walk away.
- **Self-contained published results.** A published results page embeds the
  full series as JSON inside its "Open in Sail Scoring" link. A saved or
  archived results page is therefore not just a snapshot — it carries the data
  needed to reconstruct the series in any future copy of the tool.
- **Self-hosting.** Because the code can be open and runs on portable
  foundations (plain Postgres, standard `next build` / `next start` — see the
  portability seams in
  [ADR-008](design/decisions/008-full-stack-transition.md#sustainability-posture)),
  an adopter who outlives the hosted service can stand up their own. The backup
  runbook documents this end to end.
- **Backups.** Production data is backed up out-of-Neon into S3 with Object
  Lock, surviving credential compromise and accidental destruction
  ([database-backup.md](database-backup.md)).
- **Published-URL permanence.** Published `/p/...` URLs need to still resolve in
  10–20 years, the way Sailwave HTML pages on club websites still do. That
  depends on the `sailscoring.ie` domain being renewed indefinitely and the
  publishing store being preserved — ADR-005 flags a domain lapse as taking
  down every service at once. Domain renewal and URL continuity are part of
  what the trusted service operator is responsible for, not an afterthought.

## What this document does not cover

The sustainability of the *dependencies* Sail Scoring is built on — Next.js,
React, Postgres/Neon, Drizzle, Better Auth, and the rest — is a separate layer,
already analysed in [oss-health-report.md](design/oss-health-report.md) and
acted on in
[ADR-008's sustainability posture](design/decisions/008-full-stack-transition.md#sustainability-posture).
This document is about the sustainability of the project and the service:
funding, maintainership, and governance.
