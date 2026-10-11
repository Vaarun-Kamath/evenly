# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) once it reaches 0.1.0.

## [Unreleased]

### Added

- Web app: sign up, log in and password reset; a dashboard with totals across groups; groups with expenses, balances
  and an activity feed; adding and editing expenses with a live split preview for all four methods; one-tap settle-up
  (the simplified plan, or the pairwise debts when simplify is off); group settings (people, roles, invitation links,
  claim links for placeholders); the invitation landing page; account settings. Mobile-first, keyboard-friendly, light
  and dark, self-hosted fonts.
- End-to-end tests (Playwright, `scripts/e2e.sh`): SPEC.md scenarios 1 to 10 against the built image at `/` and
  `/evenly`, a reload on a deep link, a keyboard and focus check, an axe-core accessibility check and a 375px overflow
  check; a CI job runs them.
- Expenses and settlements: create (safe to retry), edit with optimistic locking, soft delete and restore, filtered and
  paged lists; the four split methods; balances with a simplified plan and pairwise debts; an overview across groups;
  a streamed CSV export whose totals match the balances.
- Groups, members and invites: create, update, archive and delete groups; roles (owner, admin, member);
  placeholder members; invite links with expiry and use limits, email invitations, claiming a placeholder; leaving
  and removing people only at a zero balance; an activity feed; account deletion.
- Database (Drizzle, Postgres 18), migrations that run at startup under an advisory lock, and email-and-password
  accounts (Better Auth): sign up, log in, log out, log out everywhere, profile (`/api/v1/me`), sign-up policy,
  rate limits, Origin check, and a `reset-password` command.
- `packages/core`: exact money parsing and formatting, the single allocation rule, the four split methods,
  net balances, simplified settlement plans and pairwise debts, with unit and property tests (100% coverage).
- Project skeleton: pnpm workspace, Fastify server with `/healthz` and `/readyz`, React app,
  Docker image and Compose file, support for serving under a sub-path such as `/evenly`.
