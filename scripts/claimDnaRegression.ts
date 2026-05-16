// scripts/claimDnaRegression.ts
// Deterministic regression harness for ClaimDNA semantics.
// Run with: npx tsx scripts/claimDnaRegression.ts

import {
  areClaimsInSameFamily,
  getClaimDna,
  getClaimFamilyFingerprint,
} from "../lib/clashbot/claimDna";

// ── helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  if (ok) passed++; else failed++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) console.log(`         expected ${expected}, got ${actual}`);
}

function inspect(a: string, b: string) {
  const dnaA = getClaimDna(a);
  const dnaB = getClaimDna(b);
  console.log(`  A: "${a}"`);
  console.log(`     normalized:        ${dnaA.normalized}`);
  console.log(`     meaningfulTokens:  [${dnaA.meaningfulTokens.join(", ")}]`);
  console.log(`     familyFingerprint: ${dnaA.familyFingerprint}`);
  console.log(`  B: "${b}"`);
  console.log(`     normalized:        ${dnaB.normalized}`);
  console.log(`     meaningfulTokens:  [${dnaB.meaningfulTokens.join(", ")}]`);
  console.log(`     familyFingerprint: ${dnaB.familyFingerprint}`);
  const result = areClaimsInSameFamily(a, b);
  console.log(`  areClaimsInSameFamily → ${result}`);
  return result;
}

function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ── NEGATION: explicit 'not' ──────────────────────────────────────────────────

section("NEGATION — explicit 'not'");
{
  const a = "vaccines cause autism";
  const b = "vaccines do not cause autism";
  const fpA = getClaimFamilyFingerprint(a);
  const fpB = getClaimFamilyFingerprint(b);
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is false", result, false);
  assert("family fingerprints differ", fpA !== fpB, true);
}

// ── NEGATION: contraction ─────────────────────────────────────────────────────

section("NEGATION — contraction (don't)");
{
  const a = "vaccines don't cause autism";
  const b = "vaccines cause autism";
  // Note: normalizeClaimText strips apostrophes, so "don't" becomes "dont"
  // in meaningfulTokens — a second line of defence even if the regex failed.
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is false", result, false);
}

// ── NEGATION: flat earth ──────────────────────────────────────────────────────

section("FLAT EARTH — explicit negation");
{
  const a = "the Earth is flat";
  const b = "the Earth is not flat";
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is false", result, false);
}

// ── DIRECTIONAL: basic subject/object flip ────────────────────────────────────

section("DIRECTIONAL — basic subject/object flip (Lakers/Warriors)");
{
  const a = "Lakers beat Warriors";
  const b = "Warriors beat Lakers";
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is false", result, false);
}

// ── DIRECTIONAL: flip with trailing detail ────────────────────────────────────

section("DIRECTIONAL — flip with trailing detail");
{
  const a = "Lakers beat Warriors convincingly";
  const b = "Warriors beat Lakers";
  // "convincingly" appears in afterA but not afterB.
  // objectMatch threshold (0.5) is still met since "warrior" overlaps.
  // The directional flip is correctly detected despite the asymmetric detail.
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is false (trailing detail does not save collapse)", result, false);
}

// ── DIRECTIONAL: legal verb (sued) ───────────────────────────────────────────

section("DIRECTIONAL — legal verb (sued): active flip");
{
  const a = "Samsung sued Apple";
  const b = "Apple sued Samsung";
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is false", result, false);
}

// ── PASSIVE: same claim, passive construction ─────────────────────────────────

section("PASSIVE — passive construction is a paraphrase, not a flip");
{
  const a = "Apple was sued by Samsung";
  const b = "Samsung sued Apple";
  // "was" and "by" trigger the passive guard → directional check skipped.
  // Family fingerprints: both reduce to [apple, samsung, sued] → same family.
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is true (passive = same claim)", result, true);
}

// ── DIRECTIONAL: political verb (endorsed) ────────────────────────────────────

section("DIRECTIONAL — political verb (endorsed)");
{
  const a = "Biden endorsed Harris";
  const b = "Harris endorsed Biden";
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is false", result, false);
}

// ── DIRECTIONAL: acquisition verb (bought) ───────────────────────────────────

section("DIRECTIONAL — acquisition verb (bought)");
{
  const a = "Microsoft bought Activision";
  const b = "Activision bought Microsoft";
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is false", result, false);
}

// ── PARAPHRASE REGRESSION: 'actually' adverb ─────────────────────────────────

section("PARAPHRASE REGRESSION — hedge adverb ('actually')");
{
  const a = "the Earth is flat";
  const b = "Earth is actually flat";
  // 'actually' is a stopword; both reduce to [earth, flat] → same family.
  // No directional verb present → guard does not fire.
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is true (paraphrase unaffected)", result, true);
}

// ── PARAPHRASE REGRESSION: same direction, no collapse interference ───────────

section("PARAPHRASE REGRESSION — same direction not incorrectly split");
{
  const a = "Lakers beat Warriors";
  const b = "the Lakers beat Warriors";
  // Identical normalized text → normalized === path → returns true before
  // directional guard even runs. "the" is stripped by normalizeClaimText.
  const result = inspect(a, b);
  assert("areClaimsInSameFamily is true (same direction stays merged)", result, true);
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log("═".repeat(60));

if (failed > 0) process.exit(1);
