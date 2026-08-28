# Database backups

Production data lives in Neon (via Vercel Marketplace). Neon provides
point-in-time recovery within its own retention window, but every Neon
and Vercel control plane shares fate with the live database — a leaked
or misused credential could in principle drop tables, shorten PITR, or
delete the project. To survive that, we keep an out-of-Neon copy in S3
with Object Lock in compliance mode.

## Threat model

What this protects against:

- **Compromise of any Neon or Vercel credential** (including a local
  agent reading `.env.local`). Backups live in a separate AWS account,
  reachable only through an IAM role that GitHub Actions assumes via
  OIDC. No long-lived AWS credential exists on developer machines.
- **Accidental destruction.** Once an object is uploaded, Object Lock
  in compliance mode prevents *any* principal — including the AWS root
  account — from deleting or overwriting it for 90 days.
- **Compromise of the writer credential itself.** The IAM role grants
  only `s3:PutObject`; it cannot list, read, delete, or shorten
  retention.

What this does **not** protect against:

- An attacker filling the bucket with junk objects under the same
  prefix. The writer can write more, just not destroy past writes.
  Accepted: a leaked writer costs storage, not history.
- Compromise of the AWS root account *plus* 90 days of patience.
  Mitigation here is account hygiene (MFA, minimal use), not bucket
  policy.
- Logical errors that take longer than the retention window to
  discover. Extend retention if this matters more.

## Architecture

Two schedules, differing only in what they include:

| | Daily | Weekly |
|---|---|---|
| **Schedule** | 06:00 UTC | 05:40 UTC, Sunday |
| **Object key** | `daily/YYYY/MM/DD/sailscoring-<ts>.dump` | `weekly/YYYY/MM/DD/sailscoring-<ts>.dump` |
| **`as_published_results` rows** | excluded | included |
| **Everything else** | included | included |

- **Workflow:** `.github/workflows/backup-database.yml` — one job; the
  schedule that fired decides the mode. `workflow_dispatch` runs a daily
  by default, or a full dump with the `full` input set.
- **Source:** a Neon **read-replica** compute on the production branch.
  Read replicas share storage with the primary but cannot accept
  writes, so a leaked `BACKUP_DATABASE_URL` cannot damage production.
- **Format:** PostgreSQL custom format (`pg_dump -Fc`), internally
  compressed.
- **Auth, Actions → AWS:** OIDC. The IAM role's trust policy restricts
  it to this repo on `main` only.
- **Auth, Actions → Neon:** the read-replica connection string in the
  `BACKUP_DATABASE_URL` repo secret.

The concrete bucket name and IAM role ARN for this deployment live in
`.github/workflows/backup-database.yml`. The runbook below uses
`<bucket>` as a placeholder.

### Why the daily dump omits the archive rows

`as_published_results` holds the as-published archives ([ADR-010](design/decisions/010-as-published-archives.md)):
ingested from the per-class archive repos, display-only, never re-scored.
It is over half of the database by volume, and it is **already backed up**
— in those repos, in git, with the ingest CI able to reproduce it.

That matters more than it might sound, because `pg_dump --format=custom`
compresses **on the client, after the rows have crossed the wire**. The
compressed artefact in S3 is not what the transfer costs: in August 2026
a 19 MiB object cost ~98 MiB of egress, and that line alone consumed 42%
of the database's monthly network-transfer allowance. Excluding these rows
roughly halves it.

The exclusion is `--exclude-table-data`, not `-T`. The table's definition
stays in every dump, so restoring a daily backup gives you a complete,
working schema with this one table empty — not a database missing a table
the application expects. Re-running the archive apply repopulates it.

The weekly run takes no exclusions, so a single-artefact restore needing
no archive replay is never more than seven days stale.

## Quick sanity check (no restore)

For a fast "is this dump any good?" check on a freshly downloaded
backup, before committing to the full restore drill below:

```bash
scripts/check-backup.sh ~/Downloads/sailscoring-YYYY-MM-DDThh-mm-ssZ.dump
```

The script reads the dump's table of contents and, for every
`TABLE DATA` entry, decompresses the COPY block on the fly to count
rows — no target database needed. It prints a per-table row count and
flags any empty tables for you to eyeball.

What this proves: the file is a valid `pg_dump -Fc` archive whose TOC
and per-table COPY streams decompress cleanly, and the row counts are
in the right ballpark vs. expectations. What it does **not** prove:
that indexes and constraints rebuild. For that, run the full restore
drill.

**On a `daily/` dump the script will flag `public.as_published_results`
as empty. That is correct and expected** — see [Architecture](#architecture).
On a `weekly/` dump it should be populated, and an empty one there is a
real finding.

## Restoring from a backup

This procedure restores a chosen dump into a scratch Postgres for
verification. Adapt to point at a real recovery target if needed.

You'll need: aws CLI configured with read access to the backup bucket,
and a target Postgres (the local dev container is fine for drills).

1. **Pick the backup.** Recent objects:

   ```bash
   aws s3 ls s3://<bucket>/daily/ --recursive | grep -v ' 0 ' | tail
   aws s3 ls s3://<bucket>/weekly/ --recursive | grep -v ' 0 ' | tail
   ```

   **Which prefix?** A `weekly/` object restores to a complete database in
   one step and is the right choice unless you specifically need a
   point closer in time. A `daily/` object is up to six days fresher but
   restores with `as_published_results` empty; see step 6.

   The `grep -v ' 0 '` filter excludes any 0-byte ghost objects left
   behind by past failed runs (the upload races ahead of `pipefail`
   when `pg_dump` errors mid-stream; the current workflow dumps to a
   file before uploading to prevent new ghosts). Existing ghosts are
   locked under retention until they expire and cannot be removed
   earlier.

2. **Download:**

   ```bash
   aws s3 cp \
     s3://<bucket>/daily/YYYY/MM/DD/sailscoring-...dump \
     /tmp/restore.dump
   ```

3. **Bring up a clean target.** For drills, use the local dev
   container:

   ```bash
   pnpm db:up
   psql postgres://sailscoring:sailscoring@localhost:5432/sailscoring -c "
     DROP SCHEMA IF EXISTS public CASCADE;
     DROP SCHEMA IF EXISTS drizzle CASCADE;
     CREATE SCHEMA public;
   "
   ```

   The `drizzle` schema holds Drizzle's migration ledger
   (`__drizzle_migrations`); dropping it ensures the restore lands a
   clean copy of both application data and schema-version state.

4. **Restore:**

   ```bash
   pg_restore \
     --clean --if-exists \
     --no-owner --no-privileges \
     --dbname=postgres://sailscoring:sailscoring@localhost:5432/sailscoring \
     /tmp/restore.dump
   ```

   The dump captures the schema, so no separate Drizzle migration step
   is needed.

   `pg_restore` from a newer Postgres version is fine (e.g. v18.x
   restoring a v17 dump). A *lower* version cannot read newer-format
   dumps and will refuse outright — match or exceed the dumping
   server's major version.

5. **Smoke-test:**

   ```bash
   pnpm dev:local
   # http://localhost:3000 — sign in, open a series, view standings.
   ```

6. **If you restored a `daily/` dump, replay the archives.** The restore
   left `as_published_results` empty by design. Re-run the archive apply
   from each per-class archive repo against the restored database to
   repopulate it. Until you do, as-published series will render with no
   stored results — the rest of the application is unaffected.

   Skip this entirely when restoring from `weekly/`.

### Drill cadence

Run an end-to-end restore every six months. A backup is theoretical
until you've restored from it.

## Bootstrapping a new instance

Use this when standing up a new Sail Scoring deployment under a
separate Neon project and GitHub repo (e.g. a country-domain variant
like `sailscoring.uk`). The procedure parameterises everything that
should differ; the security posture stays identical.

Set shell variables for the new instance and reuse them throughout:

```bash
INSTANCE=sailscoring-uk
REGION=eu-west-2
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=sailscoring/sailscoring-uk
BRANCH=main
BUCKET=${INSTANCE}-backups-${REGION}
ROLE=${INSTANCE}-backup-writer
```

Decide upfront whether the new instance lives in:

- **The same AWS account** — fine if a single operator owns both. Skip
  step 2 below since the OIDC provider is already in place.
- **A separate AWS account** — preferred if the new instance is run by
  a different operator or legal entity. Run all steps; substitute
  `ACCOUNT` accordingly.

### 1. Create the S3 bucket with Object Lock

```bash
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" \
  --object-lock-enabled-for-bucket

aws s3api put-object-lock-configuration \
  --bucket "$BUCKET" \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {"DefaultRetention": {"Mode": "COMPLIANCE", "Days": 90}}
  }'

aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Verify the lock by uploading a tiny test object and confirming a delete
is rejected. The test object will be locked for 90 days; accept the
cost.

```bash
echo "lock-check $(date -u +%FT%TZ)" \
  | aws s3 cp - s3://${BUCKET}/test/lock-check.txt

VID=$(aws s3api list-object-versions --bucket "$BUCKET" \
        --prefix test/lock-check.txt \
        --query 'Versions[0].VersionId' --output text)
aws s3api delete-object --bucket "$BUCKET" \
  --key test/lock-check.txt --version-id "$VID"
# Expect: AccessDenied because object protected by object lock.
```

### 2. Register GitHub as an OIDC provider (one-time per AWS account)

Skip if `aws iam list-open-id-connect-providers` already shows
`token.actions.githubusercontent.com`.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 3. Create the writer IAM role

`trust-policy.json` (substitute `ACCOUNT`, `REPO`, `BRANCH`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:REPO:ref:refs/heads/BRANCH"
      }
    }
  }]
}
```

`backup-writer-policy.json` (substitute `BUCKET`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::BUCKET/daily/*"
  }]
}
```

Apply:

```bash
aws iam create-role \
  --role-name "$ROLE" \
  --description "GitHub Actions OIDC role for daily Postgres backups" \
  --assume-role-policy-document file://trust-policy.json

aws iam put-role-policy \
  --role-name "$ROLE" \
  --policy-name BackupWrite \
  --policy-document file://backup-writer-policy.json
```

### 4. Create a Neon read replica

In the Neon console for the new project: Branches → click the
production branch → Add Compute → type **Read replica**, smallest size,
autosuspend on. Copy the connection string.

Sanity-check it really is read-only:

```bash
psql "$BACKUP_URL" -c "CREATE TABLE _ro_check (x int);"
# Expect: ERROR: cannot execute CREATE TABLE in a read-only transaction
```

### 5. Add the GitHub repo secret

```bash
gh secret set BACKUP_DATABASE_URL --repo "$REPO"
# Paste the read-replica connection string when prompted.
```

### 6. Add the workflow file

Copy `.github/workflows/backup-database.yml` from this repo into the
new one. Update two values:

- `role-to-assume:` → `arn:aws:iam::ACCOUNT:role/ROLE`
- `BUCKET:` → the new bucket name

Commit and push to `main`.

### 7. Verify

```bash
gh workflow run "Database backup" --repo "$REPO" --ref "$BRANCH"
gh run list --workflow "Database backup" --repo "$REPO" --limit 1
# Then `gh run watch <id> --repo "$REPO" --exit-status`
```

After it succeeds:

```bash
aws s3 ls s3://${BUCKET}/daily/ --recursive
aws s3api get-object-retention --bucket "$BUCKET" \
  --key daily/YYYY/MM/DD/sailscoring-...dump
```

`Mode` should be `COMPLIANCE`, `RetainUntilDate` ~90 days out. Done.

## Operational notes

### Failure detection

Relies on GitHub's default email-on-scheduled-workflow-failure to repo
admins. **The "workflow did not run at all" case is not alarmed.** If
that becomes a concern, wire up a heartbeat to a third-party
dead-man's-switch (e.g. healthchecks.io) — the workflow pings on
success, the service alerts on silence. See issue #125 for the prior
discussion.

### Cost

S3 storage is a rounding error — ~10 MiB per daily dump and ~20 MiB per
weekly, held 90 days, is cents per month at S3 standard pricing. GitHub
Actions compute fits inside the free tier comfortably.

The cost that actually matters is **Neon network transfer**, and it is
much larger than the stored artefacts suggest, because the dump is
compressed client-side after the rows are already on the wire. Budget on
the *uncompressed* size: currently ~46 MiB per daily run and ~98 MiB per
weekly, so ~1.8 GB/month. That is comfortably inside the 500 GB/month a
paid Neon plan includes, but it was 2.4 GB/month before the exclusion
above and it exhausted the free plan's 5 GB allowance in August 2026.
This line grows with the database, so re-check it after any large import.

### Scheduled runs are late — sometimes by many hours

GitHub's scheduled-workflow queue is best-effort, and this workflow has
never once beaten it. Across 114 scheduled runs from May to August 2026,
**not one started within 15 minutes of its slot**:

| | Lateness |
|---|---|
| Best ever | 22 min |
| Median | 2 h 29 min |
| 90th percentile | 4 h 09 min |
| Worst | **11 h 09 min** (27 Aug 2026, a `0 6 * * *` slot that ran at 17:09 UTC) |

Both crons are set off the top of the hour because `:00` is where nearly
everyone's cron lands. That is a smaller queue, not an escape from it:
the median improved markedly through August while the single worst delay
in the whole record also happened that month, so treat the schedule as
"once a day, eventually" rather than as a time of day.

**No run has ever been lost.** Every one of the 114 arrived and
succeeded. That matters for how you read a missing backup: the 27 August
run looked dropped for eleven hours and was not, so *absence is not yet
failure*, and re-running by hand too early only duplicates work. If you
need one at a predictable moment, trigger it — `gh workflow run
"Database backup"` starts within seconds, because manual dispatches do
not go through the scheduled queue.

Lateness is otherwise cosmetic: a backup at 17:09 protects the same data
as one at 06:00, only with a longer worst-case gap between snapshots. A
run that genuinely never happens is a different matter, and is invisible
— see Failure detection above.

### Extending retention

Object Lock retention can be **extended** but never shortened. To
start keeping new uploads for 180 days:

```bash
aws s3api put-object-lock-configuration \
  --bucket <bucket> \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {"DefaultRetention": {"Mode": "COMPLIANCE", "Days": 180}}
  }'
```

This affects future uploads only. Existing locked objects keep their
original expiry unless individually extended via
`put-object-retention`.

### You cannot shorten retention

That is the point. If 90 days turns out to be too long, lower the
bucket default for *future* uploads — but everything already locked
stays locked until its individual expiry. Choose retention
deliberately.
