# ADR-0010: Web app decisions (M5)

Status: Accepted (2026-10-11). Fills gaps in ARCHITECTURE.md section 8 and departs from its library list in the places below.

## Decisions

1. **Native `<dialog>` instead of shadcn/ui and Radix.** The app needs four modal patterns (confirm, form, conflict, copy a
   link). `<dialog>` with `showModal()` already gives a focus trap, Escape to close, an inert page behind it and the right
   ARIA role, so `ui.tsx` wraps it in about forty lines and the web app has no component-library dependency to keep
   patched. Tailwind 4 is used directly with the portfolio's monochrome tokens (`index.css`). Dialog content is only
   rendered while open, so a closed dialog costs nothing and its text is not in the page.
2. **Plain state and pure form logic instead of react-hook-form.** The expense form's rules are money rules, and those
   live in `@evenly/core`. `features/expenses/formState.ts` is a set of pure functions (`initialState`, `withMethod`,
   `compute`, `createRequest`, `updateRequest`, `isValid`) over one state object, so the preview, the validation and the
   request body can never disagree, and the logic is unit-tested without a DOM. `react-hook-form` would have added a second
   place that holds the values. The sign-up form checks with zod; the server's schema stays the authority.
3. **Amounts are typed in major units and sent in minor units.** The form parses typed text with `parseAmount` for the
   group's currency (`1,234.5` → `123450` for INR, `500` for JPY) and sends integers. For the exact method, each person's
   value is converted the same way, so the API's `value` means minor units for `exact` and a decimal string for `percent`
   and `shares` (ADR-0006).
4. **No optimistic updates.** ARCHITECTURE.md suggested them for new expenses and settlements. A split can be rejected by
   rules the client mirrors but does not own (a member left, a version moved on), and a wrong balance flashing on screen
   in a money app costs more trust than a 100 ms wait saves. Writes show a pending button, then the lists and balances
   refetch (`useRefreshGroup` drops every query that a group change can touch). The create call is idempotent
   (ADR-0009), so a retry after a flaky connection is safe.
5. **`GET /api/v1/config`** (public) tells the sign-up and login pages whether sign-ups are open, invite-only or closed, and
   whether email is configured, so the UI offers only what works (for example, no "Forgot your password?" email form when
   there is no SMTP; it points to the administrator's `reset-password` command).
6. **Conflict dialog.** A `version-conflict` (409) carries the current expense. The dialog lists what differs in words
   (`conflict.ts`), and offers: keep editing, use their version, or save mine on top of theirs (a second PATCH with the
   new version, so it is still a checked write).
7. **Drafts.** An unsaved new expense is kept in `sessionStorage` per group and is dropped once it is saved or no longer
   valid for the group (a member who left). Editing an existing expense is not drafted.
8. **Fonts are self-hosted** (`@fontsource-variable/inter` and `jetbrains-mono`, bundled by Vite). No request leaves for a
   font CDN (no third party learns who uses the app), and the CSP stays Helmet's default with no host added.
9. **Routing.** TanStack Router with code-based routes. Search parameters are validated and typed as optional keys (`{ next?:
string }`), `?next=` accepts only paths that start with a single `/` (no open redirect), and the group page keeps its tab
   in `?tab=activity` so a reload or a shared link lands on the same tab. The router's `basepath` and every API call come
   from `lib/basePath.ts` (ADR-0005).
10. **Tests.** Web unit and component tests run in Vitest with happy-dom and Testing Library (form logic, the API client,
    formatting, activity and conflict wording, the split editor, dialogs). End-to-end tests are Playwright, in
    `e2e/`, run by `scripts/e2e.sh` against the built Docker image at `/` and at `/evenly`: SPEC.md scenarios 1 to 10 as one
    story with separate browser contexts per person, a reload on a deep link, the settle-up screen with simplify debts off,
    axe-core (WCAG A and AA, light and dark) on every main screen, and a 375px overflow check. The `e2e` package has no
    `test` script on purpose: `pnpm test` stays free of Docker and browsers. Sign-ups are limited to five a minute per
    address, so the suite signs up four people and runs once per fresh container.

## Consequences

- A new modal uses `Dialog` or `ConfirmDialog`; do not add a dialog library.
- Money in the web app goes through `@evenly/core` (`parseAmount`, `formatMinor`, `computeSplit`) via `formState.ts` and
  `lib/format.ts`; never `Number(text) * 100`.
- A new screen should be added to the axe and overflow lists in `e2e/tests/scenarios.spec.ts`.
