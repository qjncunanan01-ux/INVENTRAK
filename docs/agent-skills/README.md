# Agent Skills (vendored)

Instruction sets from third-party agent-skill repositories, vetted and copied in as
plain Markdown so any agent or contributor working on INVENTRAK can follow them.

**None of these are installed plugins.** Freebuff, Claude Code, Codex and Cursor each
load skills differently, and this repo has no plugin loader. These are reference
documents. If you want one active in a real harness, copy it into that harness's
skills directory.

Vendored 2026-10-03. Content under each attribution header is unmodified upstream
text; only the HTML comment header was added.

## What's here

| File | What it governs | Upstream |
|---|---|---|
| [yagni-minimal-change.md](yagni-minimal-change.md) | Write the least code that works. The 7-rung ladder, root-cause-not-symptom fixes, and when *not* to be lazy. | dietrichgebert/ponytail |
| [evidence-before-claims.md](evidence-before-claims.md) | No "tests pass" / "build is green" without having run the command in this same message. | obra/superpowers |
| [code-review-five-axes.md](code-review-five-axes.md) | Correctness, readability, architecture, security, performance — plus change sizing and a review template. | addyosmani/agent-skills |
| [security-hardening.md](security-hardening.md) | Threat-model-first hardening. Trust boundaries, STRIDE, the three-tier boundary system, secrets, SSRF, LLM output. | addyosmani/agent-skills |
| [security-hardening-patterns.md](security-hardening-patterns.md) | Concrete code for each rule above. | addyosmani/agent-skills |
| [security-checklist.md](security-checklist.md) | The pre-sign-off walk. Run this before any demo or capstone submission. | addyosmani/agent-skills |
| [mobile-design-material3.md](mobile-design-material3.md) | Material Design 3 for React Native / Expo. Every rule is tagged so it can be machine-checked. | pbakaus/impeccable |

## Licenses

Full upstream license texts are in [licenses/](licenses/).

| Repo | License | Redistribution obligation |
|---|---|---|
| dietrichgebert/ponytail | MIT | Retain copyright notice |
| obra/superpowers | MIT | Retain copyright notice |
| addyosmani/agent-skills | MIT | Retain copyright notice |
| pbakaus/impeccable | Apache-2.0 | Retain license **and** NOTICE |

`mobile-design-material3.md` carries a second layer: impeccable's `NOTICE.md` records
that its Android/iOS platform references are themselves derived from
[ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills) (MIT).
That NOTICE is preserved at [licenses/NOTICE-impeccable.txt](licenses/NOTICE-impeccable.txt).

This repo is **public**. The attribution headers and `licenses/` directory are not
optional decoration — Apache-2.0 redistribution requires them.

## What was deliberately left out

- **The other 19 agent-skills skills and 13 superpowers skills.** Large overlap with
  each other and with how this repo already works. `test-driven-development` in
  particular duplicates a practice already enforced by the 392-test suite and
  `npm run verify`.
- **Superpowers' subagent-driven-development and worktree skills.** They assume a
  harness with plugin hooks and git worktree management. Not applicable here.
- **impeccable's Rust CLI** (`crates/`, 61 detector rules). A genuine binary, and it
  would be the automated half of [mobile-design-material3.md](mobile-design-material3.md)
  — but it is a program install, not instruction text. Not done.
- **graphify.** A local tree-sitter AST code-graph generator, not a skill. It would
  produce a navigable map of this monorepo (backend + admin + two Expo apps). Needs
  Python + `uv` on Windows. Not installed — see below.
- **thedotmack/claude-mem.** Uploads compressed session context to a third-party
  hosted account. Excluded on privacy grounds, not quality.
- **rebelytics/one-skill-to-rule-them-all** (CC-BY-4.0, "Task Observer"). 7,847 lines
  — a 713-line core plus seven reference files — to watch sessions and write
  observation logs. Rejected: it duplicates what [AGENTS.md](../../AGENTS.md) already
  does in ~130 static lines, and it wants a pinned absolute workspace path, bash-only
  snippets, and session-start hooks. Its one useful part, an 855-line markdown/skill
  validator, was run once as a QA check against the repo (root markdown passes shape
  checks; the only failure is a missing `.claude-plugin/plugin.json`, which this repo
  correctly does not have). Not vendored — running a tool is not redistributing it.
- **diegosouzapw/OmniRoute.** A local LLM proxy on port 20128. Wouldn't change how
  Freebuff selects a model, and adds an unknown hop between us and the provider.

## If you want the actual CLIs

Neither has been installed. Both would run third-party code with your privileges —
read the upstream install path first.

```bash
# Graphify: AST knowledge graph of the repo (Apache-2.0)
uv tool install graphifyy
graphify . --no-viz        # writes graphify-out/{graph.json,GRAPH_REPORT.md}

# Impeccable: 61 deterministic UI detectors, no LLM needed (Apache-2.0)
npx impeccable install
```

Both write output directories. Gitignore them before running.