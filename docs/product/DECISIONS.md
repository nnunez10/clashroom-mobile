# Decisions

Standing decisions and guardrails for ClashRoom's evidence/Strengthen direction. These bind
future agent work in this repo. They supplement, and must not contradict, the non-negotiable
rules in `AGENTS.md`.

## Guardrails

- **No broad refactors without justification.** Consistent with `AGENTS.md`'s "avoid unnecessary
  refactors" / "minimal safe diffs" rules. A known risk (e.g. duplicate classification systems,
  see `docs/product/CURRENT_STATE.md`) is not by itself authorization to refactor it — that
  requires an explicit decision here first.
- **No package installs without explicit approval.** Do not add dependencies to build Strengthen
  or any other feature without asking first.
- **No `.env` or local settings commits.** `.env` and `.claude/settings.local.json` are
  local-only and must never be staged or committed by an agent.
- **No agent-invented product decisions.** Product direction comes from
  `docs/product/NORTH_STAR.md` and explicit user instruction, not from an agent's inference about
  what would be good to build next. If the right next step isn't already decided, stop and ask —
  see `NEEDS_PRODUCT_DECISION` below.
- **No AI truth-god framing.** ClashRoom presents evidence and transparent reasoning; it does not
  present itself as a unilateral, unappealable authority on truth. This applies to UI copy,
  verdict language, and any Strengthen output.
- **Evidence checking must precede persuasive rewriting.** Strengthen may never make an
  unsupported or false claim sound more convincing before that claim has been run through the
  existing verification pipeline (`lib/clashbot/verify.ts` → `verificationService.ts`). See
  `docs/architecture/CLAIM_PIPELINE.md` for where Strengthen is allowed to hook in.
- **Cross-app overlay is a long-term direction, not an approved build.** ClashBubble remains the
  long-term outward-facing product surface (see `docs/product/NORTH_STAR.md`), but a production
  cross-app overlay — an Android system-wide floating bubble, or iOS alternatives such as share
  extensions, selected-text actions, keyboards, or Shortcuts — is not currently approved for
  implementation. The present in-app `ClashBotWidget.tsx` bubble is the validation surface for
  this idea, not a mandate to build the cross-app version. Nothing should ever be captured
  without intentional user action.

## Agent stop states

Any agent working in this repository should end its turn in one of these states:

- **`READY_FOR_REVIEW`** — work is complete, scoped as requested, and verifiable (diff shown,
  typecheck/tests run as applicable).
- **`BLOCKED`** — an external dependency (device connectivity, missing credentials, environment
  issue) prevents completing the task; no code/doc changes were made beyond what was explicitly
  requested.
- **`TEST_FAILURE`** — typecheck, lint, or test run failed; do not proceed to commit.
- **`NEEDS_PRODUCT_DECISION`** — the task requires a product call not yet made in
  `docs/product/NORTH_STAR.md` or `docs/product/DECISIONS.md` (e.g. "should Strengthen output be
  auto-applied or shown as a suggestion?"). Stop and ask rather than inventing an answer.

## Decision log

- **2026-07-21 — Speech confirmation shipped (commit `9ace8da`).** Recognized speech is now
  staged for user confirmation (Verify Claim / Edit Text / Try Again) before verification fires,
  rather than auto-submitting. Typed Quick Verify was deliberately left unchanged — this was a
  scoped fix, not a redesign of the confirmation model across both input paths. Whether typed
  input should get the same confirmation step is an open product question, not decided here.
- **Strengthen: no product code approved yet.** As of this document, no Strengthen
  implementation exists in the repository (verified by repo-wide search). The ordered build queue
  in `docs/roadmap/NEXT_TASKS.md` is the only approved sequencing, and even step 1 of that queue
  requires confirmation before code is written.
