/**
 * Tests for normalizeClaimInput — conservative surface normalization.
 *
 * Core invariants under test:
 *   1. raw is always verbatim (trimmed only)
 *   2. Whitespace and punctuation noise is cleaned in normalized
 *   3. Function-word transposition typos are fixed
 *   4. Numbers, dates, named entities, and semantic content are never altered
 *   5. Normalized form improves family matching under input noise
 */
import { normalizeClaimInput } from "@/lib/clashbot/normalizeInput";
import { areClaimsInSameFamily } from "@/lib/clashbot/claimDna";

// ---------------------------------------------------------------------------
// 1. Whitespace and punctuation normalization
// ---------------------------------------------------------------------------

describe("whitespace and punctuation normalization", () => {
  it("collapses repeated internal whitespace", () => {
    const r = normalizeClaimInput("vaccines   cause  autism");
    expect(r.normalized).toBe("vaccines cause autism");
  });

  it("trims surrounding whitespace from both raw and normalized", () => {
    const r = normalizeClaimInput("  vaccines cause autism  ");
    expect(r.raw).toBe("vaccines cause autism");
    expect(r.normalized).toBe("vaccines cause autism");
  });

  it("strips trailing exclamation mark", () => {
    expect(normalizeClaimInput("vaccines cause autism!").normalized).toBe("vaccines cause autism");
  });

  it("strips leading and trailing double-quotes", () => {
    expect(normalizeClaimInput('"vaccines cause autism"').normalized).toBe("vaccines cause autism");
  });

  it("collapses three exclamation marks to one then strips", () => {
    expect(normalizeClaimInput("vaccines cause autism!!!").normalized).toBe("vaccines cause autism");
  });

  it("collapses repeated question marks", () => {
    expect(normalizeClaimInput("Vaccines are safe???").normalized).toBe("Vaccines are safe");
  });

  it("strips leading punctuation noise", () => {
    expect(normalizeClaimInput("!!! vaccines are dangerous").normalized).toBe(
      "vaccines are dangerous"
    );
  });

  it("raw is verbatim (only trimmed) — normalization does not mutate raw", () => {
    const r = normalizeClaimInput("  teh vaccines cause autism!!!  ");
    expect(r.raw).toBe("teh vaccines cause autism!!!");
    expect(r.normalized).toBe("the vaccines cause autism");
  });

  it("empty string returns empty raw and normalized", () => {
    const r = normalizeClaimInput("");
    expect(r.raw).toBe("");
    expect(r.normalized).toBe("");
  });

  it("whitespace-only input normalizes to empty string", () => {
    const r = normalizeClaimInput("   ");
    expect(r.raw).toBe("");
    expect(r.normalized).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 2. Function-word typo correction
// ---------------------------------------------------------------------------

describe("function-word typo correction", () => {
  it("fixes lowercase 'teh' → 'the'", () => {
    expect(normalizeClaimInput("teh earth is flat").normalized).toBe("the earth is flat");
  });

  it("fixes title-case 'Teh' at sentence start → 'The'", () => {
    expect(normalizeClaimInput("Teh earth is flat").normalized).toBe("The earth is flat");
  });

  it("fixes 'hte' → 'the'", () => {
    expect(normalizeClaimInput("hte COVID vaccine is effective").normalized).toBe(
      "the COVID vaccine is effective"
    );
  });

  it("fixes 'adn' → 'and'", () => {
    expect(normalizeClaimInput("vaccines adn autism are unrelated").normalized).toBe(
      "vaccines and autism are unrelated"
    );
  });

  it("fixes 'taht' → 'that'", () => {
    expect(normalizeClaimInput("studies show taht vaccines are safe").normalized).toBe(
      "studies show that vaccines are safe"
    );
  });

  it("fixes 'nad' → 'and'", () => {
    expect(normalizeClaimInput("salt nad sugar cause obesity").normalized).toBe(
      "salt and sugar cause obesity"
    );
  });

  it("fixes 'htat' → 'that'", () => {
    expect(normalizeClaimInput("evidence suggests htat the earth is warming").normalized).toBe(
      "evidence suggests that the earth is warming"
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Semantic meaning and named entities are never altered
// ---------------------------------------------------------------------------

describe("semantic meaning and named entities preserved", () => {
  it("does not alter numbers or percentages", () => {
    const r = normalizeClaimInput("COVID-19 vaccines have 95% efficacy in 2021");
    expect(r.normalized).toBe("COVID-19 vaccines have 95% efficacy in 2021");
  });

  it("does not alter all-caps entities (NASA)", () => {
    // 'teh' fixed; 'NASA' left untouched
    const r = normalizeClaimInput("NASA faked teh moon landing");
    expect(r.normalized).toBe("NASA faked the moon landing");
  });

  it("word-boundary guard: typo substring inside a longer word is never touched", () => {
    // "Tehran" contains "teh" but has no word boundary after "teh" within the word
    const r = normalizeClaimInput("Tehran is the capital of Iran");
    expect(r.normalized).toBe("Tehran is the capital of Iran");
  });

  it("does not alter a negation word", () => {
    expect(normalizeClaimInput("vaccines are NOT dangerous").normalized).toBe(
      "vaccines are NOT dangerous"
    );
  });

  it("does not alter dates", () => {
    const r = normalizeClaimInput("Climate change has accelerated since 1950");
    expect(r.normalized).toBe("Climate change has accelerated since 1950");
  });

  it("preserves hyphenated compound terms (COVID-19)", () => {
    const r = normalizeClaimInput("COVID-19 is a novel coronavirus");
    expect(r.normalized).toBe("COVID-19 is a novel coronavirus");
  });

  it("preserves contractions (apostrophe retained)", () => {
    const r = normalizeClaimInput("Vaccines don't cause autism");
    expect(r.normalized).toBe("Vaccines don't cause autism");
  });

  it("does not alter content words — only function-word whitelist applies", () => {
    // "Canada" contains "nad" but word-boundary guard prevents match
    const r = normalizeClaimInput("Canada has universal healthcare");
    expect(r.normalized).toBe("Canada has universal healthcare");
  });
});

// ---------------------------------------------------------------------------
// 4. Family matching under input noise
// ---------------------------------------------------------------------------

describe("family matching under input noise", () => {
  it("function-word typo does not break family matching", () => {
    const { normalized: a } = normalizeClaimInput("teh earth is flat");
    const { normalized: b } = normalizeClaimInput("the Earth is flat");
    expect(areClaimsInSameFamily(a, b)).toBe(true);
  });

  it("trailing punctuation noise does not break family matching", () => {
    const { normalized: a } = normalizeClaimInput("vaccines cause autism!!!");
    const { normalized: b } = normalizeClaimInput("vaccines cause autism");
    expect(areClaimsInSameFamily(a, b)).toBe(true);
  });

  it("repeated whitespace does not break family matching", () => {
    const { normalized: a } = normalizeClaimInput("vaccines   cause  autism");
    const { normalized: b } = normalizeClaimInput("vaccines cause autism");
    expect(areClaimsInSameFamily(a, b)).toBe(true);
  });

  it("combined typo + punctuation do not break family matching", () => {
    const { normalized: a } = normalizeClaimInput("teh vaccines cause autism!!!");
    const { normalized: b } = normalizeClaimInput("vaccines cause autism");
    expect(areClaimsInSameFamily(a, b)).toBe(true);
  });

  it("semantically distinct claims are not collapsed into the same family", () => {
    const { normalized: a } = normalizeClaimInput("vaccines cause autism");
    const { normalized: b } = normalizeClaimInput("climate change is caused by humans");
    expect(areClaimsInSameFamily(a, b)).toBe(false);
  });
});
