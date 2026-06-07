# Quick Verify QA Checklist

Manual QA for the current ClashBubble / Quick Verify / Generated ClaimCard loop.

Core path:
ClashBubble / Verify Anything -> Generated ClaimCard -> Save/Share/Challenge placeholders -> Defend when challenged.

## Setup

- Start from the Home screen.
- Confirm the ClashBubble area shows "Verify Anything" and the Text mode is active.
- Do not rely on real secrets or network-only behavior for pass/fail unless the environment is already configured.

## 1. Text Verify Happy Path

1. Enter a factual claim in the ClashBubble text input.
2. Tap Verify.
3. Confirm the Quick Verify sheet opens.
4. Confirm the submitted claim appears in the result surface.
5. Confirm the claim progresses from queued/checking into a result state.

Pass:
- Text input submits the exact claim.
- The Quick Verify result is tied to the submitted claim.

## 2. Keyboard Dismiss After Verify

1. Focus the Home screen ClashBubble text input.
2. Type a claim.
3. Tap Verify.

Pass:
- The keyboard dismisses after Verify.
- The Quick Verify sheet is visible and usable.
- The keyboard does not cover the result card.

## 3. UNDER CHALLENGE Visibility

1. Verify a factual claim that resolves into a challenged/disputed state.
2. Watch the Quick Verify sheet and dashboard claim list.

Pass:
- UNDER CHALLENGE appears clearly when a pending response exists.
- The challenger identity is visible when available.
- Countdown or response pressure is visible when the claim has a deadline.

## 4. DISPUTED Card Readability And Scrolling

1. Verify a claim that resolves as DISPUTED.
2. Scroll the Quick Verify result.
3. Open the dashboard and scroll the related claim family/card.

Pass:
- DISPUTED is readable without overlap.
- Claim text, result, and evidence are not clipped.
- UNDER CHALLENGE and DISPUTED content scroll together cleanly.

## 5. Generated ClaimCard Framing

1. Submit a claim through ClashBubble / Verify Anything.
2. Wait for the Quick Verify result.

Pass:
- The result is framed as "Generated ClaimCard."
- The hierarchy is clear: status/result first, claim text next, receipts/evidence after.
- Placeholder actions do not look like completed real features.

## 6. Evidence Receipts Rendering

1. Submit a claim that produces evidence.
2. Inspect the Generated ClaimCard evidence area.

Pass:
- "Evidence receipts" appears when verification data exists.
- Publisher/date metadata renders when available.
- Source rows are readable.
- Tapping a source opens only when a source URL exists.

## Session-Only Save/Saved ClaimCards

1. Submit a claim through ClashBubble / Verify Anything.
2. Wait for the Generated ClaimCard to render.
3. Tap Save card.
4. Tap Saved again.
5. Save one claim, then verify or inspect another claim.
6. Close and reopen the Quick Verify sheet during the same app session.
7. Restart the app.

Pass:
- Save card toggles to Saved.
- Saved toggles back to Save card.
- Saved state applies only to the selected claim.
- Saved state survives sheet close/reopen during the same app session.
- Saved state does not need to persist after app restart yet.
- Share soon and Challenge soon remain inert placeholders.
- Evidence receipts remain readable after saving.
- Subjective/opinion ClaimCards can be saved without credibility side effects.

## 7. Defend Your Claim Flow

1. Trigger a challenged claim.
2. Tap Defend your claim.
3. Confirm the dashboard input switches into defense mode.
4. Submit a defense.

Pass:
- The input is visibly in defense mode.
- The challenged claim context remains visible.
- Submitting creates a defense claim linked to the challenged claim family.
- The original pending defense clears after successful defense submission.

## 8. Expired Challenge Not Showing As Defended

1. Trigger a timed challenged claim.
2. Let the response deadline expire without defending.
3. Inspect the claim and its event state.

Pass:
- The expired challenge is treated as unresolved/expired, not defended.
- Credibility impact applies only where appropriate.
- The UI does not show a successful defense state for an expired challenge.

## 9. Subjective Claim Safety

1. Submit an opinion/subjective claim.
2. Trigger or inspect the resulting clash state.

Pass:
- Subjective claims are not treated as factual verification failures.
- Subjective claims are protected from credibility loss.
- UI language frames the result as opinion/take/clash, not factual defeat.

## 10. Duplicate Claim Cooldown Behavior

1. Submit a claim.
2. Submit the same claim again immediately.
3. Submit a related but not identical claim.

Pass:
- Exact duplicate submissions are blocked or cooled down as expected.
- If the duplicate is defending a pending challenged family, the pending defense can resolve correctly.
- Related claims attach to the existing claim family when appropriate.

## Regression Guard

After any Quick Verify or ClaimCard UI change, confirm:

- Normal text verification still works.
- Dashboard non-defense submit still works.
- Defend submit still calls the defense path.
- Save/Share/Challenge/Link/Screenshot placeholders remain non-functional unless intentionally implemented.
