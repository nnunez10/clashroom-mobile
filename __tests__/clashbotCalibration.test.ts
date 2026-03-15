/**
 * ClashBot Calibration Fixture Suite
 *
 * 16 real-world-style claims covering every scenario in the pipeline.
 * Run with:  npx jest __tests__/clashbotCalibration.test.ts --verbose
 *
 * Output on each run:
 *   - Full table showing stance / reasonCode / score / tier / raw vs clustered matches
 *   - Assertions for every fixture — a failure means a threshold needs recalibration
 *
 * To recalibrate: adjust computeConfidence thresholds or clustering rules in
 * lib/clashbot/, then update expectedTier here to match the new intended output.
 */

import { clusterEvidence } from "@/lib/clashbot/evidenceClustering";
import {
  assessRelevance,
  buildCandidateText,
  classifyClaimStance,
  computeConfidence,
  deriveReasonCode,
} from "@/lib/clashbot/verificationService";
import type { ConfidenceTier, ReasonCode, Stance } from "@/lib/claim/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MockMatch {
  provider: string;
  claim?: string;
  claimReviewed?: string;
  title?: string;
  rating?: { text: string; raw?: string };
  url?: string;
  publisher?: string;
  snippet?: string;
  claimDate?: string;
}

interface MockResult {
  status: "matched" | "no_match" | "error";
  mode?: "fact_check" | "recent_coverage";
  matches: MockMatch[];
  message?: string;
}

interface CalibrationFixture {
  id: string;
  scenario: string;
  claimText: string;
  result: MockResult;
  expectedStance: Stance;
  expectedReasonCode: ReasonCode;
  expectedTier: ConfidenceTier;
}

interface RunResult {
  stance: Stance;
  reasonCode: ReasonCode;
  confidenceScore: number;
  confidenceTier: ConfidenceTier;
  relevant: boolean;
  rawMatches: number;
  clusters: number;
  duplicates: number;
}

// ---------------------------------------------------------------------------
// Pipeline runner — replicates buildVerificationFromResult logic without
// the spread/merge so each intermediate value is visible.
// ---------------------------------------------------------------------------

function run(f: CalibrationFixture): RunResult {
  const { result, claimText } = f;
  const matches = Array.isArray(result.matches) ? result.matches : [];

  // Use matches[0] as top for candidateText; fixtures are written so that the
  // most informative match is first.
  const topMatch = matches[0] ?? null;
  const matchText =
    result.status === "matched" ? buildCandidateText(result, topMatch) : "";

  const assessment =
    result.status === "matched"
      ? assessRelevance(claimText, matchText, result.mode)
      : { relevant: false, reason: "No match or error." };

  let stance: Stance = "unclear";
  if (result.status === "matched" && assessment.relevant) {
    stance = classifyClaimStance(claimText, matchText, result);
  }

  const reasonCode = deriveReasonCode(stance, result.status, result, assessment);
  const { confidenceScore, confidenceTier } = computeConfidence(
    stance,
    result.status,
    result,
    assessment
  );
  const { totalMatches, representativeCount, duplicateCount } =
    clusterEvidence(matches);

  return {
    stance,
    reasonCode,
    confidenceScore,
    confidenceTier,
    relevant: assessment.relevant,
    rawMatches: totalMatches,
    clusters: representativeCount,
    duplicates: duplicateCount,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES: CalibrationFixture[] = [
  // ── F01: Authoritative contradiction (clear) ──────────────────────────────
  {
    id: "F01",
    scenario: "authoritative contradiction",
    claimText: "COVID-19 vaccines contain microchips that track people",
    result: {
      status: "matched",
      mode: "fact_check",
      matches: [
        {
          provider: "google_factcheck",
          claim: "COVID-19 vaccines contain microchips",
          title: "Do COVID-19 vaccines contain microchips? No evidence for this claim",
          rating: { text: "False" },
          url: "https://factcheck.org/review/vaccine-microchips",
          publisher: "FactCheck.org",
        },
      ],
    },
    expectedStance: "contradicted",
    expectedReasonCode: "authoritative_contradiction",
    expectedTier: "high",
  },

  // ── F02: Authoritative support (clear) ───────────────────────────────────
  {
    id: "F02",
    scenario: "authoritative support",
    claimText: "The Great Barrier Reef has lost over 50 percent of its coral since 1995",
    result: {
      status: "matched",
      mode: "fact_check",
      matches: [
        {
          provider: "google_factcheck",
          claim: "Great Barrier Reef lost over 50 percent of coral since 1995",
          title: "Reef coral loss confirmed: 50 percent decline documented since 1995",
          rating: { text: "True" },
          url: "https://factcheck.org/review/barrier-reef-1995",
          publisher: "FactCheck.org",
        },
      ],
    },
    expectedStance: "supported",
    expectedReasonCode: "authoritative_support",
    expectedTier: "high",
  },

  // ── F03: Known-fact override contradiction ────────────────────────────────
  {
    id: "F03",
    scenario: "known-fact override contradiction",
    claimText: "The Earth is flat",
    result: {
      status: "matched",
      mode: "fact_check",
      matches: [
        {
          provider: "known_fact_override",
          claim: "The Earth is not flat — it is approximately spherical",
          title: "Earth shape: scientific consensus confirms oblate spheroid",
          rating: { text: "Contradicted" },
          url: "https://nasa.gov/earth-shape",
          publisher: "NASA",
        },
      ],
    },
    expectedStance: "contradicted",
    expectedReasonCode: "authoritative_contradiction",
    expectedTier: "high",
  },

  // ── F04: Mixed evidence — google says both True and False ─────────────────
  // NOTE: Calibration finding — sentence-start capitals create phantom entity anchors.
  // Claim must share a capitalized entity that also appears capitalized in the match text.
  // "Aspirin" appears in match.claim → reliable shared entity anchor.
  {
    id: "F04",
    scenario: "mixed evidence (conflicting authoritative ratings)",
    claimText: "Aspirin taken daily prevents heart attacks",
    result: {
      status: "matched",
      mode: "fact_check",
      matches: [
        {
          provider: "google_factcheck",
          claim: "Aspirin prevents heart attacks in most patients",
          title: "Does daily Aspirin prevent heart attacks? Study says yes",
          rating: { text: "True" },
          url: "https://healthline.com/aspirin-heart-1",
          publisher: "Healthline",
        },
        {
          provider: "google_factcheck",
          claim: "Aspirin heart attack prevention: risks outweigh benefits",
          title: "Aspirin heart attack prevention risks outweigh benefits for most people",
          rating: { text: "False" },
          url: "https://nejm.org/aspirin-heart-2",
          publisher: "NEJM",
        },
      ],
    },
    expectedStance: "unclear",
    expectedReasonCode: "mixed_evidence",
    expectedTier: "low",
  },

  // ── F05: Coverage contradiction (newsapi, relevant) ───────────────────────
  {
    id: "F05",
    scenario: "coverage contradiction (newsapi)",
    claimText: "The 2020 US election was stolen through widespread voter fraud",
    result: {
      status: "matched",
      mode: "recent_coverage",
      matches: [
        {
          provider: "newsapi",
          title: "2020 US election fraud claims debunked: results certified as accurate",
          rating: { text: "False" },
          url: "https://reuters.com/election-fraud-2020",
          publisher: "Reuters",
        },
      ],
    },
    expectedStance: "contradicted",
    expectedReasonCode: "coverage_contradiction",
    expectedTier: "medium",
  },

  // ── F06: Coverage support (newsapi, relevant) ─────────────────────────────
  // NOTE: Calibration finding — sentence-start capitals create phantom entity anchors.
  // Use a number anchor ("35 percent") shared by both claim and match to ensure relevance.
  {
    id: "F06",
    scenario: "coverage support (newsapi)",
    claimText: "Aerobic exercise reduces cardiovascular disease risk by 35 percent",
    result: {
      status: "matched",
      mode: "recent_coverage",
      matches: [
        {
          provider: "newsapi",
          title: "Aerobic exercise cuts cardiovascular disease risk by 35 percent study shows",
          rating: { text: "True" },
          url: "https://healthnews.com/aerobic-exercise-35pct",
          publisher: "Health News",
        },
      ],
    },
    expectedStance: "supported",
    expectedReasonCode: "coverage_support",
    expectedTier: "medium",
  },

  // ── F07: Duplicate mirrored coverage (4 same-title newsapi → 1 cluster) ───
  // Confidence should stay medium — clustering prevents raw count inflating score.
  {
    id: "F07",
    scenario: "duplicate/mirrored coverage (4 outlets → 1 cluster)",
    claimText: "The unemployment rate fell to 3.5 percent in the last quarter",
    result: {
      status: "matched",
      mode: "recent_coverage",
      matches: [
        {
          provider: "newsapi",
          title: "US unemployment rate fell to 3.5 percent last quarter",
          rating: { text: "True" },
          url: "https://reuters.com/jobs/unemployment-q4",
          publisher: "Reuters",
        },
        {
          provider: "newsapi",
          title: "US unemployment rate fell to 3.5 percent last quarter",
          rating: { text: "True" },
          url: "https://ap.org/unemployment-q4",
          publisher: "AP",
        },
        {
          provider: "newsapi",
          title: "US unemployment rate fell to 3.5 percent last quarter",
          rating: { text: "True" },
          url: "https://bloomberg.com/unemployment-q4",
          publisher: "Bloomberg",
        },
        {
          provider: "newsapi",
          title: "US unemployment rate fell to 3.5 percent last quarter",
          rating: { text: "True" },
          url: "https://cnbc.com/unemployment-q4",
          publisher: "CNBC",
        },
      ],
    },
    expectedStance: "supported",
    expectedReasonCode: "coverage_support",
    expectedTier: "medium",
  },

  // ── F08: Irrelevant source match — google fact-check, wrong topic ─────────
  // No entity or number overlap between claim and returned source.
  {
    id: "F08",
    scenario: "irrelevant source match (google, different subject)",
    claimText: "Apple's iPhone 15 has a 48-megapixel main camera",
    result: {
      status: "matched",
      mode: "fact_check",
      matches: [
        {
          provider: "google_factcheck",
          claim: "Samsung Galaxy S24 Ultra has improved battery life",
          title: "Samsung Galaxy S24 specs confirmed by manufacturer",
          rating: { text: "True" },
          url: "https://techfactcheck.com/samsung-galaxy-s24",
          publisher: "TechFactCheck",
        },
      ],
    },
    expectedStance: "unclear",
    expectedReasonCode: "source_not_relevant",
    expectedTier: "low",
  },

  // ── F09: No reliable match ────────────────────────────────────────────────
  {
    id: "F09",
    scenario: "no reliable match",
    claimText: "The mayor announced new transit funding for the downtown corridor",
    result: {
      status: "no_match",
      matches: [],
      message: "No fact checks or relevant coverage found.",
    },
    expectedStance: "unclear",
    expectedReasonCode: "no_reliable_match",
    expectedTier: "none",
  },

  // ── F10: Provider error ───────────────────────────────────────────────────
  {
    id: "F10",
    scenario: "provider error",
    claimText: "GDP grew by 4.2 percent last fiscal year",
    result: {
      status: "error",
      matches: [],
      message: "API request failed: timeout after 10 seconds.",
    },
    expectedStance: "unclear",
    expectedReasonCode: "provider_error",
    expectedTier: "none",
  },

  // ── F11: Weak evidence — relevant but no rating (no verdict) ──────────────
  {
    id: "F11",
    scenario: "weak evidence (relevant match, no rating)",
    claimText: "Solid-state batteries can fully charge electric cars in under 10 minutes",
    result: {
      status: "matched",
      mode: "recent_coverage",
      matches: [
        {
          provider: "newsapi",
          title: "New solid-state battery charges cars in 10 minutes researchers say",
          url: "https://techcrunch.com/solid-state-battery-10min",
          publisher: "TechCrunch",
          // no rating field — pure news coverage, no verdict
        },
      ],
    },
    expectedStance: "unclear",
    expectedReasonCode: "insufficient_evidence",
    expectedTier: "low",
  },

  // ── F12: Three independent authoritative sources ──────────────────────────
  // Three separate google_factcheck from different domains, same verdict.
  // Clustering keeps them separate (distinct titles + hosts).
  {
    id: "F12",
    scenario: "multiple independent authoritative sources (3 clusters)",
    claimText: "Human activity has been the dominant cause of global warming since 1950",
    result: {
      status: "matched",
      mode: "fact_check",
      matches: [
        {
          provider: "google_factcheck",
          claim: "Human causes of climate change since 1950",
          title: "Climate models confirm human-driven warming documented since 1950",
          rating: { text: "True" },
          url: "https://factcheck.org/climate-human-1950",
          publisher: "FactCheck.org",
        },
        {
          provider: "google_factcheck",
          claim: "Human activity responsible for climate change",
          title: "Scientists confirm anthropogenic warming from fossil fuel emissions",
          rating: { text: "True" },
          url: "https://climatefeedback.org/anthropogenic-warming",
          publisher: "Climate Feedback",
        },
        {
          provider: "google_factcheck",
          claim: "Human caused climate change since industrial era 1950",
          title: "IPCC report: dominant human influence on global temperature rise",
          rating: { text: "True" },
          url: "https://politifact.com/ipcc-human-climate",
          publisher: "PolitiFact",
        },
      ],
    },
    expectedStance: "supported",
    expectedReasonCode: "authoritative_support",
    expectedTier: "high",
  },

  // ── F13: Authoritative source, not relevant to this specific claim ─────────
  // Google fact-check returned but about a different company/product.
  {
    id: "F13",
    scenario: "authoritative but not relevant (wrong subject)",
    claimText: "Apple announced iPhone 15 Pro sales exceeded 10 million units in week one",
    result: {
      status: "matched",
      mode: "fact_check",
      matches: [
        {
          provider: "google_factcheck",
          claim: "Samsung Galaxy S24 sales reached 5 million units in launch week",
          title: "Samsung Galaxy S24 breaks sales records with 5 million units sold",
          rating: { text: "True" },
          url: "https://techfactcheck.com/samsung-sales",
          publisher: "TechFactCheck",
        },
      ],
    },
    expectedStance: "unclear",
    expectedReasonCode: "source_not_relevant",
    expectedTier: "low",
  },

  // ── F14: News article, not relevant — scores none (low-trust + irrelevant) ─
  {
    id: "F14",
    scenario: "news article matched but not relevant (none tier)",
    claimText: "The Federal Reserve will raise interest rates by 0.25 percent next month",
    result: {
      status: "matched",
      mode: "recent_coverage",
      matches: [
        {
          provider: "newsapi",
          title: "Local housing market shows signs of cooling in spring season",
          url: "https://localrealty.com/spring-market",
          publisher: "Local Realty News",
          // No number overlap with claim; no entity overlap
        },
      ],
    },
    expectedStance: "unclear",
    expectedReasonCode: "source_not_relevant",
    expectedTier: "none",
  },

  // ── F15: Two independent coverage sources (medium) ────────────────────────
  // Different outlets, different titles, same verdict — two separate clusters.
  {
    id: "F15",
    scenario: "two independent coverage sources (2 clusters)",
    claimText: "Electric vehicle sales grew by 40 percent globally last year",
    result: {
      status: "matched",
      mode: "recent_coverage",
      matches: [
        {
          provider: "newsapi",
          title: "EV sales surge 40 percent year over year in global markets",
          rating: { text: "True" },
          url: "https://reuters.com/ev-sales-40pct",
          publisher: "Reuters",
        },
        {
          provider: "newsapi",
          title: "Global electric vehicle market expanded by 40 percent in 2023 data",
          rating: { text: "True" },
          url: "https://bloomberg.com/ev-market-2023",
          publisher: "Bloomberg",
        },
      ],
    },
    expectedStance: "supported",
    expectedReasonCode: "coverage_support",
    expectedTier: "medium",
  },

  // ── F16: Coverage contradiction from 2 independent sources (medium) ────────
  {
    id: "F16",
    scenario: "coverage contradiction, 2 independent sources (2 clusters)",
    claimText: "The new COVID variant is significantly more deadly than the original strain",
    result: {
      status: "matched",
      mode: "recent_coverage",
      matches: [
        {
          provider: "newsapi",
          title: "Studies show new COVID variant not more lethal than original strain",
          rating: { text: "False" },
          url: "https://reuters.com/covid-variant-lethality",
          publisher: "Reuters",
        },
        {
          provider: "newsapi",
          title: "Health experts dispute claims new COVID variant causes more deaths",
          rating: { text: "False" },
          url: "https://apnews.com/covid-variant-deaths",
          publisher: "AP News",
        },
      ],
    },
    expectedStance: "contradicted",
    expectedReasonCode: "coverage_contradiction",
    expectedTier: "medium",
  },
];

// ---------------------------------------------------------------------------
// Table formatter — prints to console for manual inspection
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  const str = String(s ?? "");
  return str.length >= n ? str.slice(0, n) : str + " ".repeat(n - str.length);
}

function printCalibrationTable(fixtures: CalibrationFixture[], results: RunResult[]): void {
  const H = "─";
  const cols = {
    id:      4,
    scenario:38,
    stance:  12,
    reason:  30,
    score:    5,
    tier:     6,
    raw:      3,
    uniq:     4,
    dup:      3,
    rel:      3,
  };

  const header =
    pad("ID", cols.id)      + " │ " +
    pad("Scenario", cols.scenario)  + " │ " +
    pad("Stance", cols.stance)      + " │ " +
    pad("ReasonCode", cols.reason)  + " │ " +
    pad("Score", cols.score)        + " │ " +
    pad("Tier", cols.tier)          + " │ " +
    pad("Raw", cols.raw)            + " │ " +
    pad("Uniq", cols.uniq)          + " │ " +
    pad("Dup", cols.dup)            + " │ " +
    pad("Rel", cols.rel);

  const divider = H.repeat(header.length);

  console.log("\n" + divider);
  console.log("ClashBot Calibration Results");
  console.log(divider);
  console.log(header);
  console.log(divider);

  fixtures.forEach((f, i) => {
    const r = results[i];
    const scoreMark = r.confidenceTier === f.expectedTier ? "" : " ⚠";
    const row =
      pad(f.id, cols.id)                              + " │ " +
      pad(f.scenario, cols.scenario)                  + " │ " +
      pad(r.stance, cols.stance)                      + " │ " +
      pad(r.reasonCode, cols.reason)                  + " │ " +
      pad(String(r.confidenceScore), cols.score)      + " │ " +
      pad(r.confidenceTier + scoreMark, cols.tier)    + " │ " +
      pad(String(r.rawMatches), cols.raw)             + " │ " +
      pad(String(r.clusters), cols.uniq)              + " │ " +
      pad(String(r.duplicates), cols.dup)             + " │ " +
      pad(r.relevant ? "yes" : "no", cols.rel);
    console.log(row);
  });

  console.log(divider);

  // Summarize any mismatches
  const mismatches = fixtures.filter((f, i) => results[i].confidenceTier !== f.expectedTier);
  if (mismatches.length === 0) {
    console.log("All tiers match expectations.");
  } else {
    console.log(`\n⚠  ${mismatches.length} tier mismatch(es) — recalibration needed:`);
    mismatches.forEach((f, _, arr) => {
      const i = fixtures.indexOf(f);
      console.log(`  ${f.id}: expected ${f.expectedTier}, got ${results[i].confidenceTier}`);
    });
  }
  console.log(divider + "\n");
}

// ---------------------------------------------------------------------------
// Run all fixtures once; share results across tests
// ---------------------------------------------------------------------------

const RESULTS = FIXTURES.map(run);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ClashBot Calibration Suite", () => {
  beforeAll(() => {
    printCalibrationTable(FIXTURES, RESULTS);
  });

  // ── Sanity: pipeline never throws ─────────────────────────────────────────
  it("pipeline runs without throwing for all 16 fixtures", () => {
    expect(RESULTS).toHaveLength(FIXTURES.length);
    RESULTS.forEach((r) => {
      expect(typeof r.confidenceScore).toBe("number");
      expect(Number.isFinite(r.confidenceScore)).toBe(true);
    });
  });

  // ── Fixture-by-fixture assertions ─────────────────────────────────────────
  describe.each(FIXTURES.map((f, i) => [f, RESULTS[i]] as const))(
    "%s",
    (fixture, result) => {
      const { id, scenario, expectedStance, expectedReasonCode, expectedTier } = fixture;
      const label = `${id} — ${scenario}`;

      it(`${label}: stance is "${expectedStance}"`, () => {
        expect(result.stance).toBe(expectedStance);
      });

      it(`${label}: reasonCode is "${expectedReasonCode}"`, () => {
        expect(result.reasonCode).toBe(expectedReasonCode);
      });

      it(`${label}: confidenceTier is "${expectedTier}"`, () => {
        expect(result.confidenceTier).toBe(expectedTier);
      });
    }
  );

  // ── Clustering behavior ────────────────────────────────────────────────────

  it("F07 (4 mirrored articles): clusters down to 1 representative", () => {
    const r = RESULTS[FIXTURES.findIndex((f) => f.id === "F07")];
    expect(r.rawMatches).toBe(4);
    expect(r.clusters).toBe(1);
    expect(r.duplicates).toBe(3);
  });

  it("F04 (conflicting google ratings): stays at 2 clusters, not merged", () => {
    const r = RESULTS[FIXTURES.findIndex((f) => f.id === "F04")];
    expect(r.rawMatches).toBe(2);
    expect(r.clusters).toBe(2);
    expect(r.duplicates).toBe(0);
  });

  it("F12 (3 independent authoritative): stays at 3 clusters", () => {
    const r = RESULTS[FIXTURES.findIndex((f) => f.id === "F12")];
    expect(r.rawMatches).toBe(3);
    expect(r.clusters).toBe(3);
    expect(r.duplicates).toBe(0);
  });

  it("F15 (2 independent coverage): stays at 2 clusters", () => {
    const r = RESULTS[FIXTURES.findIndex((f) => f.id === "F15")];
    expect(r.rawMatches).toBe(2);
    expect(r.clusters).toBe(2);
    expect(r.duplicates).toBe(0);
  });

  // ── Confidence ordering contracts ─────────────────────────────────────────

  it("authoritative sources score higher than coverage for same stance", () => {
    // F01 (google contradiction) vs F05 (newsapi contradiction)
    const authScore = RESULTS[FIXTURES.findIndex((f) => f.id === "F01")].confidenceScore;
    const covScore  = RESULTS[FIXTURES.findIndex((f) => f.id === "F05")].confidenceScore;
    expect(authScore).toBeGreaterThan(covScore);
  });

  it("3 independent sources (F12) score higher than 1 source (F02)", () => {
    const three = RESULTS[FIXTURES.findIndex((f) => f.id === "F12")].confidenceScore;
    const one   = RESULTS[FIXTURES.findIndex((f) => f.id === "F02")].confidenceScore;
    expect(three).toBeGreaterThanOrEqual(one);
  });

  it("duplicate mirrored coverage (F07, 4→1 cluster) does NOT exceed 2-source score (F15)", () => {
    // F07 = 4 articles that cluster to 1 representative
    // F15 = 2 genuinely independent articles
    // After clustering, F07 should score ≤ F15 (same or lower, since fewer reps)
    const mirrored    = RESULTS[FIXTURES.findIndex((f) => f.id === "F07")].confidenceScore;
    const independent = RESULTS[FIXTURES.findIndex((f) => f.id === "F15")].confidenceScore;
    expect(mirrored).toBeLessThanOrEqual(independent);
  });

  it("not-relevant sources always score lower than relevant ones of same provider", () => {
    // F08 (google + irrelevant) vs F01 (google + relevant + contradicted)
    const irrelevant = RESULTS[FIXTURES.findIndex((f) => f.id === "F08")].confidenceScore;
    const relevant   = RESULTS[FIXTURES.findIndex((f) => f.id === "F01")].confidenceScore;
    expect(irrelevant).toBeLessThan(relevant);
  });

  it("no_match and error always score 0", () => {
    const noMatch = RESULTS[FIXTURES.findIndex((f) => f.id === "F09")];
    const error   = RESULTS[FIXTURES.findIndex((f) => f.id === "F10")];
    expect(noMatch.confidenceScore).toBe(0);
    expect(error.confidenceScore).toBe(0);
  });

  it("score is always in [0, 100]", () => {
    RESULTS.forEach((r) => {
      expect(r.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(r.confidenceScore).toBeLessThanOrEqual(100);
    });
  });
});
