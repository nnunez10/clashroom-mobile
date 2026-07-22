# Claim Pipeline Architecture

Read-only audit of the current claim extraction/verification/presentation pipeline, and the
proposed (not yet approved) insertion point for Strengthen. See
`docs/product/CURRENT_STATE.md` for the broader implemented/partial/planned breakdown and
`docs/product/DECISIONS.md` for guardrails.

## Call chain: transcript line → verified, presented claim

This is the live path (transcript-extracted claims), orchestrated by
`lib/clashbot/useMockClashBotEngine.ts`:

1. **Extraction** — `lib/clashbot/extractClaims.ts`: `extractClaimsFromLine()` scores/filters
   transcript sentences into `Claim` objects; `lib/clashbot/claimDna.ts`: `getClaimFingerprint()`
   dedupes.
2. **Known-fact short-circuit** — `lib/clashbot/knownFacts.ts`: `findKnownFactOverride()`; on a
   hit, goes straight to `verificationService.ts`: `buildOverrideVerification()`, skipping
   providers entirely.
3. **Verify entry** — `lib/clashbot/verify.ts`: `verifyClaimText(text)` sanitizes text, rejects
   too-short input, then calls `lib/clashbot/claimIntent.ts`: `classifyClaimIntent()` for
   category/domain/worthiness. Below `WORTHINESS_THRESHOLD` (0.2) → immediate `no_match`, **no
   network call**.
4. **Provider fallback** — `lib/clashbot/providers/router.ts`: `routeVerification(text, intent)`
   fans out `googleFactCheckSearch → tavilySearch → serpApiSearch → bingNewsSearch →
   newsApiSearch` with domain/temporal-aware ordering, returns a raw `VerificationResult`
   (matched/no_match/error, no stance yet).
5. **Enrichment** — `lib/clashbot/verificationService.ts`: `buildVerificationFromResult()` calls
   `assessRelevance`, `classifyClaimStance`, `computeConfidence`, `deriveReasonCode`,
   `buildVerdictTrace`, `buildDisplayVerdict`, plus `clusterEvidence()`
   (`evidenceClustering.ts`) and `getResultMeta()` (`resultExplanation.ts`).
6. **Presentation** — `lib/clashbot/statusPresentation.ts`: `getStatusPresentation(status,
   stance, reasonCode)` → `{ label, styleKey, reasonCode }`, consumed by `getStatusBadge()` in
   `components/clashbot/ClashBotSheet.tsx`.

**A separate direct-submit fast path** exists: `useMockClashBotEngine.ts`: `submitDirectClaim`
calls `lib/clashbot/subjectiveClash.ts`: `isSubjectiveClaim()`/`invertSubjectiveClaim()` directly,
bypassing `verifyClaimText`/`claimIntent.ts` entirely for claims typed or confirmed by the user.

`router.ts` and `verificationService.ts` are **two sequential stages, not a wrapper relationship**
— neither imports the other. `router.ts` only decides which external API wins and returns a raw
result; `verificationService.ts` (per its own header comment, "moved verbatim from
`useMockClashBotEngine.ts`") takes that raw result and computes stance/confidence/reasonCode/
display verdict. It is consumed only by `useMockClashBotEngine.ts` and (in principle, once
finished) `lib/claim/claimCardService.ts`.

## Status / stance / reasonCode presentation rules

- `lib/claim/types.ts` holds canonical domain types (`ClaimStatus`, `Stance`, `ReasonCode`,
  `VerificationOutcome`, `EvidenceRecord`); `lib/clashbot/types.ts` holds the raw provider result
  shape (`VerificationResult`, no stance).
- **Fail-closed rule (hard requirement):** `matched + contradicted` → label "Contradicted"
  (`statusDisputed` style) — never leaks as green "Matched". `matched + unclear` → "Unconfirmed"
  (`statusUnconfirmed` style). Transient states (checking, queued) and terminal-no-result states
  (no_match, error) are stance-immune.
- **"Contradicted" vs "Disputed" are intentionally distinct labels** sharing the same visual
  style: "Contradicted" = a fact-checker actively found the claim false (matched + contradicted
  stance); "Disputed" = an engine-level dispute signal. Do not collapse these into one label.
- `reasonCode` (`authoritative_contradiction/support`, `coverage_contradiction/support`,
  `mixed_evidence`, `insufficient_evidence`, `source_not_relevant`, `no_reliable_match`,
  `provider_error`) is annotation only — it never changes the label or styleKey.

## Known duplication in the classification layer

Two independent overlaps exist today (see `docs/product/CURRENT_STATE.md` §7 for the risk
framing):

1. `subjectiveClash.ts` (`isSubjectiveClaim`) and `claimIntent.ts` (`SUBJECTIVE_MARKERS`) both
   detect opinion/comparison language with near-identical word lists, maintained separately, and
   reachable via different call paths — so the same claim text can be classified two different
   ways depending on whether it arrives via direct submit or transcript extraction.
2. `extractClaims.ts` (`scoreSentence`/`looksLikeClaim`) and `claimIntent.ts`
   (`classifyClaimIntent`) both re-implement "is this an opinion/chatter/question" heuristics
   with overlapping junk-phrase lists and different thresholds.

Any Strengthen work that needs "is this a fact, an opinion, or an unsupported assertion"
classification **should not add a third implementation of this** — see the insertion point below.

## Proposed safest insertion point for Strengthen (not yet approved)

Strengthen's job is statement-level weakness detection and wording assistance, distinct from
claim-level truth verification. The safest integration keeps it a **separate, bounded, read-only
consumer** of the existing pipeline rather than a modification to it:

- **`lib/clashbot/verify.ts`** — do not modify. This is the narrow verification entry point;
  Strengthen should call it (or its outputs), not change its contract.
- **`lib/clashbot/verificationService.ts`** — do not modify. Strengthen can *read* its enriched
  output (stance, reasonCode, evidence) to decide what counts as "unsupported" or "missing
  context," but should not add statement-analysis logic into this file. It already has one job
  (raw result → verdict); adding statement/wording analysis here would recreate the duplication
  problem described above.
- **New bounded service: `lib/clashbot/strengthenService.ts` (proposed name, not created)** — a
  new, isolated module that:
  - takes a draft statement (and, where available, the claim/verification output already
    produced by the existing pipeline) as input,
  - performs statement-level analysis (fact vs. opinion, unsupported assertion, overbroad/causal
    language, missing context) using **new, purpose-built types** (see
    `docs/roadmap/NEXT_TASKS.md` step 1) rather than reusing or forking `claimIntent.ts`'s
    partial/placeholder classification,
  - has no React dependency and no engine state, matching the existing pattern set by
    `lib/claim/claimCardService.ts`,
  - is called by the UI only after verification has run — never before, per the guardrail that
    evidence checking precedes persuasive rewriting.

This keeps Strengthen decoupled from the verification pipeline's internals, avoids adding a third
classification system, and keeps the existing `verify.ts`/`verificationService.ts` contract
stable for every other caller (`useMockClashBotEngine.ts`, and eventually
`claimCardService.ts`).

No code for `strengthenService.ts` exists yet. Creating it is gated on the ordered queue in
`docs/roadmap/NEXT_TASKS.md`.
