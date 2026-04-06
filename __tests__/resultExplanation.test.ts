/**
 * Tests for getResultExplanation — human-readable sentence from pipeline signals.
 *
 * Decision order under test:
 *   1. Transient → null
 *   2. Infrastructure failure
 *   3. No match
 *   4. Source found but irrelevant
 *   5a. Mixed evidence
 *   5b. Insufficient evidence
 *   6. Contradicted (authoritative → coverage → fallback)
 *   7. Supported (authoritative → coverage → fallback)
 *   8. Unknown combination → null
 */
import { getResultExplanation } from "@/lib/clashbot/resultExplanation";

// ---------------------------------------------------------------------------
// 1. Transient states → null
// ---------------------------------------------------------------------------

describe("transient states", () => {
  it("returns null when status is undefined", () => {
    expect(getResultExplanation({})).toBeNull();
  });

  it("returns null when status is 'queued'", () => {
    expect(getResultExplanation({ status: "queued" })).toBeNull();
  });

  it("returns null when status is 'checking'", () => {
    expect(getResultExplanation({ status: "checking" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Infrastructure failure
// ---------------------------------------------------------------------------

describe("infrastructure failure", () => {
  it("returns failure sentence when status is 'error'", () => {
    expect(getResultExplanation({ status: "error" })).toBe(
      "Verification could not complete."
    );
  });

  it("returns failure sentence when reasonCode is 'provider_error'", () => {
    expect(
      getResultExplanation({ status: "matched", reasonCode: "provider_error" })
    ).toBe("Verification could not complete.");
  });
});

// ---------------------------------------------------------------------------
// 3. No matching source
// ---------------------------------------------------------------------------

describe("no matching source", () => {
  it("returns no-match sentence when status is 'no_match'", () => {
    expect(getResultExplanation({ status: "no_match" })).toBe(
      "No reliable matching source was found."
    );
  });

  it("returns no-match sentence when reasonCode is 'no_reliable_match'", () => {
    expect(
      getResultExplanation({ status: "matched", reasonCode: "no_reliable_match" })
    ).toBe("No reliable matching source was found.");
  });
});

// ---------------------------------------------------------------------------
// 4. Source not relevant
// ---------------------------------------------------------------------------

describe("source not relevant", () => {
  it("returns not-relevant sentence when reasonCode is 'source_not_relevant'", () => {
    expect(
      getResultExplanation({ status: "matched", reasonCode: "source_not_relevant" })
    ).toBe("A source was found but doesn't closely match this claim.");
  });
});

// ---------------------------------------------------------------------------
// 5a. Mixed evidence
// ---------------------------------------------------------------------------

describe("mixed evidence", () => {
  it("returns disagreement sentence when reasonCode is 'mixed_evidence'", () => {
    expect(
      getResultExplanation({ status: "disputed", reasonCode: "mixed_evidence" })
    ).toBe("Relevant sources disagree, so the verdict remains unclear.");
  });
});

// ---------------------------------------------------------------------------
// 5b. Insufficient evidence
// ---------------------------------------------------------------------------

describe("insufficient evidence", () => {
  it("returns weak-signal sentence when reasonCode is 'insufficient_evidence'", () => {
    expect(
      getResultExplanation({ status: "disputed", reasonCode: "insufficient_evidence" })
    ).toBe("Sources were found, but the signals are too weak to confirm a verdict.");
  });
});

// ---------------------------------------------------------------------------
// 6. Contradicted
// ---------------------------------------------------------------------------

describe("contradicted — authoritative_contradiction", () => {
  it("returns high-confidence sentence when confidenceTier is 'high'", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "contradicted",
        reasonCode: "authoritative_contradiction",
        confidenceTier: "high",
      })
    ).toBe("High-confidence contradiction from an authoritative fact-check.");
  });

  it("returns standard authoritative sentence when confidenceTier is 'medium'", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "contradicted",
        reasonCode: "authoritative_contradiction",
        confidenceTier: "medium",
      })
    ).toBe("A fact-check source contradicts this claim.");
  });

  it("returns standard authoritative sentence when confidenceTier is absent", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "contradicted",
        reasonCode: "authoritative_contradiction",
      })
    ).toBe("A fact-check source contradicts this claim.");
  });
});

describe("contradicted — coverage_contradiction", () => {
  it("returns multi-source sentence when representativeCount >= 2", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "contradicted",
        reasonCode: "coverage_contradiction",
        representativeCount: 2,
      })
    ).toBe("Multiple independent sources contradict this claim.");
  });

  it("returns single-source sentence when representativeCount is 1", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "contradicted",
        reasonCode: "coverage_contradiction",
        representativeCount: 1,
      })
    ).toBe("A news source contradicts this claim, though evidence is not authoritative.");
  });

  it("returns single-source sentence when representativeCount is omitted (defaults to 0)", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "contradicted",
        reasonCode: "coverage_contradiction",
      })
    ).toBe("A news source contradicts this claim, though evidence is not authoritative.");
  });
});

describe("contradicted — fallback (no specific reasonCode)", () => {
  it("returns generic contradiction sentence", () => {
    expect(
      getResultExplanation({ status: "matched", stance: "contradicted" })
    ).toBe("This claim appears to be contradicted by available sources.");
  });
});

// ---------------------------------------------------------------------------
// 7. Supported
// ---------------------------------------------------------------------------

describe("supported — authoritative_support", () => {
  it("returns high-confidence sentence when confidenceTier is 'high'", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "supported",
        reasonCode: "authoritative_support",
        confidenceTier: "high",
      })
    ).toBe("High-confidence support from an authoritative fact-check.");
  });

  it("returns standard authoritative sentence when confidenceTier is 'low'", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "supported",
        reasonCode: "authoritative_support",
        confidenceTier: "low",
      })
    ).toBe("A fact-check source supports this claim.");
  });
});

describe("supported — coverage_support", () => {
  it("returns multi-source sentence when representativeCount >= 2", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "supported",
        reasonCode: "coverage_support",
        representativeCount: 3,
      })
    ).toBe("Several relevant sources support this claim.");
  });

  it("returns single-source sentence when representativeCount is 1", () => {
    expect(
      getResultExplanation({
        status: "matched",
        stance: "supported",
        reasonCode: "coverage_support",
        representativeCount: 1,
      })
    ).toBe("A news source supports this claim, though evidence is not authoritative.");
  });
});

describe("supported — fallback (no specific reasonCode)", () => {
  it("returns generic support sentence", () => {
    expect(
      getResultExplanation({ status: "matched", stance: "supported" })
    ).toBe("This claim appears to be supported by available sources.");
  });
});

// ---------------------------------------------------------------------------
// 8. Unknown / unhandled combinations → null
// ---------------------------------------------------------------------------

describe("unknown combinations", () => {
  it("returns null for a terminal status with no stance and no reasonCode", () => {
    expect(getResultExplanation({ status: "matched" })).toBeNull();
  });

  it("returns null for status 'disputed' with unclear stance and no reasonCode", () => {
    expect(
      getResultExplanation({ status: "disputed", stance: "unclear" })
    ).toBeNull();
  });
});
