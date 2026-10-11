# Deploying the hosted instance

A runbook for the hosted Evenly (`https://<domain>/evenly`, behind the portfolio), following
[PLATFORM.md](../PLATFORM.md) sections 4, 5 and 9. Self-hosters do not need any of this; they use
`docker compose up` (see the README). Nothing here has been done for you: every step touches your
infrastructure, so you run it.

The database provisioning and the app's start-up against it were checked on a throwaway Postgres 18
with the same least-privilege role: migrations apply as the database owner (no superuser), `citext` is
created, `/evenly/readyz` answers `ready` and the container reports healthy.

## 0. What you need

- A Postgres 18 server (one server, one database and role per project, PLATFORM.md section 4).
- Somewhere to run the image `ghcr.io/vaarun-kamath/evenly:0.1.0` (a Railway service, or a VPS with
  Docker). Pin the version tag; move it up on purpose.
- The portfolio's domain, and the portfolio repo's `next.config` rewrite (step 5).
- S3-compatible storage for backups (Cloudflare R2 or Backblaze B2).

## 1. Create the database and role (once, as the superuser)

```sql
CREATE ROLE lib001 LOGIN PASSWORD '<generated, URL-safe>';
CREATE DATABASE lib001 OWNER lib001;
REVOKE CONNECT ON DATABASE lib001 FROM PUBLIC;
-- connect to lib001, then:
REVOKE ALL ON SCHEMA public FROM PUBLIC;
```

The role owns its database, so it can create the tables and the `citext` extension (a trusted extension)
that the migrations need. It is not a superuser. If a pooler such as PgBouncer sits in front, also set
`MIGRATION_DATABASE_URL` to a direct connection, because migrations take a session-level advisory lock.

## 2. Set the environment

| Variable         | Hosted value                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | `postgres://lib001:<password>@<host>:5432/lib001`                                                                                                     |
| `PUBLIC_URL`     | `https://<domain>/evenly`: the address people see, with the path. `BASE_PATH` is derived from it; do not set it.                                        |
| `SESSION_SECRET` | `openssl rand -base64 32`. Optional (one is generated and stored in the database otherwise), but set it on a public instance and keep it with the other secrets. |
| `TRUST_PROXY`    | The number of proxies between the internet and the container that append to `X-Forwarded-For` (see below).                                            |
| `ALLOW_SIGNUPS`  | `true`, or `invite-only` to start with a closed group of people.                                                                                      |
| `SMTP_URL`, `SMTP_FROM` | Optional. Without them, password resets go through the administrator's command (step 6).                                                       |
| `LOG_LEVEL`      | `info`                                                                                                                                                |

`TRUST_PROXY` decides which address the rate limits see. Too low and every visitor looks like the proxy
(one visitor's failed logins lock everyone out of the per-IP limit); too high and a visitor can make up
an address and dodge the per-IP limit. The per-account limits protect against guessing either way. Set
the real hop count for your setup (for example one for the portfolio's rewrite, plus one if the host puts
its own proxy in front), then check in the logs that requests show different client addresses.

## 3. Run the container

Any host that runs an image works. The container listens on `PORT` (3000), runs as a non-root user, applies
migrations when it starts (under a lock, so a second replica waits) and handles `SIGTERM`.

- Health checks: `GET /evenly/healthz` (process) and `GET /evenly/readyz` (database and migrations). The image's
  own `HEALTHCHECK` reads `PUBLIC_URL`, so it follows the path.
- On a VPS: a compose service with `image: ghcr.io/vaarun-kamath/evenly:0.1.0`, `restart: unless-stopped`
  and the variables above; do not publish the port publicly, only to whatever the portfolio proxies to.

## 4. Check it before putting the portfolio in front

```bash
curl -s https://<upstream>/evenly/healthz      # {"status":"ok"}
curl -s https://<upstream>/evenly/readyz       # {"status":"ready"}
curl -s https://<upstream>/evenly/api/v1/ping  # {"status":"ok","name":"evenly"}
curl -si https://<upstream>/healthz | head -1  # 404: nothing is served outside the path
```

## 5. Wire the portfolio (done in the portfolio repo, not this one)

- A rewrite from `/evenly/:path*` to `${EVENLY_UPSTREAM}/evenly/:path*`. The prefix is kept: the app serves
  its own routes under it, so no path stripping is needed.
- The `Origin` the browser sends is the portfolio's domain, which is what `PUBLIC_URL` says, so the origin
  check passes. Cookies are set with `Path=/evenly` and `Secure` (the URL is https).
- `content/liberated/lib-001.json`: `status`, `repo` (`https://github.com/Vaarun-Kamath/evenly`), the mount path
  `/evenly`, the upstream URL, the stack and the screenshots in `docs/screenshots/`.
- Check by hand: sign up at `https://<domain>/evenly`, create a group, add an expense, reload on
  `/evenly/g/<id>/settle`, download the CSV.

## 6. Day-two commands

```bash
# Print a one-hour, single-use password reset link (no email needed):
node dist/cli.js reset-password someone@example.com     # run it inside the container
```

## 7. Back up, and prove you can restore

Nightly, keep 14 days (PLATFORM.md section 4):

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > lib001-$(date +%F).dump
# upload to the bucket, for example with the AWS CLI against R2 or B2's S3 endpoint:
aws s3 cp lib001-$(date +%F).dump s3://<bucket>/evenly/ --endpoint-url https://<account>.r2.cloudflarestorage.com
# and delete dumps older than 14 days (a bucket lifecycle rule does this without a script)
```

Test a restore once a month, into a scratch database so nothing live is touched:

```bash
createdb -U postgres lib001_restore -O lib001
pg_restore --no-owner --exit-on-error -d lib001_restore lib001-<date>.dump
psql -d lib001_restore -Atc "select count(*) from expenses; select count(*) from \"user\";"   # sensible numbers?
dropdb -U postgres lib001_restore
```

The full drill (drop the database, restore, start the app, check that old sessions and balances are intact)
is `scripts/backup-restore-test.sh`; it runs on a throwaway stack, never on the hosted one.

Migrations only move forward. To go back to an older version, restore the dump taken before the upgrade
and run the older image.

## 8. Upgrading

Take a dump, change the image tag, deploy, and watch `/readyz`. Read the CHANGELOG for the version first.

## Checklist

- [ ] Database and role created, connection string stored as a secret
- [ ] `PUBLIC_URL`, `SESSION_SECRET`, `TRUST_PROXY`, `ALLOW_SIGNUPS` set
- [ ] Container healthy; step 4 checks pass
- [ ] Portfolio rewrite and `lib-001.json` updated; manual walk-through done
- [ ] Nightly dump uploaded; one restore into a scratch database done
