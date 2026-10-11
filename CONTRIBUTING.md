# Contributing

Thanks for helping. A few ground rules keep the project healthy.

## Clean-room

Evenly is built from the public behaviour of expense-splitting apps only. Never copy source code,
decompiled code, private APIs, UI assets, icons, copy text, names or branding from another product,
and do not paste any of it into issues or pull requests.

## Setup

See "Develop" in the [README](README.md). Before opening a pull request, run:

```bash
pnpm check
```

It runs lint, the format check, the type check and the tests. Pull requests need it green.

## Money

Money is handled as integer minor units only, with one rounding rule. Read
[the architecture notes](docs/lib-001-split/ARCHITECTURE.md) section 5 before touching anything
that calculates an amount. Money code needs unit tests and property tests.

## Decisions

If you deviate from the design documents in `docs/`, record why in a short ADR in `docs/adr/` and
mention it in the pull request. Where an ADR and an older document disagree, the ADR wins.

## Style

TypeScript in strict mode. Prettier formats the code (`pnpm format`). Do not use `any` without a
comment that says why.

By contributing you agree that your contribution is licensed under AGPL-3.0-only.
