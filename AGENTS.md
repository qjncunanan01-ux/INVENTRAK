# AGENTS.md

Working agreements for AI agents and contributors on INVENTRAK. Read this before
editing. It records the things that are **non-obvious about this repo** — the ones
you would otherwise learn the hard way.

## What this is

A four-app inventory system with a real backend.

| Path | What it is | Runtime driver |
|---|---|---|
| `backend/` | Express API, the only place business rules live | SQLite (default), Supabase, or Firestore |
| `frontend-admin/` | Vite + React admin console, approvals queue | — |
| `staff-client/` | Expo app for warehouse staff | — |
| `mobile-client/` | Expo app for customers | — |

**Business logic goes in `backend/`.** If a rule is enforceable server-side, enforce
it server-side. The phone apps are thin; do not add authorization decisions to them.

## The one rule that bites hardest

**`backend/openapi.json` is the contract, and the clients are generated. Never hand-edit
any `api.generated.js`.**

```
backend/openapi.json  ──npm run client:generate──▶  */src/api.generated.js
```

`npm run verify` runs `client:check`, which fails if the generated clients have drifted
from the spec. So the real workflow when changing an endpoint is:

1. Edit the route in `backend/src/routes/`
2. Update the schema in `backend/openapi.json`
3. `cd backend && npm run client:generate`
4. Run `npm run verify`

Skipping step 2 is the most common way to break this build. `npm run spec:audit` also
flags routes that exist but aren't in the spec.

## Verify before you claim anything

Full detail in [docs/agent-skills/evidence-before-claims.md](docs/agent-skills/evidence-before-claims.md).
The short version: **do not write "tests pass" or "build is green" unless you ran the
command in this same message and read the output.** No "should", no "probably", no
relying on a previous run.

Pick the narrowest command that proves the claim, but run it completely:

```bash
cd backend && npm run verify        # docs:validate + spec:audit + client:check + 497 tests
cd backend && npm test              # just the suite
cd frontend-admin && npm test       # vitest
cd frontend-admin && npm run build  # catches what vitest misses
```

`backend` has no build step — it runs directly on Node. The Expo apps are validated by
Metro export, not a test suite:

```bash
cd staff-client && npx expo export --platform android   # also: mobile-client
```

## Deploy reality

- **EAS cloud Android builds are quota-blocked until 1 Oct 2026.** Don't try to fix a
  cloud build failure; it's the account, not the project. Use the local path in
  [mobile-client/LOCAL-BUILD.md](mobile-client/LOCAL-BUILD.md) instead.
- `mobile-client/android/` is CNG-generated and git-ignored. Build tooling is committed
  as scripts and docs, never as the native directory. Don't try to commit it.
- Backend deploys wipe the container filesystem. **Any state that must survive a deploy
  belongs in Supabase/Firestore, not SQLite.** See `backend/src/audit.js` and
  [DEPLOY.md](DEPLOY.md) — the durable audit sink derives itself from the Supabase driver
  config, so it needs no env vars; only the `audit_log` table has to exist. Check it with
  `GET /api/meta` → `.audit.enabled`.
- Changing a route's shape without redeploying the backend and the clients that consume
  it is the single most expensive mistake available in this repo.

## Writing code

Full detail in [docs/agent-skills/yagni-minimal-change.md](docs/agent-skills/yagni-minimal-change.md).

- **The ladder:** does this need to exist → is it already in this codebase → stdlib →
  native platform → already-installed dependency → one line → only then, the minimum.
- **Root cause, not symptom.** Before editing a function, grep its callers. One guard in
  the shared function beats a guard in every caller. Patching only the path a bug report
  names leaves every sibling caller still broken.
- **Never add a dependency for something a few lines can do.** This repo already runs
  deliberately few third-party packages, and `backend/` has a working npm-free mode.
- **Don't simplify away:** input validation at trust boundaries, auth checks, error
  handling that prevents data loss, accessibility basics, anything explicitly requested.

Two of those root-cause fixes have already paid off in this repo — see the comment
accident in `backend/src/routes/approvals.js` and the early-return/TDZ crashes in the
mobile QR screens. Both looked like single-line fixes and were not.

## Security

Full detail in [docs/agent-skills/security-hardening.md](docs/agent-skills/security-hardening.md),
with [security-checklist.md](docs/agent-skills/security-checklist.md) as the pre-sign-off walk.

- **Authenticate *and* authorize every protected route.** Authentication is not
  authorization: the caller must own or be permitted on the specific resource.
- Role checks are not decorative. `staff` / `admin` / `owner` / `superadmin` have
  distinct capabilities and the tests in `backend/src/test/staff-roles.test.js` and
  `roles.test.js` enforce them.
- **Never commit secrets.** `mobile-client/.keystore/`, `.env*`, and `*.apk` are all
  git-ignored for a reason. A secret that reaches a remote is compromised — rotate it
  first, then purge history.
- Parameterize every query. These are SQLite statements; string-concatenated input is
  injection.
- Before any demo or capstone submission, walk `security-checklist.md` end to end.

## Mobile UI

Full detail in [docs/agent-skills/mobile-design-material3.md](docs/agent-skills/mobile-design-material3.md).
Every rule in that file is tagged, and it names React Native and Expo explicitly.

**Every screen in this repo must work without a working camera.** The demo devices have
a broken camera and the EAS quota is blocked, so the phone camera is not a testable
input. Manual code entry is a first-class path on both phone apps, not a fallback bolted
on afterwards — keep it that way when adding screens.

## Reviews

[docs/agent-skills/code-review-five-axes.md](docs/agent-skills/code-review-five-axes.md)
covers the five axes. Two INVENTRAK-specific ones worth stating outright:

- **Scope small.** Most good changes here touch a handful of files. A change touching
  five directories is usually several changes.
- **Never commit or push without being asked.** Leaving work uncommitted for review is
  the expected end state.

## Third-party skill repositories

[docs/agent-skills/](docs/agent-skills/README.md) holds vetted instruction sets copied in
from four upstream repos (MIT / Apache-2.0, attribution preserved). Read them as
reference — nothing is installed or auto-loaded, and this repo has no plugin loader.
Before adding another, follow the vetting process in that README.