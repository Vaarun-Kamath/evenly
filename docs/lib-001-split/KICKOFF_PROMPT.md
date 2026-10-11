# Kickoff prompt

1. Create the folder `C:\Users\varun\Documents\Github\liberated-split` (next to `Portfolio`, **not inside it**)
   and an empty GitHub repo with the same name.
2. Open a new Claude Code session **in that folder**.
3. Paste everything below the line.

---

You're building **LIB-001**, the first project of my "Liberated Software" initiative: a free,
open-source, self-hostable app for splitting shared expenses (working name "Evenly"; final name to be
decided). It is a clean-room alternative to Splitwise-style apps.

**Where things are**
- This folder (`liberated-split`) is the project's own repo. All the code goes here.
- The handoff docs are in my portfolio repo at `C:\Users\varun\Documents\Github\Portfolio\handoff\`.
  **First step:** `git init` (if needed), then copy `handoff/PLATFORM.md` and the whole `handoff/lib-001-split/`
  folder into `docs/` here (`docs/PLATFORM.md`, `docs/lib-001-split/*`). From then on, the copies in `docs/` are the ones to read and update.
- Don't modify the portfolio repo. It is the public front door that will proxy `/evenly` to this app's
  container (PLATFORM.md §9), but I make those changes in a separate session.

**The docs**
- `docs/PLATFORM.md`: conventions shared by every Liberated Software project (repo layout, single Docker image,
  one database and role per project on a shared Postgres server, hosting, CI, AGPL-3.0, clean-room rules,
  and running under a `BASE_PATH` behind the portfolio).
- `docs/lib-001-split/SPEC.md`: what to build (v1 scope, roles, acceptance scenarios).
- `docs/lib-001-split/ARCHITECTURE.md`: stack, data model, money and rounding rules, debt simplification, API, auth, Docker.
- `docs/lib-001-split/BUILD_PLAN.md`: milestones M0–M6 with checklists.

**How I want you to work**
1. After copying, read all four docs. Then tell me in a few bullets anything that is contradictory, risky or
   outdated (for example a library that isn't maintained any more or has changed its API); check current
   docs before relying on any library. Propose fixes, then wait for my OK on anything that changes scope or the stack.
2. Build milestone by milestone, starting with M0. Don't start a milestone until the previous one meets its "Done when" and is committed.
3. Money must be exactly right: integer minor units only, the single allocation rule in ARCHITECTURE.md §5.2,
   the pairwise method in §5.5, and the property tests in §5.6. If you find a case the docs don't cover,
   write it down as an ADR in `docs/adr/` and tell me.
4. Clean-room: never copy Splitwise's code, assets, text or branding; build from public behavior only.
5. Keep the BUILD_PLAN.md checkboxes up to date, and create `CLAUDE.md` in M0 so future sessions can pick up where you left off.
6. At the end of each milestone, give me a short summary: what works, how to run it, what's next, and any decisions I need to make.

Start by copying the docs, then give me your review.
