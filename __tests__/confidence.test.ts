/**
 * Tests for computeConfidence — calibrated, conservative scoring.
 *
 * Design contract:
 *   high   ≥ 70  — authoritative source, clear stance, relevant
 *   medium ≥ 40  — coverage source with clear stance, or authoritative with caveats
 *   low    ≥ 10  — weak signals, unclear stance, relevance concerns
 *   none   <  10 — no match, error, no usable evidence
 *
 * Fail-low rules verified explicitly:
 *   - unclear stance is capped at 35 regardless of provider quality
 *   - not-relevant penalises enough to prevent medium even for authoritative sources
 *   - no_match and error always return {0, "none"}
 */
import { computeConfidence } from "@/lib/clashbot/verificationService";

const relevant   = { relevant: true,  reason: "Shared entity." };
const notRelevant = { relevant: false, reason: "Weak overlap." };

const googleMatch   = (rating = "False") => ({ matches: [{ provider: "google_factcheck",    rating: { text: rating } }] });
const overrideMatch = (rating = "Contradicted") => ({ matches: [{ provider: "known_fact_override", rating: { text: rating } }] });
const newsMatch     = (rating = "False") => ({ matches: [{ provider: "newsapi",             rating: { text: rating } }] });
const noRatingMatch = () => ({ matches: [{ provider: "newsapi", title: "Some article" }] });
const emptyResult   = () => ({ matches: [] });

describe("computeConfidence", () => {
  // ── high tier ─────────────────────────────────────────────────────────────
  describe("high tier (≥70)", () => {
    it("known_fact_override + contradicted + relevant → high", () => {
      const { confidenceTier, confidenceScore } = computeConfidence(
        "contradicted", "matched", overrideMatch("Contradicted"), relevant
      );
      expect(confidenceTier).toBe("high");
      expect(confidenceScore).toBeGreaterThanOrEqual(70);
    });

    it("known_fact_override + supported + relevant → high", () => {
      const { confidenceTier } = computeConfidence(
        "supported", "matched", overrideMatch("Supported"), relevant
      );
      expect(confidenceTier).toBe("high");
    });

    it("google_factcheck + contradicted + relevant → high", () => {
      const { confidenceTier, confidenceScore } = computeConfidence(
        "contradicted", "matched", googleMatch("False"), relevant
      );
      expect(confidenceTier).toBe("high");
      expect(confidenceScore).toBeGreaterThanOrEqual(70);
    });

    it("google_factcheck + supported + relevant → high", () => {
      const { confidenceTier } = computeConfidence(
        "supported", "matched", googleMatch("True"), relevant
      );
      expect(confidenceTier).toBe("high");
    });

    it("google_factcheck + supported + relevant + 2 matches → high", () => {
      const result = { matches: [
        { provider: "google_factcheck", rating: { text: "True" } },
        { provider: "google_factcheck", rating: { text: "Mostly true" } },
      ]};
      const { confidenceTier } = computeConfidence("supported", "matched", result, relevant);
      expect(confidenceTier).toBe("high");
    });
  });

  // ── medium tier ───────────────────────────────────────────────────────────
  describe("medium tier (40–69)", () => {
    it("newsapi + contradicted + relevant + rating → medium", () => {
      const { confidenceTier, confidenceScore } = computeConfidence(
        "contradicted", "matched", newsMatch("False"), relevant
      );
      expect(confidenceTier).toBe("medium");
      expect(confidenceScore).toBeGreaterThanOrEqual(40);
      expect(confidenceScore).toBeLessThan(70);
    });

    it("newsapi + supported + relevant + rating → medium", () => {
      const { confidenceTier } = computeConfidence(
        "supported", "matched", newsMatch("True"), relevant
      );
      expect(confidenceTier).toBe("medium");
    });
  });

  // ── low tier ──────────────────────────────────────────────────────────────
  describe("low tier (10–39)", () => {
    it("google_factcheck + unclear + relevant → low (unclear cap at 35)", () => {
      const { confidenceTier, confidenceScore } = computeConfidence(
        "unclear", "matched", googleMatch(), relevant
      );
      expect(confidenceTier).toBe("low");
      expect(confidenceScore).toBeLessThanOrEqual(35);
    });

    it("newsapi + unclear + relevant → low", () => {
      const { confidenceTier } = computeConfidence(
        "unclear", "matched", newsMatch(), relevant
      );
      expect(confidenceTier).toBe("low");
    });

    it("newsapi + unclear + no rating text → low", () => {
      const { confidenceTier } = computeConfidence(
        "unclear", "matched", noRatingMatch(), relevant
      );
      expect(confidenceTier).toBe("low");
    });

    it("google_factcheck + unclear + mixed evidence → low (mixed penalty + unclear cap)", () => {
      const result = { matches: [
        { provider: "google_factcheck", rating: { text: "False" } },
        { provider: "google_factcheck", rating: { text: "True" } },
      ]};
      const { confidenceTier, confidenceScore } = computeConfidence("unclear", "matched", result, relevant);
      expect(confidenceTier).toBe("low");
      expect(confidenceScore).toBeLessThanOrEqual(35);
    });
  });

  // ── fail-closed: not-relevant blocks medium even for authoritative sources ─
  describe("fail-low: not-relevant penalty", () => {
    it("google_factcheck + supported + NOT relevant → low (not medium)", () => {
      const { confidenceTier } = computeConfidence(
        "supported", "matched", googleMatch("True"), notRelevant
      );
      expect(confidenceTier).toBe("low");
    });

    it("google_factcheck + contradicted + NOT relevant → low", () => {
      const { confidenceTier } = computeConfidence(
        "contradicted", "matched", googleMatch("False"), notRelevant
      );
      expect(confidenceTier).toBe("low");
    });

    it("newsapi + supported + NOT relevant → none", () => {
      const { confidenceTier } = computeConfidence(
        "supported", "matched", newsMatch("True"), notRelevant
      );
      expect(confidenceTier).toBe("none");
    });
  });

  // ── none tier ─────────────────────────────────────────────────────────────
  describe("none tier (<10)", () => {
    it("no_match → {0, none}", () => {
      expect(computeConfidence("unclear", "no_match", emptyResult(), notRelevant)).toEqual({
        confidenceScore: 0, confidenceTier: "none",
      });
    });

    it("error status → {0, none}", () => {
      expect(computeConfidence("unclear", "error", emptyResult(), undefined)).toEqual({
        confidenceScore: 0, confidenceTier: "none",
      });
    });

    it("no_match ignores good-looking result shape", () => {
      const { confidenceTier } = computeConfidence(
        "supported", "no_match", googleMatch("True"), relevant
      );
      expect(confidenceTier).toBe("none");
    });
  });

  // ── score is always clamped [0, 100] ─────────────────────────────────────
  describe("score clamping", () => {
    it("score never exceeds 100", () => {
      const result = { matches: Array(10).fill({ provider: "known_fact_override", rating: { text: "Supported" } }) };
      const { confidenceScore } = computeConfidence("supported", "matched", result, relevant);
      expect(confidenceScore).toBeLessThanOrEqual(100);
    });

    it("score never goes below 0", () => {
      const { confidenceScore } = computeConfidence("unclear", "matched", noRatingMatch(), notRelevant);
      expect(confidenceScore).toBeGreaterThanOrEqual(0);
    });
  });
});
