# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) once it reaches 0.1.0.

## [Unreleased]

### Added

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
