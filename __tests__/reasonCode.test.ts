/**
 * Tests for deriveReasonCode — the diagnostic layer on top of stance.
 *
 * These tests cover the three target scenarios the badge layer needs:
 *   mixed_evidence       — sources disagree (contradicted AND supported signals)
 *   insufficient_evidence — signals present but too weak (single low-weight source,
 *                           or matches with no rating text)
 *   no_reliable_match    — no source found (no_match status)
 *
 * Plus: authoritative vs coverage distinction, source_not_relevant, provider_error.
 */
import { deriveReasonCode } from "@/lib/clashbot/verificationService";

// Helpers to build minimal mock result shapes
const matchedResult = (matches: object[]) => ({ status: "matched", matches });
const relevant = { relevant: true, reason: "Shared entity." };
const notRelevant = { relevant: false, reason: "Weak overlap." };

describe("deriveReasonCode", () => {
  // ── three primary scenarios ───────────────────────────────────────────────
  describe("mixed_evidence", () => {
    it("unclear + both contradiction and support rating signals → mixed_evidence", () => {
      const result = matchedResult([
        { provider: "google_factcheck", rating: { text: "False" } },
        { provider: "google_factcheck", rating: { text: "True" } },
      ]);
      expect(deriveReasonCode("unclear", "matched", result, relevant)).toBe("mixed_evidence");
    });

    it("unclear + fact-check says false AND news says true → mixed_evidence", () => {
      const result = matchedResult([
        { provider: "google_factcheck", rating: { text: "Pants on fire" } },
        { provider: "newsapi", rating: { text: "Confirmed" } },
      ]);
      expect(deriveReasonCode("unclear", "matched", result, relevant)).toBe("mixed_evidence");
    });
  });

  describe("insufficient_evidence", () => {
    it("unclear + single low-weight source with contradiction signal → insufficient_evidence", () => {
      // newsapi weight=1, threshold=2 — score doesn't reach threshold
      const result = matchedResult([
        { provider: "newsapi", rating: { text: "False" } },
      ]);
      expect(deriveReasonCode("unclear", "matched", result, relevant)).toBe("insufficient_evidence");
    });

    it("unclear + single low-weight source with support signal → insufficient_evidence", () => {
      const result = matchedResult([
        { provider: "newsapi", rating: { text: "True" } },
      ]);
      expect(deriveReasonCode("unclear", "matched", result, relevant)).toBe("insufficient_evidence");
    });

    it("unclear + matches present but no rating text → insufficient_evidence", () => {
      const result = matchedResult([
        { provider: "newsapi", title: "Article with no rating" },
        { provider: "newsapi", title: "Another article" },
      ]);
      expect(deriveReasonCode("unclear", "matched", result, relevant)).toBe("insufficient_evidence");
    });
  });

  describe("no_reliable_match", () => {
    it("no_match status → no_reliable_match regardless of stance", () => {
      expect(deriveReasonCode("unclear", "no_match", { matches: [] }, notRelevant)).toBe("no_reliable_match");
    });

    it("no_match status + undefined assessment → no_reliable_match", () => {
      expect(deriveReasonCode("unclear", "no_match", {}, undefined)).toBe("no_reliable_match");
    });
  });

  // ── authoritative vs coverage distinction ────────────────────────────────
  describe("authoritative vs coverage", () => {
    it("contradicted + google_factcheck top → authoritative_contradiction", () => {
      const result = matchedResult([
        { provider: "google_factcheck", rating: { text: "False" } },
      ]);
      expect(deriveReasonCode("contradicted", "matched", result, relevant)).toBe("authoritative_contradiction");
    });

    it("contradicted + known_fact_override top → authoritative_contradiction", () => {
      const result = matchedResult([
        { provider: "known_fact_override", rating: { text: "Contradicted" } },
      ]);
      expect(deriveReasonCode("contradicted", "matched", result, relevant)).toBe("authoritative_contradiction");
    });

    it("contradicted + newsapi top → coverage_contradiction", () => {
      const result = matchedResult([
        { provider: "newsapi", rating: { text: "False" } },
      ]);
      expect(deriveReasonCode("contradicted", "matched", result, relevant)).toBe("coverage_contradiction");
    });

    it("supported + google_factcheck top → authoritative_support", () => {
      const result = matchedResult([
        { provider: "google_factcheck", rating: { text: "True" } },
      ]);
      expect(deriveReasonCode("supported", "matched", result, relevant)).toBe("authoritative_support");
    });

    it("supported + bing_news top → coverage_support", () => {
      const result = matchedResult([
        { provider: "bing_news", rating: { text: "Confirmed" } },
      ]);
      expect(deriveReasonCode("supported", "matched", result, relevant)).toBe("coverage_support");
    });
  });

  // ── source relevance ──────────────────────────────────────────────────────
  describe("source_not_relevant", () => {
    it("matched status + relevant=false → source_not_relevant (overrides signal inspection)", () => {
      const result = matchedResult([
        { provider: "newsapi", rating: { text: "False" } },
      ]);
      expect(deriveReasonCode("unclear", "matched", result, notRelevant)).toBe("source_not_relevant");
    });
  });

  // ── error paths ───────────────────────────────────────────────────────────
  describe("provider_error", () => {
    it("error status → provider_error", () => {
      expect(deriveReasonCode("unclear", "error", {}, undefined)).toBe("provider_error");
    });

    it("error status takes priority over assessment", () => {
      expect(deriveReasonCode("unclear", "error", {}, relevant)).toBe("provider_error");
    });
  });
});
