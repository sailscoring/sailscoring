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

> **TODO: fill in actual figures from billing.** The structure is fixed; the
> numbers are placeholders.

| Component | What it's for | Annual cost |
|-----------|---------------|-------------|
| `sailscoring.ie` domain | All public URLs; renews annually ([ADR-005](design/decisions/005-hosting-and-domains.md)) | **TODO** |
| Vercel (Pro) | Compute + bandwidth; Pro tier required for the private repo | **TODO** |
| Neon Postgres | Server-of-record for all series data | **TODO** |
| Vercel Blob | Published-results HTML storage | **TODO** |
| Resend | Magic-link sign-in + transactional email | **TODO** |
| scupper (FTP relay) | Optional upload to a club's own web host | **TODO** |
| S3 backup storage | Out-of-Neon backups ([database-backup.md](database-backup.md)) | cents/month — rounding error |
| **Total** | | **TODO** |

### Projecting to scale, and amortizing across users

My hunch is that the marginal cost of scoring is tiny — that if you divide the
total infrastructure cost by something like competitors × races scored per
year, the per-competitor-per-race figure is miniscule. If that hunch holds,
then even the busiest, largest clubs adopting Sail Scoring would see a
negligible cost if they were ever asked to pay their share.

> **TODO:** once the totals above are real, compute the per-event and
> per-competitor-per-race cost, and project the total at, say, 10×, 50×, and
> 100× current usage.

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
