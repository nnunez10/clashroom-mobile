# Current State

Factual snapshot of what exists in the repository, from a read-only architecture audit. This is
not a plan — see [`docs/roadmap/NEXT_TASKS.md`](../roadmap/NEXT_TASKS.md) for what's next.

Note: `CLAUDE.md`'s architecture summary is out of date in places (e.g. it says
`useMockClashBotEngine.ts` is "not yet wired to HomeScreen" — that is no longer true, see below).
This document reflects the current code, not `CLAUDE.md`.

## 1. Implemented

- **Claim extraction & verification pipeline** (live path): `lib/clashbot/extractClaims.ts` →
  `lib/clashbot/verify.ts` (`verifyClaimText`) → `lib/clashbot/claimIntent.ts`
  (`classifyClaimIntent`, worthiness gate) → `lib/clashbot/providers/router.ts`
  (`routeVerification`, fans out to Google Fact Check → Tavily → SerpAPI → Bing News → NewsAPI) →
  `lib/clashbot/verificationService.ts` (`buildVerificationFromResult`, stance/confidence/
  reasonCode/verdict enrichment) → `lib/clashbot/statusPresentation.ts`
  (`getStatusPresentation`, label/style mapping). Full detail in
  [`docs/architecture/CLAIM_PIPELINE.md`](../architecture/CLAIM_PIPELINE.md).
- **Engine hook wired to the screen**: `lib/clashbot/useMockClashBotEngine.ts` is imported and
  called directly in `app/(tabs)/index.tsx` (`useMockClashBotEngine()`), supplying `transcript`,
  `claims`, `activeClaimsCount`, `bubbleIsChecking`, `submitDirectClaim`, `challengeClaim`,
  `defendClaim`. There is no manual `addClaim` stub.
- **ClashBubble / widget**: `components/ClashBotWidget.tsx` — draggable floating bubble, tone
  (`unverified | checking | verified | disputed`) drives gradient/pulse.
- **Quick Verify sheet**: `components/clashbot/ClashBotSheet.tsx`, `mode="quick_verify"` — text
  or speech claim submission with live status.
- **Speech confirmation**: see dedicated section below.
- **Saved ClaimCards with real persistence**: `lib/claim/savedCard.ts` (`SavedClaimCard` type,
  `snapshotSavedCard()`) + `lib/claim/savedCardStorage.ts` (AsyncStorage-backed,
  `loadSavedCards`/`persistSavedCards`, key `clashroom:saved_cards:v1`, schema-versioned). Wired
  in `app/(tabs)/index.tsx` via a `useEffect` that persists `savedCards` on every change and
  loads on mount.
- **ClaimGraph**: `lib/claim/claimGraph.ts` (`createClaimGraph`) — real in-memory graph (three
  `Map`s: `nodeById`, `familyIndex`, `childrenIndex`) with family clustering, root/child lineage,
  and clash-pair (`supported` vs `contradicted`) lookup. Has unit tests
  (`lib/claim/__tests__/claimGraph.test.ts`). Rehydrated from persisted `SavedClaimCard[]` on app
  start via `graphRef.current.hydrate(cards)`.
- **Challenge/defend/win-loss mechanics**: `lib/clashbot/challengeEngine.ts`
  (`canChallengeClaim`, `issueChallengeOnClaim`, `resolveChallengeDefense`,
  `getChallengeStatus`) wired into `useMockClashBotEngine.ts`; `lib/clashbot/behaviorEngine.ts`
  (`applyLoss`, `applyRecovery`, `shouldIncrementStreak`, `shouldApplyRecovery`) and
  `lib/clashbot/verdictEngine.ts` (`getVerdictLabel`, `getVerdictHit`, `getReactionLine`) wired
  live inside `ClashBotSheet.tsx` (ClashCred, streak, verdict overlay). This is a client-side
  simulated engine, not a networked multiplayer system — the hook's own name
  (`useMockClashBotEngine`) signals that.
- **Claim priority queue**: `lib/clashbot/liveDebateQueue.ts` (`getNextPriorityClaim`,
  `scoreClaim`) — used by the engine hook to pick which queued claim to surface next.
- **Known-fact overrides**: `lib/clashbot/knownFacts.ts` (`findKnownFactOverride`) — short-circuits
  the provider pipeline for a curated list of facts.
- **Subjective-claim clash path**: `lib/clashbot/subjectiveClash.ts` (`isSubjectiveClaim`,
  `invertSubjectiveClaim`) — direct-submit fast path that bypasses verification for
  opinion-shaped claims and produces an inverted debate pair instead.

## 2. Partially implemented

- **`lib/claim/claimCardService.ts`** (`buildClaimCardFromText`) — explicitly incomplete. Only
  the known-fact override branch is implemented; the function's own comment says "Steps 4–6
  (subjective path, API verification, return) not yet implemented" and it **throws** for any
  claim that isn't a known-fact override. It is also **not currently called anywhere** —
  `app/(tabs)/index.tsx` builds saved cards via `snapshotSavedCard()` directly, not through this
  service. Treat this file as a stub, not a used code path.
- **`lib/clashbot/claimIntent.ts`** — its own header comment frames it as provisional
  scaffolding ("designed to be stable under future ClaimDNA evolution... intended hook point for
  attaching richer classification later"), i.e. acknowledged by its author as a placeholder
  pending consolidation into `claimDna.ts`.

## 3. Planned

See the ordered queue in [`docs/roadmap/NEXT_TASKS.md`](../roadmap/NEXT_TASKS.md) — bounded
statement-analysis types, deterministic weakness detection, evidence-to-statement mapping, a
minimal non-persistent Strengthen result surface, then (only after validation) stronger wording
and Saved-ClaimCard persistence for Strengthen output.

## 4. Deferred / explicitly not approved

- **No Strengthen product code exists in the repository.** A repo-wide case-insensitive search
  for "strengthen" returns no matches outside this documentation set. Nothing described in the
  North Star's "Grammarly for claims" section has been implemented.
- **No durable, server-backed reputation system.** Reputation-like signals exist today only as
  local, mock state: ClashCred, streak, recovery, and challenge pressure
  (`lib/clashbot/behaviorEngine.ts`, `verdictEngine.ts`, `challengeEngine.ts`), split across
  `useMockClashBotEngine.ts` (auto-loss timer path) and `ClashBotSheet.tsx` (challenge
  win/loss/recovery path) — see the split-state-ownership risk in §7. None of this amounts to a
  durable, account-level, synchronized, server-backed reputation system, and the current behavior
  should not be represented as production-ready. A repo-wide search for the literal word
  "reputation" returns zero matches — the term itself is not used anywhere in code.
- **No backend/network persistence beyond the fact-check providers.** No Supabase, Firebase, or
  custom REST backend was found. Everything except the read-only fact-check API calls is
  client-local. ClashCred, streak, challenge state, and ClaimGraph are in-memory only and reset on
  app restart; only `SavedClaimCard[]` persists (via AsyncStorage).
- **Persuasive rewriting ahead of evidence checking** — explicitly out of scope, see guardrails in
  [`DECISIONS.md`](DECISIONS.md).

## 5. Speech confirmation (completed feature, commit `9ace8da`)

Commit `9ace8da` ("Add speech confirmation before claim verification") changed the speech path so
recognized speech is staged for user confirmation before verification fires, instead of
auto-submitting.

- `app/(tabs)/index.tsx`: `commitSpeechDraft()` now sets `speechConfirmDraft` state and opens the
  Quick Verify sheet with no seed, instead of calling `handleDirectSubmit`/`openQuickVerify`
  immediately. Three new handlers: `handleSpeechConfirm(text)` (submits via
  `handleDirectSubmit` + `pendingQuickClaim`), `handleSpeechEdit(text)` (clears the draft, pushes
  text into the home composer's `quickDraft`, and calls `closeSheet()` so the home input is
  reachable), `handleSpeechRetry()` (clears state, closes the sheet, resets the voice hint).
- `components/clashbot/ClashBotSheet.tsx`: new optional props (`speechConfirmDraft`,
  `onSpeechConfirm`, `onSpeechEdit`, `onSpeechRetry`) and a confirm-card render block ("I heard:
  {text}" + Verify Claim / Edit Text / Try Again buttons) inside `mode="quick_verify"`, above
  `QuickVerifyStatus`.
- Typed Quick Verify (`quickDraft` → `submitQuickVerify`) is unchanged — it still submits
  immediately with no confirmation step. This asymmetry (speech confirms, typed input doesn't) is
  intentional per the implemented scope, not a bug, but is worth a product decision if it should
  be unified later.
- Physical-device verification of this feature is pending (blocked on Android device
  connectivity as of this writing) — see manual test checklist delivered separately in
  conversation, not duplicated here.

## 6. Exact file map (major files only)

| Area | File | Key exports |
|---|---|---|
| Screen | `app/(tabs)/index.tsx` | `HomeScreen` |
| Widget | `components/ClashBotWidget.tsx` | `ClashBotWidget` |
| Sheet UI | `components/clashbot/ClashBotSheet.tsx` | `ClashBotSheet`, `QuickVerifyStatus` |
| Card detail UI | `components/clashbot/ClaimCardDetail.tsx` | `ClaimCardDetail` |
| Engine hook | `lib/clashbot/useMockClashBotEngine.ts` | `useMockClashBotEngine` |
| Verify entry | `lib/clashbot/verify.ts` | `verifyClaimText` |
| Verdict/stance enrichment | `lib/clashbot/verificationService.ts` | `buildVerificationFromResult`, `buildOverrideVerification`, `buildExceptionVerification`, `classifyClaimStance`, `deriveReasonCode`, `computeConfidence` |
| Provider fallback | `lib/clashbot/providers/router.ts` | `routeVerification` |
| Providers | `lib/clashbot/providers/{googleFactCheck,newsapi,serpapi,tavily,bingnews}.ts` | one search fn each |
| Claim extraction | `lib/clashbot/extractClaims.ts` | `extractClaimsFromLine`, `claimFingerprint` |
| Intent/worthiness | `lib/clashbot/claimIntent.ts` | `classifyClaimIntent` |
| Claim DNA/fingerprint | `lib/clashbot/claimDna.ts` | `getClaimDna`, `getClaimFingerprint`, `areClaimsInSameFamily` |
| Subjective clash | `lib/clashbot/subjectiveClash.ts` | `isSubjectiveClaim`, `invertSubjectiveClaim` |
| Known facts | `lib/clashbot/knownFacts.ts` | `findKnownFactOverride` |
| Status labels | `lib/clashbot/statusPresentation.ts` | `getStatusPresentation` |
| Behavior/scoring | `lib/clashbot/behaviorEngine.ts`, `verdictEngine.ts`, `challengeEngine.ts`, `liveDebateQueue.ts` | see §1 |
| Saved cards | `lib/claim/savedCard.ts`, `lib/claim/savedCardStorage.ts` | `SavedClaimCard`, `snapshotSavedCard`, `loadSavedCards`, `persistSavedCards` |
| ClaimCard service (stub) | `lib/claim/claimCardService.ts` | `buildClaimCardFromText` (incomplete) |
| Claim graph | `lib/claim/claimGraph.ts` | `createClaimGraph` |
| Canonical domain types | `lib/claim/types.ts` | `ClaimStatus`, `Stance`, `ReasonCode`, `VerificationOutcome`, `EvidenceRecord` |

## 7. Technical risks

- **Duplicate classification systems.** `subjectiveClash.ts` (`isSubjectiveClaim`) and
  `claimIntent.ts` (`SUBJECTIVE_MARKERS`) independently detect near-identical
  opinion/comparison patterns, maintained separately, and produce **different outcomes for the
  same claim text** depending on which path it enters through (direct-submit vs.
  transcript-extracted). Similarly, `extractClaims.ts` (`scoreSentence`/`looksLikeClaim`) and
  `claimIntent.ts` (`classifyClaimIntent`) both re-implement "is this an opinion/chatter/
  question" heuristics with overlapping junk-phrase lists and different thresholds.
- **Split state ownership.** ClashCred is tracked as two independent `useState` counters — one
  in `useMockClashBotEngine.ts` (updated by an auto-loss timer) and one in `ClashBotSheet.tsx`
  (updated by challenge win/loss/recovery) — with no prop connecting them. They can silently
  drift apart. Streak/recovery/escalation state lives only in `ClashBotSheet.tsx`, derived ad hoc
  from props rather than computed by the engine.
- **Incomplete ClaimCard service.** `lib/claim/claimCardService.ts` throws for any non-override
  claim and is unused by the app; saved-card construction happens via a different, more direct
  path (`snapshotSavedCard` called straight from `app/(tabs)/index.tsx`).
- **Tightly coupled `ClashBotSheet.tsx`.** ~4,000 lines. While claim verification/triggering
  stays in the hook/lib layer (the component never calls `verifyClaimText` or
  `extractClaimsFromLine` directly), the component owns a parallel gamification state layer
  (ClashCred, streak, recovery, escalation, verdict overlay) and calls `behaviorEngine.ts`/
  `verdictEngine.ts` directly rather than receiving that state as props. It also declares its own
  local `ClaimItem`/`VerificationResult` types instead of importing the engine's `EngineClaim`/
  canonical types — the two type definitions must be kept in sync by hand, with no mapping
  function and no compile-time guarantee they match (structural typing papers over drift).
- **Local-only ClaimGraph; no production reputation system.** ClaimGraph is rebuilt in memory
  every app start from persisted `SavedClaimCard[]` — it is not itself serialized, and there is
  no server sync. Reputation-like presentation (ClashCred, streak, recovery, challenge pressure)
  exists only as local/mock state split between `useMockClashBotEngine.ts` and
  `ClashBotSheet.tsx` (see §4); there is no durable, account-level, synchronized reputation
  system, and none of the current behavior should be treated as production-ready.
- **Missing integration coverage.** The repository has narrow unit tests only (e.g.
  `lib/claim/__tests__/claimGraph.test.ts`); there is no integration test covering the full
  extract → verify → present pipeline, the engine hook wired to `HomeScreen`, or the new
  speech-confirmation flow. Physical-device testing for the speech flow is still pending as of
  this document.
