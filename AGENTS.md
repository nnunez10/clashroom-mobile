# ClashRoom AI Engineering Rules

You are working on ClashRoom, a real-time debate + truth verification social app.

This is NOT a generic app. This is a **competitive, social system**.

---

## CORE PRODUCT RULE (NON-NEGOTIABLE)

The app must always reinforce this loop:

Post → React → Challenge → Defend → Win/Lose → Return

If a change does not improve this loop → do NOT prioritize it.

---

## ENGINEERING PRIORITIES (ORDER MATTERS)

1. Retention (users come back)
2. Engagement (users respond)
3. Speed (fast feedback)
4. Social pressure (win/lose matters)
5. Clean code (only after above)

---

## SYSTEM ARCHITECTURE RULES

* Claims are first-class objects
* Verification flows through services, NOT UI
* Evidence must always be traceable
* Do NOT tightly couple systems
* Avoid rewriting working logic

---

## WORKING STYLE (CRITICAL)

When making changes:

1. Analyze current flow first
2. Modify the smallest possible surface area
3. Reuse existing systems
4. Preserve backward compatibility
5. Avoid unnecessary refactors

---

## CHANGE SAFETY RULES

* Do NOT break existing flows
* Do NOT remove fields from types
* Do NOT rename existing keys without necessity
* Do NOT change function signatures unless required
* Always preserve backward compatibility

If unsure:
Ask before making the change.

---

## DO NOT DO THESE

* Do NOT rewrite entire files unless explicitly asked
* Do NOT introduce large abstractions
* Do NOT overengineer
* Do NOT change working systems unnecessarily
* Do NOT add complexity without clear product value

---

## PREFERRED RESPONSE FORMAT

When implementing changes:

1. Explain briefly why the change matters
2. List exact files being modified
3. Provide minimal diffs
4. Explain what to test

Keep responses:

* concise
* direct
* implementation-focused

---

## CURRENT SYSTEM CONTEXT

Core engine:

* useMockClashBotEngine.ts → orchestration layer

Logic systems:

* behaviorEngine.ts → rewards/losses
* verdictEngine.ts → verdict display logic
* claimDna.ts → normalization, fingerprinting, grouping

UI:

* ClashBotSheet.tsx → main interaction surface

---

## CURRENT GOAL

We are building the **core addictive loop**, not polishing UI.

Focus on:

* challenges
* defending claims
* win/loss outcomes
* user pressure

---

## UI PERSONALITY

* bold
* competitive
* emotional
* fast
* punchy

Avoid:

* generic UI
* enterprise style
* over-componentization

---

## FINAL RULE

ClashRoom is:

* a social product first
* a truth system second
* a competition engine underneath

Every change must support that.

---

## CORE LOOP ENFORCEMENT

Before making any change, ask:

Does this improve or reinforce:
Post → React → Challenge → Defend → Win/Lose → Return?

If NOT:

* Do NOT prioritize it
* Do NOT expand scope
* Do NOT introduce new systems

Favor simplicity over completeness.

---

## Multi-Agent Workflow

This repository may be worked on by multiple AI coding agents.

Important:

* Preserve architectural consistency
* Do not rewrite systems unnecessarily
* Prefer incremental improvements
* Respect existing engine boundaries

Claude Code is typically used for:

* architecture
* deep reasoning
* complex engine work

Codex is typically used for:

* implementation
* scoped feature work
* debugging
* incremental edits

Always optimize for:

* minimal safe diffs
* preserving working behavior
* maintainability
