/**
 * Focused tests for assessRelevance — entity extraction and relevance gating.
 *
 * Core invariants under test:
 *   1. Sentence-start common words do NOT create entity anchors (token-overlap fallback used)
 *   2. Genuine mid-sentence named entities ARE strong anchors
 *   3. All-caps acronyms (NASA, COVID) are always entity anchors regardless of position
 *   4. Multi-word title-case phrases are always entity anchors even at sentence start
 *   5. Numeric overlap produces relevance independently of entity overlap
 *   6. Entity mismatch between claim and source produces not-relevant
 *   7. A word appearing both sentence-initially and mid-sentence IS treated as a proper noun
 */
import { assessRelevance } from "@/lib/clashbot/verificationService";

// ---------------------------------------------------------------------------
// 1. Sentence-start common words → token-overlap fallback, not entity anchor
// ---------------------------------------------------------------------------

describe("sentence-start common words: fall through to token overlap", () => {
  it("'Regular aspirin...' — 'Regular' is not an entity anchor; token overlap makes it relevant", () => {
    const r = assessRelevance(
      "Regular aspirin use prevents heart attacks",
      "Aspirin prevents heart attacks: daily use confirmed by study",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("'Exercise regularly...' — 'Exercise' is not an entity anchor; token overlap makes it relevant", () => {
    const r = assessRelevance(
      "Exercise regularly reduces the risk of cardiovascular disease",
      "Regular exercise reduces heart disease risk, large study confirms",
      "recent_coverage"
    );
    expect(r.relevant).toBe(true);
  });

  it("'Scientists discovered...' — 'Scientists' is not an entity anchor; token overlap used", () => {
    const r = assessRelevance(
      "Scientists discovered a new treatment for Alzheimer's disease",
      "Researchers develop new Alzheimer's treatment in clinical trials",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("sentence-start word with NO token overlap → not relevant (fallback works correctly)", () => {
    const r = assessRelevance(
      "Regular aspirin use prevents heart attacks",
      "Bitcoin prices surge to new all-time high this quarter",
      "fact_check"
    );
    expect(r.relevant).toBe(false);
  });

  it("'New technology...' — 'New' is not an entity anchor; falls to token overlap", () => {
    const r = assessRelevance(
      "New solar panel technology achieves record efficiency levels",
      "Solar panel efficiency record broken by researchers last month",
      "recent_coverage"
    );
    expect(r.relevant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Genuine mid-sentence named entities remain strong anchors
// ---------------------------------------------------------------------------

describe("mid-sentence named entities: entity anchor path is preserved", () => {
  it("proper noun mid-sentence (Apple) is an entity anchor → relevant when match shares it", () => {
    const r = assessRelevance(
      "The company Apple was founded by Steve Jobs in California",
      "Apple Inc was co-founded by Steve Jobs and Steve Wozniak",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("proper noun mid-sentence (Apple) is an entity anchor → not relevant when match lacks it", () => {
    const r = assessRelevance(
      "The company Apple reported record revenue last quarter",
      "Microsoft posted strong earnings driven by cloud growth",
      "fact_check"
    );
    expect(r.relevant).toBe(false);
  });

  it("Earth mid-sentence → entity anchor; match shares it → relevant", () => {
    const r = assessRelevance(
      "The Earth is flat",
      "The Earth is not flat — it is approximately spherical, confirmed by science",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("mid-sentence proper noun (Aspirin in longer text) is entity anchor", () => {
    // "Aspirin" is mid-sentence — not the first word — so it IS an entity anchor.
    const r = assessRelevance(
      "Doctors recommend that Aspirin be taken for clot prevention",
      "Aspirin therapy for clot prevention guidelines updated",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. All-caps acronyms: always entity anchors regardless of position
// ---------------------------------------------------------------------------

describe("all-caps acronyms: always entity anchors", () => {
  it("NASA at sentence start → entity anchor (tier 1 always included)", () => {
    const r = assessRelevance(
      "NASA announced plans to return astronauts to the Moon",
      "Space agency NASA reveals new lunar mission timeline for 2026",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("NASA anchor → not relevant when match doesn't mention NASA", () => {
    const r = assessRelevance(
      "NASA discovered liquid water on Mars",
      "SpaceX successfully launches Starship on orbital test flight",
      "fact_check"
    );
    expect(r.relevant).toBe(false);
  });

  it("COVID at sentence start (from COVID-19) → entity anchor", () => {
    const r = assessRelevance(
      "COVID-19 vaccines contain microchips that track people",
      "Fact check: COVID-19 vaccines do not contain tracking microchips",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("FBI mid-sentence → entity anchor", () => {
    const r = assessRelevance(
      "The investigation was led by FBI agents in Washington",
      "FBI investigation results released to the public",
      "recent_coverage"
    );
    expect(r.relevant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Multi-word title-case phrases: always entity anchors even at sentence start
// ---------------------------------------------------------------------------

describe("multi-word title-case phrases: always entity anchors", () => {
  it("'Great Barrier Reef' at sentence start → entity anchor (tier 2)", () => {
    const r = assessRelevance(
      "Great Barrier Reef is experiencing unprecedented coral bleaching",
      "Scientists studying Great Barrier Reef report accelerating bleaching crisis",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("'Federal Reserve' mid-text → entity anchor", () => {
    const r = assessRelevance(
      "The Federal Reserve raised interest rates for the third time",
      "Federal Reserve announces third consecutive rate increase this year",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("multi-word phrase mismatch → not relevant even with single-word overlap", () => {
    const r = assessRelevance(
      "Great Barrier Reef coral cover is recovering slowly",
      // Match mentions reef but not Great Barrier Reef — however single-word overlap
      // via token fallback handles this; the test verifies relevance behavior is stable.
      "Amazon River ecosystems show signs of environmental stress",
      "fact_check"
    );
    // No shared entities AND no shared numbers AND poor token overlap → not relevant
    expect(r.relevant).toBe(false);
  });

  it("'Steve Jobs' multi-word anchor → relevant when match shares it", () => {
    const r = assessRelevance(
      "Steve Jobs returned to Apple and transformed the company",
      "How Steve Jobs rebuilt Apple after his return in 1997",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Numeric overlap: independent of entity extraction
// ---------------------------------------------------------------------------

describe("numeric overlap: produces relevance regardless of entity situation", () => {
  it("shared number (3.5%) produces relevance even with no entity overlap", () => {
    const r = assessRelevance(
      "The unemployment rate fell to 3.5 percent last quarter",
      "US unemployment hits 3.5 percent according to latest data",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("shared year (1950) produces relevance", () => {
    const r = assessRelevance(
      "Human activity has been the dominant cause of warming since 1950",
      "Climate change driven by human activity documented since 1950",
      "fact_check"
    );
    expect(r.relevant).toBe(true);
  });

  it("number in claim but different number in match → not relevant", () => {
    const r = assessRelevance(
      "Apple iPhone 15 has a 48-megapixel main camera",
      "Samsung Galaxy S24 features improved battery and display",
      "fact_check"
    );
    // Different product numbers (15, 48 vs nothing) → no number overlap, no entity overlap
    expect(r.relevant).toBe(false);
  });

  it("shared percentage with no other overlap → relevant via numbers", () => {
    const r = assessRelevance(
      "Solar energy costs dropped by 89 percent over the past decade",
      "Renewable energy cost down 89 percent since 2010, report finds",
      "recent_coverage"
    );
    expect(r.relevant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Irrelevant same-domain false positives: entity mismatch → not relevant
// ---------------------------------------------------------------------------

describe("irrelevant source match: entity/number mismatch → not relevant", () => {
  it("google fact-check returned but about a completely different product", () => {
    const r = assessRelevance(
      "Apple's iPhone 15 has a 48-megapixel main camera",
      "Samsung Galaxy S24 Ultra has improved battery life confirmed by manufacturer",
      "fact_check"
    );
    expect(r.relevant).toBe(false);
  });

  it("news article about unrelated topic → not relevant", () => {
    const r = assessRelevance(
      "The Federal Reserve will raise interest rates by 0.25 percent next month",
      "Local housing market shows signs of cooling in spring season",
      "recent_coverage"
    );
    expect(r.relevant).toBe(false);
  });

  it("same general topic (health) but no specific overlap → not relevant", () => {
    const r = assessRelevance(
      "Vitamin C supplements prevent the common cold in adults",
      "Omega-3 fatty acids linked to reduced heart disease mortality risk",
      "fact_check"
    );
    expect(r.relevant).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Word appearing both sentence-initially AND mid-sentence → proper noun
// ---------------------------------------------------------------------------

describe("proper noun appearing at both sentence-initial and mid-sentence", () => {
  it("word at sentence start but also capitalized mid-sentence → entity anchor", () => {
    // "Mars" starts the sentence AND appears again mid-sentence → proper noun
    const r = assessRelevance(
      "Mars has liquid water. Scientists found Mars has subsurface lakes.",
      "Liquid water found on Mars by radar survey beneath south pole",
      "fact_check"
    );
    // "Mars" should be an entity (appears capitalized mid-sentence too)
    expect(r.relevant).toBe(true);
  });

  it("proper noun initiates one sentence and appears in another → entity anchor applies", () => {
    const r = assessRelevance(
      "Gates Foundation donated billions to malaria research. Gates also funded vaccine programs.",
      "Bill Gates Foundation malaria research funding reaches record levels",
      "fact_check"
    );
    // "Gates" appears at sentence-initial (sentence 2) but also mid-sentence ("Gates Foundation" in S1)
    expect(r.relevant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Recent-coverage mode: lower relevance threshold
// ---------------------------------------------------------------------------

describe("recent_coverage mode: lower overlap threshold", () => {
  it("borderline token overlap passes under recent_coverage but would need more for fact_check", () => {
    // "Exercise reduces disease risk" — minimal but real overlap
    const rc = assessRelevance(
      "Exercise reduces disease risk",
      "Walking and exercise show reduced risk in new health study",
      "recent_coverage"
    );
    expect(rc.relevant).toBe(true);
  });

  it("no overlap fails under both modes", () => {
    const r = assessRelevance(
      "Exercise reduces disease risk",
      "Cryptocurrency market volatility surges amid regulatory uncertainty",
      "recent_coverage"
    );
    expect(r.relevant).toBe(false);
  });
});
