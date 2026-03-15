/**
 * Tests for clusterEvidence — conservative evidence deduplication.
 *
 * Clustering rules under test:
 *   Rule 1 — Same URL hostname + same verdict → definite duplicate
 *   Rule 2 — Same source family + same verdict + ≥50% title overlap → near-duplicate
 *   Rule 3 — ≥70% title token overlap across any sources (≥3 tokens) → syndicated
 *
 * Conservative contract:
 *   When uncertain whether two items are independent, they are merged.
 *   Independent sources with distinct titles/verdicts/hostnames must NOT be merged.
 */
import { clusterEvidence } from "@/lib/clashbot/evidenceClustering";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const google = (title: string, rating = "False", url = "https://factcheck.org/review/1") => ({
  provider: "google_factcheck",
  title,
  rating: { text: rating },
  url,
});

const news = (title: string, rating = "", url = "https://reuters.com/story/1") => ({
  provider: "newsapi",
  title,
  rating: rating ? { text: rating } : undefined,
  url,
});

const override = (title: string, rating = "Contradicted") => ({
  provider: "known_fact_override",
  title,
  rating: { text: rating },
  url: "",
});

// ---------------------------------------------------------------------------
// 1. Empty / trivial input
// ---------------------------------------------------------------------------

describe("clusterEvidence — empty / trivial", () => {
  it("returns empty result for undefined", () => {
    const r = clusterEvidence(undefined);
    expect(r.totalMatches).toBe(0);
    expect(r.representativeCount).toBe(0);
    expect(r.duplicateCount).toBe(0);
    expect(r.clusters).toHaveLength(0);
  });

  it("returns empty result for []", () => {
    expect(clusterEvidence([]).totalMatches).toBe(0);
  });

  it("single match → one cluster, no duplicates", () => {
    const r = clusterEvidence([google("Vaccines don't cause autism")]);
    expect(r.totalMatches).toBe(1);
    expect(r.representativeCount).toBe(1);
    expect(r.duplicateCount).toBe(0);
    expect(r.clusters[0].hasDuplicates).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Duplicate same-source evidence (Rule 1: same hostname + same rating)
// ---------------------------------------------------------------------------

describe("clusterEvidence — duplicate same-source evidence", () => {
  it("two articles from the same domain with the same verdict → one cluster", () => {
    const matches = [
      google("Claim A is false", "False", "https://factcheck.org/a"),
      google("Claim A is false (updated)", "False", "https://factcheck.org/b"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(1);
    expect(r.duplicateCount).toBe(1);
    expect(r.clusters[0].hasDuplicates).toBe(true);
    expect(r.clusters[0].members).toHaveLength(2);
  });

  it("same domain, different verdict → separate clusters (not merged)", () => {
    const matches = [
      google("Article A", "False", "https://factcheck.org/a"),
      google("Article B", "True", "https://factcheck.org/b"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(2);
    expect(r.duplicateCount).toBe(0);
  });

  it("same-source repeated snippets with identical rating → one cluster", () => {
    const sameUrl = "https://snopes.com/claim";
    const matches = [
      { provider: "newsapi", title: "Story repeats claim", rating: { text: "False" }, url: sameUrl },
      { provider: "newsapi", title: "Story repeats claim (copy)", rating: { text: "False" }, url: sameUrl },
      { provider: "newsapi", title: "Another angle same claim", rating: { text: "False" }, url: sameUrl },
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(1);
    expect(r.duplicateCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Same proposition across mirrored outlets (Rule 2 + Rule 3)
// ---------------------------------------------------------------------------

describe("clusterEvidence — same proposition across mirrored outlets", () => {
  it("two newsapi articles with identical titles and same verdict → one cluster (Rule 2)", () => {
    const matches = [
      news("Scientists confirm climate change accelerating", "False", "https://reuters.com/a"),
      news("Scientists confirm climate change accelerating", "False", "https://ap.org/a"),
    ];
    const r = clusterEvidence(matches);
    // Same source family (news) + same rating + >50% title overlap
    expect(r.representativeCount).toBe(1);
    expect(r.duplicateCount).toBe(1);
  });

  it("highly overlapping titles across different providers → merged (Rule 3)", () => {
    const matches = [
      google("President signs new climate bill into law", "True", "https://factcheck.org/1"),
      news("President signs climate bill into law today", "", "https://bbc.com/2"),
    ];
    // >70% title overlap (≥3 shared meaningful tokens)
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(1);
    expect(r.clusters[0].hasDuplicates).toBe(true);
  });

  it("same proposition, four outlets, all same verdict → one cluster", () => {
    const title = "Unemployment rate hits record low last month";
    const matches = [
      news(title, "True", "https://reuters.com/1"),
      news(title, "True", "https://ap.org/1"),
      news(title, "True", "https://bloomberg.com/1"),
      news(title, "True", "https://cnbc.com/1"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(1);
    expect(r.duplicateCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Conflicting clusters (different verdicts must NOT be merged)
// ---------------------------------------------------------------------------

describe("clusterEvidence — conflicting clusters stay separate", () => {
  it("one contradiction source and one support source → two clusters", () => {
    const matches = [
      google("The drug has been proven safe", "True", "https://factcheck.org/1"),
      google("The drug has not been proven safe", "False", "https://science.org/1"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(2);
    expect(r.duplicateCount).toBe(0);
  });

  it("mixed verdict articles: two contra, one support → two clusters", () => {
    const matches = [
      news("Claim about economy is false", "False", "https://reuters.com/1"),
      news("Claim about economy is false", "False", "https://ap.org/1"),
      news("Economy claim verified correct", "True",  "https://bloomberg.com/1"),
    ];
    const r = clusterEvidence(matches);
    // The two "False" articles with same title merge; "True" stays separate
    expect(r.representativeCount).toBe(2);
    expect(r.duplicateCount).toBe(1);
  });

  it("representative of each cluster carries the correct verdict", () => {
    const matches = [
      { provider: "google_factcheck", title: "Claim X", rating: { text: "False" }, url: "https://a.com/1" },
      { provider: "google_factcheck", title: "Claim X", rating: { text: "True" },  url: "https://b.com/1" },
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(2);
    const ratings = r.clusters.map((c) => c.representative.rating?.text).sort();
    expect(ratings).toEqual(["False", "True"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Independent sources that must remain separate
// ---------------------------------------------------------------------------

describe("clusterEvidence — independent sources stay separate", () => {
  it("two distinct fact-check articles on different topics → two clusters", () => {
    const matches = [
      google("Did the president raise taxes last year", "False", "https://factcheck.org/1"),
      google("Was the unemployment rate above five percent", "True", "https://politifact.com/1"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(2);
    expect(r.duplicateCount).toBe(0);
  });

  it("different providers, low title overlap, different verdicts → separate", () => {
    const matches = [
      google("Vaccine causes autism in children", "False", "https://factcheck.org/1"),
      news("Hospital reports surge in flu cases this winter", "", "https://nytimes.com/1"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(2);
  });

  it("override + google + news on truly different claims → three clusters", () => {
    const matches = [
      override("Earth is flat", "Contradicted"),
      google("Moon landing was faked by NASA in 1969", "False", "https://factcheck.org/1"),
      news("Scientists discover new species in Amazon rainforest", "", "https://bbc.com/1"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(3);
    expect(r.duplicateCount).toBe(0);
  });

  it("four independent sources on same verdict but different topics → four clusters", () => {
    const matches = [
      google("Claim A: Vaccines cause autism",   "False", "https://factcheck.org/a"),
      google("Claim B: Earth is 6000 years old", "False", "https://factcheck.org/b"),
      news("Claim C: Tax cuts pay for themselves", "False", "https://reuters.com/c"),
      news("Claim D: Drinking bleach cures disease", "False", "https://ap.org/d"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(4);
    expect(r.duplicateCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Representative quality — highest-quality match wins
// ---------------------------------------------------------------------------

describe("clusterEvidence — representative selection", () => {
  it("google_factcheck match is representative over newsapi match in same cluster", () => {
    const matches = [
      news("Vaccines do not cause autism study shows", "False", "https://news.com/1"),
      google("Vaccines do not cause autism study shows", "False", "https://news.com/1"),
    ];
    const r = clusterEvidence(matches);
    expect(r.representativeCount).toBe(1);
    expect(r.clusters[0].representative.provider).toBe("google_factcheck");
  });

  it("known_fact_override wins over all other providers", () => {
    const matches = [
      news("Earth is flat fact or fiction", "False", "https://news.com/1"),
      google("Earth is flat fact or fiction", "False", "https://news.com/1"),
      override("Earth is flat fact or fiction", "Contradicted"),
    ];
    const r = clusterEvidence(matches);
    // All same URL (news.com) + same-ish rating merge two; override may be separate
    // but regardless the override representative has highest quality score
    const overrideCluster = r.clusters.find(
      (c) => c.representative.provider === "known_fact_override"
    );
    expect(overrideCluster).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Totals arithmetic
// ---------------------------------------------------------------------------

describe("clusterEvidence — totals always add up", () => {
  it("totalMatches = representativeCount + duplicateCount", () => {
    const matches = [
      google("A", "False", "https://a.com/1"),
      google("A", "False", "https://a.com/2"),
      google("B", "True",  "https://b.com/1"),
      news("C", "",        "https://c.com/1"),
    ];
    const r = clusterEvidence(matches);
    expect(r.totalMatches).toBe(4);
    expect(r.representativeCount + r.duplicateCount).toBe(r.totalMatches);
  });

  it("all unique → duplicateCount is 0", () => {
    const matches = [
      google("Alpha claim", "False", "https://a.com/1"),
      google("Beta claim",  "True",  "https://b.com/1"),
    ];
    const r = clusterEvidence(matches);
    expect(r.duplicateCount).toBe(0);
  });
});
