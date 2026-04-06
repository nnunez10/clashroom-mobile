// lib/clashbot/providers/router.ts

import type { VerificationResult } from "../types";
import { bingNewsSearch } from "./bingnews";
import { googleFactCheckSearch } from "./googleFactCheck";
import { newsApiSearch } from "./newsapi";
import { tavilySearch } from "./tavily";

function hasMatches(result: VerificationResult) {
  return Array.isArray(result.matches) && result.matches.length > 0;
}

// ---------------------------------------------------------------------------
// Temporal-intent detection
// ---------------------------------------------------------------------------

// Event verbs that signal something happened at a specific recent moment.
const TEMPORAL_VERBS =
  /\b(fired|resigned|appointed|banned|passed|signed|arrested|quit|retired|elected|named|impeached|indicted|charged|sentenced|died|killed|collapsed|crashed|launched|released|announced|declared|imposed|lifted|approved|rejected|vetoed)\b/i;

// Explicit time words the user typed.
const TEMPORAL_WORDS =
  /\b(today|yesterday|now|currently|recently|this week|this month|this year|last week|last month)\b/i;

// Economic/market topics that are inherently current-event driven.
const TEMPORAL_TOPICS =
  /\b(prices?|inflation|gas|economy|economic|markets?|interest rates?|unemployment|gdp|dow|nasdaq|s&p)\b/i;

/**
 * Returns true if the claim is likely time-sensitive: an event that happened
 * recently, a person who was just appointed/fired, or a current economic stat.
 * Pure keyword scan — no network calls, no state.
 */
function isTimeSensitiveClaim(text: string): boolean {
  return (
    TEMPORAL_VERBS.test(text) ||
    TEMPORAL_WORDS.test(text) ||
    TEMPORAL_TOPICS.test(text)
  );
}

/**
 * Appends the current year to the query when the claim has no 4-digit year.
 * Helps news search APIs surface recent articles over evergreen results without
 * narrowing fact-check database queries (Google stays on the raw text).
 */
function buildTemporalQuery(text: string): string {
  if (/\b(19|20)\d{2}\b/.test(text)) return text; // already anchored
  return `${text} ${new Date().getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Structured query builder for named-person + event-verb claims
// ---------------------------------------------------------------------------

// Maps each verb family to the set of synonyms used in the search query.
// OR-joining synonyms lets the API find articles that use different language
// for the same event type (e.g. "fired" in the claim → also finds "ousted").
const VERB_QUERY_GROUPS: Array<[RegExp, string[]]> = [
  [/\b(fired|dismissed|ousted|removed|replaced|terminated)\b/i, ["fired", "dismissed", "ousted", "removed"]],
  [/\b(resigned|quit|stepped down|departed)\b/i,                ["resigned", "quit", "stepped down"]],
  [/\b(appointed|named|selected|tapped|confirmed)\b/i,          ["appointed", "named", "selected"]],
  [/\b(arrested|detained|indicted|charged)\b/i,                 ["arrested", "detained", "indicted", "charged"]],
  [/\b(passed|enacted|signed|approved)\b/i,                     ["passed", "enacted", "approved", "signed"]],
  [/\b(announced|declared|revealed|launched)\b/i,               ["announced", "declared", "launched"]],
  [/\b(banned|suspended|barred)\b/i,                            ["banned", "suspended", "barred"]],
  [/\b(sentenced|convicted)\b/i,                                ["sentenced", "convicted"]],
  [/\b(elected|won)\b/i,                                        ["elected", "won"]],
  [/\b(impeached|removed)\b/i,                                  ["impeached", "removed"]],
];

/**
 * Builds a structured news search query for claims that contain both a named
 * entity and an event verb. Returns null when the claim doesn't qualify so
 * the caller can fall back to buildTemporalQuery.
 *
 * Structure: `"Entity" verb OR synonym1 OR synonym2 YEAR`
 *
 * Examples:
 *   "Pam Bondi was fired"  → `"Pam Bondi" fired OR dismissed OR ousted OR removed 2026`
 *   "Kristi Noem resigned" → `"Kristi Noem" resigned OR quit OR stepped down 2026`
 *   "Gas prices are high"  → null (no entity → falls back to buildTemporalQuery)
 */
function buildNamedEntityEventQuery(text: string): string | null {
  // Extract entities in original casing for the quoted query fragment.
  // Cannot reuse extractClaimEntities here — that lowercases for comparison.
  const rawEntities: string[] = [];
  for (const m of text.match(/\b[A-Z]{2,}\b/g) || []) {
    rawEntities.push(m);
  }
  for (const m of text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) || []) {
    rawEntities.push(m);
  }

  if (rawEntities.length === 0) return null;
  if (!TEMPORAL_VERBS.test(text)) return null;

  let verbTerms: string[] | null = null;
  for (const [pattern, synonyms] of VERB_QUERY_GROUPS) {
    if (pattern.test(text)) {
      verbTerms = synonyms;
      break;
    }
  }
  if (!verbTerms) return null;

  // Quote multi-word entities so the API treats them as exact phrases.
  const entityPart = rawEntities
    .map((e) => (e.includes(" ") ? `"${e}"` : e))
    .join(" ");

  const verbPart = verbTerms.join(" OR ");
  const year = /\b(19|20)\d{2}\b/.test(text) ? "" : String(new Date().getFullYear());

  return [entityPart, verbPart, year].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Claim-type classification and typed query builders
// ---------------------------------------------------------------------------

// Vague question prefixes — claim is asking "what happened" rather than asserting.
const VAGUE_PREFIX =
  /^(?:what(?:'s|'re|\s+is|\s+are|\s+was|\s+were)?\s+(?:going\s+on(?:\s+with\s+)?|happening(?:\s+with\s+)?|happened(?:\s+to\s+)?|the\s+deal\s+with\s+|the\s+latest(?:\s+on\s+)?|up\s+with\s+)?|who\s+(?:is|was|are|were)\s+)/i;

// Subjective/opinion phrases — claim expresses judgment rather than a verifiable fact.
const OPINION_PHRASES =
  /\b(?:is ruining|is bad|is failing|is terrible|is destroying|is a disaster|is the worst|is wrong|should be|needs to|is broken|is corrupt)\b/i;

/**
 * Strips the question prefix from a vague claim so the remaining text can
 * be used as a search topic.
 *   "What happened to Pam Bondi"      → "Pam Bondi"
 *   "What is going on with the economy" → "the economy"
 *   "What's happening with gas prices"  → "gas prices"
 */
function stripVaguePrefix(text: string): string {
  return text.replace(VAGUE_PREFIX, "").trim();
}

type ClaimType = "event" | "vague" | "broad" | "opinion";

/**
 * Classifies a temporal claim into one of four types.
 * Priority: vague > event > opinion > broad.
 * Only called for temporal claims — assumes isTimeSensitiveClaim already passed.
 */
function classifyClaimType(text: string): ClaimType {
  if (VAGUE_PREFIX.test(text)) return "vague";
  if (TEMPORAL_VERBS.test(text)) return "event";
  if (OPINION_PHRASES.test(text)) return "opinion";
  if (TEMPORAL_TOPICS.test(text)) return "broad";
  return "event"; // default for temporal claims caught by TEMPORAL_WORDS
}

/**
 * Builds a query tuned for the claim type. Returns null for event/opinion so
 * the caller falls through to buildNamedEntityEventQuery / buildTemporalQuery.
 *
 *   vague  → "<stripped topic> news <year>"
 *   broad  → "<claim> latest data <month> <year>"
 *   event  → null (handled by buildNamedEntityEventQuery)
 *   opinion → null (weaker results accepted; current behavior preserved)
 */
function buildTypedQuery(text: string, claimType: ClaimType): string | null {
  if (claimType === "vague") {
    const stripped = stripVaguePrefix(text) || text;
    const hasYear = /\b(19|20)\d{2}\b/.test(stripped);
    return `${stripped} news${hasYear ? "" : " " + new Date().getFullYear()}`;
  }

  if (claimType === "broad") {
    const hasYear = /\b(19|20)\d{2}\b/.test(text);
    const month = new Date().toLocaleString("en-US", { month: "long" });
    const year = new Date().getFullYear();
    return hasYear ? `${text} latest data` : `${text} latest data ${month} ${year}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Router-level relevance filter for temporal claims
// ---------------------------------------------------------------------------

// Broader synonym set used when checking whether an article is about an event.
// Superset of TEMPORAL_VERBS: includes common journalistic synonyms so that
// "fired" in the claim accepts "dismissed" or "ousted" in the article.
const EVENT_TERMS =
  /\b(fired|dismissed|ousted|removed|replaced|resigned|departed|stepped|appointed|named|selected|tapped|confirmed|banned|suspended|passed|signed|enacted|approved|rejected|vetoed|arrested|detained|indicted|charged|sentenced|quit|retired|elected|died|killed|collapsed|crashed|launched|released|announced|declared|imposed|lifted)\b/i;

// Detects passive-voice construction in a claim — the entity is the TARGET of the
// action, not the actor. Covers "was fired", "was arrested", "has been appointed", etc.
const PASSIVE_PATTERN =
  /\b(?:was|were|has been|have been|got)\s+(?:fired|dismissed|ousted|removed|replaced|appointed|named|arrested|detained|indicted|charged|sentenced|elected|banned|impeached|launched|released|announced|declared|passed|signed|approved|rejected|vetoed|imposed|lifted|killed)\b/i;

// Confirms that the article describes an entity as the TARGET of an action, not the actor.
// Two signal types:
//   a) Passive auxiliary + past participle in article: "was fired", "has been removed"
//   b) Event-result nouns: "firing", "ouster", "removal", "dismissal", "resignation", etc.
//      These appear in coverage of the event regardless of headline voice.
const PASSIVE_ARTICLE_INDICATOR =
  /\b(?:was|were|has been|have been|got)\s+(?:fired|dismissed|ousted|removed|replaced|appointed|named|arrested|detained|indicted|charged|sentenced|elected|banned|impeached|launched|released|announced|declared|passed|signed|approved|rejected|vetoed|imposed|lifted|killed)\b|\b(?:dismissed|ousted|removed|replaced|terminated|firing|ouster|removal|dismissal|departure|resignation|impeachment)\b/i;

/**
 * Extracts strong entity signals from a claim:
 *   - ALL-CAPS acronyms: FBI, CIA, GOP, NATO
 *   - Multi-word title-case sequences: Janet Yellen, Federal Reserve, Supreme Court
 *
 * Returns lowercased strings so comparison against lowercased article text is safe.
 * Single title-case words are skipped — too likely to be sentence starts.
 */
function extractClaimEntities(text: string): string[] {
  const entities: string[] = [];
  for (const m of text.match(/\b[A-Z]{2,}\b/g) || []) {
    entities.push(m.toLowerCase());
  }
  for (const m of text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) || []) {
    entities.push(m.toLowerCase());
  }
  return entities;
}

/**
 * Returns true if a single provider match is sufficiently relevant to a
 * time-sensitive claim. Applied at the router level before returning results,
 * so loosely related articles are rejected before they reach stance/confidence
 * scoring.
 *
 * Rules (applied in order, first failure returns false):
 *   1. If the claim contains named entities (ALL-CAPS or multi-word title-case),
 *      at least one must appear — word-by-word — in the article title or snippet.
 *   2. If the claim contains an event verb, the article must also contain at least
 *      one event-related term (EVENT_TERMS). Applies even when entities are present —
 *      an article that names the same person but describes a different action fails.
 *   3. No strong signals in the claim → pass through (no false rejection).
 */
function passesTemporalFilter(claimText: string, match: any): boolean {
  const haystack = [
    String(match?.title || ""),
    String(match?.snippet || ""),
  ].join(" ").toLowerCase();

  const entities = extractClaimEntities(claimText);

  if (entities.length > 0) {
    const entityFound = entities.some((e) =>
      e.split(/\s+/).filter(Boolean).every((w) => haystack.includes(w))
    );
    if (!entityFound) return false;
  }

  // Passive-direction check: if the claim uses passive voice ("was fired",
  // "was arrested"), the entity is the TARGET of the action. Require the article
  // to confirm that direction — either via a passive construction or an
  // event-result noun (ouster, dismissal, firing, etc.).
  // Prevents "Pam Bondi fired a prosecutor" from matching "Pam Bondi was fired".
  if (PASSIVE_PATTERN.test(claimText)) {
    if (!PASSIVE_ARTICLE_INDICATOR.test(haystack)) return false;
  }

  if (TEMPORAL_VERBS.test(claimText)) {
    if (!EVENT_TERMS.test(haystack)) return false;
  }

  return true;
}

// True if at least one match carries a verdict rating — the main signal that
// separates a useful Google Fact Check result from a bare URL-only entry.
function hasRatedMatches(result: VerificationResult) {
  if (result.status !== "matched") return false;
  return result.matches.some((m) => !!m.rating?.text);
}

function getMessage(result: VerificationResult) {
  return "message" in result ? result.message || "" : "";
}

export async function routeVerification(text: string): Promise<VerificationResult> {
  let google: VerificationResult = { status: "no_match", matches: [] };
  let tavily: VerificationResult = { status: "no_match", matches: [] };
  let bing: VerificationResult = { status: "no_match", matches: [] };
  let news: VerificationResult = { status: "no_match", matches: [] };

  // Detect time-sensitive claims (firings, appointments, prices, current events).
  // Google Fact Check stays on the raw query — year injection can over-narrow its
  // static verdict DB. Bing and NewsAPI get the year-augmented query so they
  // surface recent articles ahead of evergreen results.
  const temporal = isTimeSensitiveClaim(text);
  // Classify claim type to tune query construction for vague and broad claims.
  // Only computed for temporal claims; non-temporal always use raw text.
  const claimType = temporal ? classifyClaimType(text) : "event";
  // Query priority for temporal claims:
  //   1. Structured boolean query for named-person + event-verb (event/passive)
  //   2. Typed expansion for vague ("X news 2026") or broad ("X latest data Apr 2026")
  //   3. Year-appended plain text fallback
  const newsQuery = temporal
    ? (buildNamedEntityEventQuery(text) ?? buildTypedQuery(text, claimType) ?? buildTemporalQuery(text))
    : text;
  // Bing freshness: temporal claims get "Day" bucket (≤1 day) instead of "Week".
  const bingFreshnessDays = temporal ? 1 : 7;

  // 1) Formal fact checks first — only short-circuit if matches carry a rating.
  //    Unrated Google entries (URL-only, no verdict text) fall through to Bing
  //    so the user gets richer coverage context rather than a bare link.
  //    The unrated results are preserved in `google` and used as a last resort
  //    at the end if Bing and NewsAPI also find nothing.
  try {
    google = await googleFactCheckSearch(text);

    if (google.status === "matched" && hasMatches(google) && hasRatedMatches(google)) {
      return {
        status: "matched",
        matches: google.matches,
        top: google.top ?? google.matches[0],
        mode: google.mode ?? "fact_check",
      };
    }
  } catch (err: any) {
    google = {
      status: "error",
      matches: [],
      message: err?.message || "Google Fact Check provider failure.",
    };
  }

  // 2) Tavily semantic news search — temporal claims only.
  //    Tavily understands query intent rather than just matching keywords, which
  //    makes it better at finding loosely phrased or rapidly evolving stories.
  if (temporal) {
    try {
      tavily = await tavilySearch(newsQuery, { days: 3, maxResults: 5 });

      if (tavily.status === "matched" && hasMatches(tavily)) {
        const tavilyMatches = tavily.matches.filter((m) => passesTemporalFilter(text, m));
        if (tavilyMatches.length > 0) {
          return {
            status: "matched",
            matches: tavilyMatches,
            top: tavilyMatches[0],
            mode: "recent_coverage",
          };
        }
      }
    } catch (err: any) {
      tavily = {
        status: "error",
        matches: [],
        message: err?.message || "Tavily provider failure.",
      };
    }
  }

  // 4) Fresh recent coverage from Bing
  try {
    bing = await bingNewsSearch(newsQuery, { maxResults: 5, freshnessDays: bingFreshnessDays });

    if (bing.status === "matched" && hasMatches(bing)) {
      const bingMatches = temporal
        ? bing.matches.filter((m) => passesTemporalFilter(text, m))
        : bing.matches;
      if (bingMatches.length > 0) {
        return {
          status: "matched",
          matches: bingMatches,
          top: bingMatches[0],
          mode: "recent_coverage",
        };
      }
    }
  } catch (err: any) {
    bing = {
      status: "error",
      matches: [],
      message: err?.message || "Bing News provider failure.",
    };
  }

  // 5) Backup freshness provider
  try {
    news = await newsApiSearch(newsQuery);

    if (news.status === "matched" && hasMatches(news)) {
      const newsMatches = temporal
        ? news.matches.filter((m) => passesTemporalFilter(text, m))
        : news.matches;
      if (newsMatches.length > 0) {
        return {
          status: "matched",
          matches: newsMatches,
          top: newsMatches[0],
          mode: "recent_coverage",
        };
      }
    }
  } catch (err: any) {
    news = {
      status: "error",
      matches: [],
      message: err?.message || "NewsAPI provider failure.",
    };
  }

  // Unrated Google results that fell through above: return them now rather than
  // reporting no_match — they are still real fact-check entries, just missing a
  // verdict rating. Bing and NewsAPI already had their chance above.
  if (google.status === "matched" && hasMatches(google)) {
    return {
      status: "matched",
      matches: google.matches,
      top: google.top ?? google.matches[0],
      mode: google.mode ?? "fact_check",
    };
  }

  const allErrored =
    google.status === "error" &&
    tavily.status === "error" &&
    bing.status === "error" &&
    news.status === "error";

  if (allErrored) {
    return {
      status: "error",
      matches: [],
      message:
        getMessage(google) ||
        getMessage(bing) ||
        getMessage(news) ||
        "All verification providers failed.",
    };
  }

  const noMatchMessages = [
    google.status === "no_match" ? getMessage(google) : "",
    tavily.status === "no_match" ? getMessage(tavily) : "",
    bing.status === "no_match" ? getMessage(bing) : "",
    news.status === "no_match" ? getMessage(news) : "",
  ].filter(Boolean);

  return {
    status: "no_match",
    matches: [],
    message: noMatchMessages[0] || "No matching fact check or recent coverage found.",
  };
}