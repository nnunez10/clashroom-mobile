# Next Tasks

**No Strengthen product code is currently approved.** Every task below is sequenced but none is
authorized to start without an explicit go-ahead — see `docs/product/DECISIONS.md` for guardrails
and agent stop states. If asked to "build Strengthen" without specifying which step, stop and
return `NEEDS_PRODUCT_DECISION`.

## Ordered queue

1. **Define bounded statement-analysis types.** New types scoped to statement/wording analysis
   (fact vs. opinion, unsupported-assertion flag, overbroad/causal-language flag, missing-context
   flag). Must not reuse or extend `lib/clashbot/claimIntent.ts` — that module is already
   documented as provisional/placeholder scaffolding (see
   `docs/architecture/CLAIM_PIPELINE.md`) and duplicating classification logic is a known,
   named risk.
2. **Add deterministic weakness detection.** Rule/heuristic-based (not model-based) detection of
   the weaknesses the new types describe. Deterministic first, so behavior is testable and
   explainable before anything probabilistic is introduced.
3. **Map existing evidence to factual statement components.** Connect weakness detection to the
   evidence already produced by `lib/clashbot/verificationService.ts` (stance, reasonCode,
   evidence clusters) — reuse, don't reclassify.
4. **Add a minimal, non-persistent Strengthen result surface.** UI that shows detected weaknesses
   and available evidence for the current draft. Explicitly non-persistent at this stage — no
   Saved ClaimCard integration yet.
5. **Add constrained stronger wording only after the prior behavior is validated.** Wording
   suggestions come last, and only after steps 1–4 are validated against real usage. Constrained
   means: wording only, never adds unsupported certainty, never proceeds ahead of evidence
   checking (see guardrails in `docs/product/DECISIONS.md`).
6. **Consider persistence in Saved ClaimCards only after UX validation.** Whether/how Strengthen
   output becomes part of the `SavedClaimCard` record (`lib/claim/savedCard.ts`) is an open
   product question, deliberately deferred until the non-persistent surface (step 4) has been
   used and evaluated.

## Notes for implementers

- Proposed (not yet created) home for this work: `lib/clashbot/strengthenService.ts`. See
  `docs/architecture/CLAIM_PIPELINE.md` for why that's the safest insertion point relative to
  `verify.ts` and `verificationService.ts`.
- Each step above should land as its own reviewable change, not bundled — consistent with
  `AGENTS.md`'s "minimal safe diffs" rule.
- End every work session on this queue in one of the stop states defined in
  `docs/product/DECISIONS.md`: `READY_FOR_REVIEW`, `BLOCKED`, `TEST_FAILURE`, or
  `NEEDS_PRODUCT_DECISION`.
