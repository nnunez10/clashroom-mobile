# ClashRoom North Star

## Product identity

ClashRoom is **widget-first, claim-first, truth-layer-first**.

This document describes product direction. It does not authorize implementation — see
[`docs/roadmap/NEXT_TASKS.md`](../roadmap/NEXT_TASKS.md) and
[`docs/product/DECISIONS.md`](DECISIONS.md) for what is actually approved to build.

This North Star **refines** — it does not replace — the non-negotiable core loop defined in
`AGENTS.md`:

> Post → React → Challenge → Defend → Win/Lose → Return

That competitive loop remains the retention/engagement engine. Everything below describes what
feeds *into* that loop and what the evidence layer underneath it should feel like.

## Current loop

See, hear, read, or write a claim
→ ClashBubble / Verify Anything
→ extract and classify
→ verify with transparent evidence
→ explain or strengthen
→ evidence receipt / ClaimCard
→ save, share, or challenge
→ build claim memory and reputation.

## Strategic refinement: help users say things they can defend

"Verify Anything" remains the evidence engine — that does not change.

The emerging consumer experience layered on top is closer to **Grammarly for claims and
arguments** than a fact-checking utility:

- separate facts from opinions
- detect unsupported assertions
- flag overly broad or causal language
- identify missing context
- add credible evidence
- show reasonable counterarguments
- strengthen wording without erasing the user's voice
- never make unsupported content merely more persuasive

The last two points are the load-bearing constraint on this whole direction: **Strengthen edits
wording, not truth.** It is not permitted to make a false or unsupported claim sound more
convincing. Evidence checking must always precede any persuasive rewriting — see the guardrails
in [`DECISIONS.md`](DECISIONS.md).

## The ClaimCard is not going away

The ClaimCard remains the evidence receipt and shareable object. Strengthen is an *input-time*
assistant (help the user say something defensible before/while they submit it); the ClaimCard is
the *output-time* artifact (the record of what was checked and what was found). These are
complementary, not competing, surfaces.

## ClashBubble: the long-term outward-facing surface

ClashBubble remains the long-term primary outward-facing product surface for ClashRoom — not a
transitional UI element inside the app. The intent is for it to be available wherever a user
encounters or composes a claim: while talking, reading, watching, posting, messaging, or arguing,
not only while the ClashRoom app happens to be open.

The app itself is the **command center**: saved claims, evidence receipts (ClaimCards),
challenges, and reputation live and are managed there. ClashBubble is the point of contact where
claims are caught in the moment; the app is where they're organized, defended, and built into a
record over time.

The current in-app floating bubble (`components/ClashBotWidget.tsx`) is the **validation
surface** for this idea, not the final product boundary. It proves the interaction model inside
the one screen the app currently has; it is not the end state of where ClashBubble should live.

Where this goes next differs by platform, because the platforms themselves differ:

- **Android** may eventually support a true floating, cross-app overlay — a bubble available on
  top of other apps system-wide.
- **iOS** does not allow that kind of overlay, so it will require platform-supported
  alternatives instead: share extensions, selected-text actions, custom keyboards, or Shortcuts
  integration.
- Platform implementations may differ in mechanism while preserving the same underlying
  claim-intelligence capability (extract, classify, verify, strengthen) — the point is consistent
  capability, not identical UI across platforms.

**Hard constraint on this direction:** nothing should ever be captured without intentional user
action. No passive listening, reading, or screen capture across other apps — every claim
ClashBubble sees must come from something the user deliberately did (a tap, a selection, a share,
a shortcut invocation).

**A production cross-app overlay is not currently approved for implementation.** This section
describes long-term product direction, not a build authorization — see
[`docs/product/DECISIONS.md`](DECISIONS.md) and
[`docs/roadmap/NEXT_TASKS.md`](../roadmap/NEXT_TASKS.md) for what is actually approved to build.

## What ClashRoom is not

- Not an "AI truth-god" — it presents evidence and transparent reasoning, it does not declare
  unilateral final verdicts as an authority. See the fail-closed presentation rule in
  [`docs/architecture/CLAIM_PIPELINE.md`](../architecture/CLAIM_PIPELINE.md).
- Not a generic writing assistant — every Grammarly-for-claims feature is claim/argument-scoped,
  not general prose editing.
