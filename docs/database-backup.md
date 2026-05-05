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

- **Schedule:** daily at 06:00 UTC.
- **Workflow:** `.github/workflows/backup-database.yml`.
- **Source:** a Neon **read-replica** compute on the production branch.
  Read replicas share storage with the primary but cannot accept
  writes, so a leaked `BACKUP_DATABASE_URL` cannot damage production.
- **Format:** PostgreSQL custom format (`pg_dump -Fc`), internally
  compressed.
- **Object key:** `daily/YYYY/MM/DD/sailscoring-YYYY-MM-DDThh-mm-ssZ.dump`.
- **Auth, Actions → AWS:** OIDC. The IAM role's trust policy restricts
  it to this repo on `main` only.
- **Auth, Actions → Neon:** the read-replica connection string in the
  `BACKUP_DATABASE_URL` repo secret.

The concrete bucket name and IAM role ARN for this deployment live in
`.github/workflows/backup-database.yml`. The runbook below uses
`<bucket>` as a placeholder.

## Restoring from a backup

This procedure restores a chosen dump into a scratch Postgres for
verification. Adapt to point at a real recovery target if needed.

You'll need: aws CLI configured with read access to the backup bucket,
and a target Postgres (the local dev container is fine for drills).

1. **Pick the backup.** Recent objects:

   ```bash
   aws s3 ls s3://<bucket>/daily/ --recursive | grep -v ' 0 ' | tail
   ```

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

Storage is rounding error: ~100 KiB per dump × 90 days at S3 standard
pricing is cents per month. GitHub Actions compute fits inside the
free tier comfortably (one ~40-second job per day).

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
