# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) once it reaches 0.1.0.

## [Unreleased]

### Added

- `packages/core`: exact money parsing and formatting, the single allocation rule, the four split methods,
  net balances, simplified settlement plans and pairwise debts, with unit and property tests (100% coverage).
- Project skeleton: pnpm workspace, Fastify server with `/healthz` and `/readyz`, React app,
  Docker image and Compose file, support for serving under a sub-path such as `/evenly`.
