// lib/clashbot/providers/router.ts

import type { ClaimIntent } from "../claimIntent";
import type { VerificationResult } from "../types";
import { bingNewsSearch } from "./bingnews";
import { googleFactCheckSearch } from "./googleFactCheck";
import { newsApiSearch } from "./newsapi";
import { serpApiSearch } from "./serpapi";
import { tavilySearch } from "./tavily";

function hasMatches(result: VerificationResult) {
  return Array.isArray(result.matches) && result.matches.length > 0;
}

// ---------------------------------------------------------------------------
// Temporal-intent detection
// ---------------------------------------------------------------------------

// Event verbs that signal something happened at a specific recent moment.
const TEMPORAL_VERBS =
  /\b(fired|resigned|appointed|banned|passed|signed|arrested|quit|retired|elected|named|impeached|indicted|charged|sentenced|died|killed|collapsed|crashed|launched|released|announced|declared|imposed|lifted|approved|rejected|vetoed|dropped|withdrew)\b/i;

// Flat arrays of the same verbs — used by the fuzzy fallback helpers so that
// a 1-character typo ("droped", "resgined") still triggers temporal/high-recency
// detection without running the regex on garbled input.
const TEMPORAL_VERB_LIST = [
  "fired", "resigned", "appointed", "banned", "passed", "signed", "arrested",
  "quit", "retired", "elected", "named", "impeached", "indicted", "charged",
  "sentenced", "died", "killed", "collapsed", "crashed", "launched", "released",
  "announced", "declared", "imposed", "lifted", "approved", "rejected", "vetoed",
  "dropped", "withdrew", "dismissed", "ousted", "removed", "replaced",
];

const BREAKING_VERB_LIST = [
  "fired", "ousted", "dismissed", "removed", "replaced", "terminated",
  "resigned", "quit", "appointed", "named", "arrested", "detained",
  "indicted", "charged", "sentenced", "impeached", "dropped", "withdrew",
];

// Explicit time words the user typed.
const TEMPORAL_WORDS =
  /\b(today|yesterday|just|now|currently|recently|this week|this month|this year|last week|last month)\b/i;

// High-recency signals: implies the user wants something from the last 24 hours.
// "just", "today", "yesterday", "breaking", and "what did X say/do/claim/announce".
const HIGH_RECENCY_PHRASES =
  /\b(today|yesterday|just|breaking)\b|\bwhat did\s+.+?\s+(say|claim|announce|declare|tweet|post)\b/i;

// Strong event verbs that indicate a discrete, dateable event rather than a
// standing fact. When combined with a named entity and no explicit year, the
// claim is almost certainly about something that just happened — treat it as
// high-recency so live coverage gets priority over the fact-check database.
const BREAKING_EVENT_VERBS =
  /\b(fired|ousted|dismissed|removed|replaced|terminated|resigned|quit|stepped down|appointed|named|arrested|detained|indicted|charged|sentenced|impeached|dropped|withdrew)\b/i;

// Words that should NOT count as entity tokens when doing case-insensitive
// entity extraction. Covers function words, auxiliaries, pronouns, and
// temporal words so that "he was fired" doesn't look like it has a named entity.
const ENTITY_SKIP_WORDS = new Set([
  // articles / determiners
  "a", "an", "the", "this", "that", "these", "those", "some", "any",
  "all", "both", "each", "no", "every", "either", "neither",
  // pronouns
  "he", "she", "it", "they", "we", "i", "you", "who", "what", "which",
  "his", "her", "its", "their", "our", "my", "your", "him", "them", "us",
  "himself", "herself", "itself", "themselves", "someone", "anyone",
  "everyone", "nobody", "somebody", "anybody", "everybody",
  // auxiliaries / common verbs
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "shall", "must", "can", "get", "got", "been", "also", "said",
  // prepositions / conjunctions
  "and", "or", "but", "so", "yet", "for", "nor", "not", "as", "at", "by",
  "in", "on", "to", "up", "of", "off", "out", "into", "from", "with",
  "about", "after", "before", "between", "during", "through", "over",
  "under", "above", "below", "than", "while", "although", "because",
  "since", "unless", "until", "once", "if", "though", "whether", "just",
  // temporal / adverbs
  "today", "yesterday", "now", "currently", "recently", "week", "month",
  "year", "last", "next", "latest", "breaking", "when", "where", "how",
  "why", "then", "there", "here", "very", "too", "even", "still", "again",
  "always", "never", "ever", "often", "already", "soon", "only", "same",
  "new", "ago", "back", "well", "also", "just", "really", "actually",
  // time-of-day words — should not appear as entity tokens
  "night", "morning", "evening", "afternoon", "tonight", "overnight",
  "midnight", "dawn", "dusk", "noon", "daytime", "nighttime",
]);

/**
 * Extracts a short phrase of meaningful tokens from the claim, ignoring
 * stopwords, auxiliaries, and breaking event verbs. Works on any casing.
 *
 * Used as a case-insensitive fallback when title-case entity detection fails
 * (e.g. user typed "pam bondi" instead of "Pam Bondi").
 *
 *   "pam bondi was fired"   → "pam bondi"
 *   "trump fired pam bondi" → "trump pam bondi"
 *   "he was fired"          → ""  (all tokens are stopwords/verbs)
 */
function extractEntityPhrase(text: string): string {
  const tokens = text.toLowerCase().match(/\b[a-z]+\b/g) || [];
  const meaningful = tokens.filter(
    (t) => !ENTITY_SKIP_WORDS.has(t) && !BREAKING_EVENT_VERBS.test(t)
  );
  return meaningful.slice(0, 3).join(" ");
}

/**
 * Returns true if any meaningful token (≥4 chars) in the claim fuzzy-matches
 * a known temporal event verb. Used as a fallback when TEMPORAL_VERBS exact
 * match fails due to a typo ("droped" → "dropped", "resgined" → "resigned").
 */
function claimHasTemporalVerbFuzzy(text: string): boolean {
  const tokens = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  return tokens.some((t) => wordMatchesFuzzy(t, TEMPORAL_VERB_LIST));
}

/**
 * Same as above but limited to breaking event verbs — the stronger signal
 * used by isHighRecencyClaim.
 */
function claimHasBreakingVerbFuzzy(text: string): boolean {
  const tokens = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  return tokens.some((t) => wordMatchesFuzzy(t, BREAKING_VERB_LIST));
}

/**
 * Returns the most significant event verb from the claim text, or "" if none.
 * Used to include the key action word in high-recency search queries so that
 * "Drake got arrested last night" → "drake arrested latest news April 2026"
 * instead of "drake latest news April 2026".
 *
 * Tries exact match in BREAKING_VERB_LIST first, then fuzzy fallback for typos.
 */
function extractEventVerb(text: string): string {
  const lower = text.toLowerCase();
  for (const verb of BREAKING_VERB_LIST) {
    if (new RegExp(`\\b${verb}\\b`).test(lower)) return verb;
  }
  const tokens = lower.match(/\b[a-z]{4,}\b/g) || [];
  for (const verb of BREAKING_VERB_LIST) {
    if (tokens.some((t) => wordMatchesFuzzy(t, [verb]))) return verb;
  }
  return "";
}

/**
 * Given a list of entity tokens, returns only those with ≥4 chars — the
 * reliable search anchors. Drops ≤3-char tokens (typical short first names
 * like "Jos", "Pam", "Ali") when a stronger sibling exists so a misspelled
 * or ambiguous short token doesn't degrade the query.
 *
 * Falls back to the original list when every token is ≤3 chars (nothing better).
 *
 *   ["Jos", "Biden"]  → ["Biden"]
 *   ["Pam", "Bondi"]  → ["Bondi"]
 *   ["Drake"]         → ["Drake"]  (already strong)
 *   ["Jo", "Su"]      → ["Jo", "Su"]  (no stronger option)
 */
function selectStrongEntityTokens(tokens: string[]): string[] {
  const strong = tokens.filter((t) => t.length >= 4);
  return strong.length > 0 ? strong : tokens;
}

// Captures the subject of "what did X say/claim/..." queries so we can build
// a targeted statement query instead of a generic news search.
const STATEMENT_QUERY_PATTERN =
  /\bwhat did\s+(.+?)\s+(?:say|claim|announce|declare|tweet|post)\b/i;

// Economic/market topics that are inherently current-event driven.
const TEMPORAL_TOPICS =
  /\b(prices?|inflation|gas|economy|economic|markets?|interest rates?|unemployment|gdp|dow|nasdaq|s&p)\b/i;

/**
 * Returns true if the claim signals interest in events from the last ~24 hours.
 *
 * Two triggers:
 *  1. Explicit recency words — "today", "yesterday", "just", "breaking", or
 *     a "what did X say/do" question pattern.
 *  2. Breaking event verb + named entity + no explicit year — e.g.
 *     "Pam Bondi was fired" has no year, contains a person's name, and uses a
 *     verb that describes a discrete dateable event. The fact-check database is
 *     unlikely to have a fresh entry; live coverage should be queried first.
 */
function isHighRecencyClaim(text: string): boolean {
  if (HIGH_RECENCY_PHRASES.test(text)) return true;

  // Exact verb match first; fuzzy fallback for 1-char typos ("droped" → "dropped").
  const hasBreakingVerb =
    BREAKING_EVENT_VERBS.test(text) || claimHasBreakingVerbFuzzy(text);
  if (!hasBreakingVerb) return false;

  // Year guard: only block claims that reference events clearly in the past
  // (more than 2 years ago). A year like "2024" in "the 2024 race" is context,
  // not a timestamp — blocking it causes false negatives for recent cycles.
  const yearMatch = text.match(/\b((19|20)\d{2})\b/);
  if (yearMatch && parseInt(yearMatch[1]) < new Date().getFullYear() - 2) {
    return false;
  }

  // Title-case check: the claim names a specific entity.
  //   1. ALL-CAPS acronym (FBI, CIA, GOP).
  //   2. Multi-word title-case sequence (Pam Bondi, Joe Biden).
  //   3. Single proper noun ≥4 chars that is not itself a breaking verb —
  //      catches "Drake", "Trump", "Biden" used alone.
  //      The verb exclusion prevents sentence-starting verbs ("Fired from job")
  //      from being mistaken for named entities.
  const hasTitleCaseEntity =
    /\b[A-Z]{2,}\b/.test(text) ||
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(text) ||
    (text.match(/\b[A-Z][a-z]{3,}\b/g) || []).some(
      (w) => !BREAKING_EVENT_VERBS.test(w) && !ENTITY_SKIP_WORDS.has(w.toLowerCase())
    );
  if (hasTitleCaseEntity) return true;

  // Case-insensitive fallback: if ≥2 meaningful non-stopword tokens survive
  // after removing the verb and function words, assume a named person/topic is
  // present even though the user didn't capitalise it.
  return extractEntityPhrase(text).split(" ").length >= 2;
}

/**
 * Returns true if the claim is likely time-sensitive: an event that happened
 * recently, a person who was just appointed/fired, or a current economic stat.
 * Pure keyword scan — no network calls, no state.
 */
function isTimeSensitiveClaim(text: string): boolean {
  return (
    TEMPORAL_VERBS.test(text) ||
    TEMPORAL_WORDS.test(text) ||
    TEMPORAL_TOPICS.test(text) ||
    claimHasTemporalVerbFuzzy(text) // typo fallback: "droped" → "dropped"
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

/**
 * Builds a tightly-targeted query for claims with high-recency intent
 * ("today", "yesterday", "just", "breaking", "what did X say/announce").
 *
 * Three shapes:
 *   "what did Trump say"       → `"Trump" statement OR announcement April 2026`
 *   "what happened to Bondi"   → `"Pam Bondi" latest news April 2026`
 *   "gas prices just spiked"   → `gas prices latest news April 2026`
 *
 * Always includes the full month+year so the query anchors to the current
 * news cycle rather than evergreen results.
 */
function buildHighRecencyQuery(text: string): string {
  const month = new Date().toLocaleString("en-US", { month: "long" });
  const year = new Date().getFullYear();
  const dateStr = `${month} ${year}`;

  // "What did X say/claim/announce" → entity + statement angle.
  const stmtMatch = text.match(STATEMENT_QUERY_PATTERN);
  if (stmtMatch) {
    const subject = stmtMatch[1].trim();
    // Quote multi-word subjects so the API treats them as a phrase.
    const subjectPart = subject.includes(" ") ? `"${subject}"` : subject;
    return `${subjectPart} statement OR announcement ${dateStr}`;
  }

  // All other high-recency claims: extract named entities, then build a
  // "latest news" query anchored to the current date.
  //
  // Entities are NOT quoted here (avoids zero-results for misspelled names).
  //
  // Short tokens (≤3 chars) in multi-word entities are dropped via
  // selectStrongEntityTokens: "Jos Biden" → use only "Biden" as the query
  // anchor. The search engine handles the rest. This prevents a misspelled
  // first name from producing a weak or zero-result query.
  //
  //   "Jos Biden dropped out" → "Biden dropped latest news April 2026"
  //   "Pam Bondi was fired"   → "Bondi fired latest news April 2026"
  //   "Kristi Noem resigned"  → "Kristi Noem resigned latest news April 2026"
  const rawEntities: string[] = [];
  for (const m of text.match(/\b[A-Z]{2,}\b/g) || []) rawEntities.push(m);
  for (const m of text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) || []) rawEntities.push(m);

  if (rawEntities.length > 0) {
    // For each multi-word entity, keep only strong (≥4-char) tokens.
    // ALL-CAPS acronyms (FBI, CIA) are always kept — single tokens, all strong.
    const queryEntities = rawEntities.map((e) =>
      selectStrongEntityTokens(e.split(/\s+/)).join(" ")
    );
    const verb = extractEventVerb(text);
    return `${queryEntities.join(" ")}${verb ? " " + verb : ""} latest news ${dateStr}`;
  }

  // Case-insensitive fallback: extract meaningful tokens (excludes stopwords
  // and event verbs) to get the person/topic phrase from the claim.
  const entityPhrase = extractEntityPhrase(text);
  if (entityPhrase) {
    const strong = selectStrongEntityTokens(entityPhrase.split(/\s+/)).join(" ");
    const verb = extractEventVerb(text);
    return `${strong}${verb ? " " + verb : ""} latest news ${dateStr}`;
  }

  // Last resort: strip vague prefix and search for "latest news".
  const stripped = stripVaguePrefix(text) || text;
  return `${stripped} latest news ${dateStr}`;
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

// ---------------------------------------------------------------------------
// Fuzzy word matching — used to tolerate 1-character typos in entity names
// ---------------------------------------------------------------------------

/**
 * Standard Levenshtein edit distance between two strings.
 * Space-optimised: O(min(m,n)) memory, O(mn) time.
 * Only called on short name tokens (≤ ~20 chars) so performance is fine.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Returns true if `word` appears in `haystackWords` either exactly or within
 * `maxDist` edit distance.
 *
 * Guards:
 *   - Words ≤ 3 chars require exact match — "is"/"in"/"at" are too short to
 *     fuzzy-match safely without false positives.
 *   - Length-difference pre-check avoids running DP on obviously distant pairs.
 *
 * Examples:
 *   wordMatchesFuzzy("jos",  ["joe", "biden"]) → true  (dist("jos","joe")=1)
 *   wordMatchesFuzzy("bden", ["joe", "biden"]) → true  (dist("bden","biden")=1)
 *   wordMatchesFuzzy("is",   ["his", "this"])  → false (too short for fuzzy)
 */
function wordMatchesFuzzy(word: string, haystackWords: string[], maxDist = 1): boolean {
  if (haystackWords.includes(word)) return true;
  if (word.length <= 3) return false;
  return haystackWords.some(
    (hw) =>
      Math.abs(hw.length - word.length) <= maxDist &&
      editDistance(word, hw) <= maxDist
  );
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
    const haystackWords = haystack.match(/\b[a-z]+\b/g) || [];
    const entityFound = entities.some((e) =>
      e.split(/\s+/).filter(Boolean).every((w) => wordMatchesFuzzy(w, haystackWords))
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

/**
 * Lighter relevance filter used for high-recency SerpAPI results.
 *
 * Why not passesTemporalFilter here:
 *   passesTemporalFilter requires PASSIVE_ARTICLE_INDICATOR and EVENT_TERMS
 *   to appear in the article. Breaking-news headlines routinely use active
 *   present tense ("Trump fires Bondi", "Senate votes to remove X") — none
 *   of which match those patterns. Because the SerpAPI query is already
 *   highly targeted ("Pam Bondi latest news April 2026"), the search engine
 *   has done the relevance work; we only need to confirm the named entity
 *   actually appears in the result.
 *
 * Keeps: entity-presence check (prevents completely off-topic results).
 * Drops: PASSIVE_ARTICLE_INDICATOR check, EVENT_TERMS check.
 */
function passesHighRecencyFilter(claimText: string, match: any): boolean {
  const haystack = [
    String(match?.title || ""),
    String(match?.snippet || ""),
  ].join(" ").toLowerCase();

  // Try title-case entity extraction first (fast path for well-formed input).
  // Fall back to extractEntityPhrase for all-lowercase input ("jos biden was
  // fired" → no title-case found → ["jos", "biden"] still checked).
  let entities = extractClaimEntities(claimText);
  if (entities.length === 0) {
    const phrase = extractEntityPhrase(claimText);
    if (phrase) entities = [phrase];
  }

  if (entities.length === 0) return true; // truly nothing to check against

  const haystackWords = haystack.match(/\b[a-z]+\b/g) || [];
  return entities.some((e) =>
    e.split(/\s+/).filter(Boolean).every((w) => wordMatchesFuzzy(w, haystackWords))
  );
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

export async function routeVerification(
  text: string,
  intent?: ClaimIntent
): Promise<VerificationResult> {
  let google: VerificationResult = { status: "no_match", matches: [] };
  let tavily: VerificationResult = { status: "no_match", matches: [] };
  let serp: VerificationResult = { status: "no_match", matches: [] };
  let bing: VerificationResult = { status: "no_match", matches: [] };
  let news: VerificationResult = { status: "no_match", matches: [] };

  const domain = intent?.domain ?? "general";

  // Domain-aware temporal override:
  //   economic / sports / current_events → always use the temporal (news-first)
  //   path even when the text lacks explicit temporal verbs, because the data
  //   they describe changes frequently and news providers have better coverage.
  const domainForcesNews =
    domain === "economic" || domain === "sports" || domain === "current_events";

  // Detect time-sensitive claims (firings, appointments, prices, current events).
  // Google Fact Check stays on the raw query — year injection can over-narrow its
  // static verdict DB. Bing and NewsAPI get the year-augmented query so they
  // surface recent articles ahead of evergreen results.
  const temporal = domainForcesNews || isTimeSensitiveClaim(text);
  // High-recency: subset of temporal — "today", "yesterday", "just", "breaking",
  // or "what did X say/do". Triggers tighter Tavily window and a more targeted
  // query template (latest news / statement / controversy + full month+year).
  const highRecency = temporal && isHighRecencyClaim(text);
  // Explicit high-recency: the user actually said "today", "yesterday", "just",
  // "breaking", or asked "what did X say/do". This is the ONLY case that gets
  // the tight 1-day search window and the Google Fact Check bypass.
  //
  // Inferred high-recency (event verb + named entity, no time word) is a weaker
  // signal — the event may have happened days, weeks, or months ago. Applying
  // a 1-day window for those claims causes established events like
  // "Pam Bondi was fired" (fired weeks ago) to return no results, which the
  // UI surfaces as "Too early to call". Wide windows fix this.
  const explicitHighRecency = HIGH_RECENCY_PHRASES.test(text);
  // Classify claim type to tune query construction for vague and broad claims.
  // Only computed for temporal claims; non-temporal always use raw text.
  const claimType = temporal ? classifyClaimType(text) : "event";
  // Query priority for temporal claims:
  //   1. High-recency: dedicated query with latest news / statement + full date
  //   2. Structured boolean query for named-person + event-verb (event/passive)
  //   3. Typed expansion for vague ("X news 2026") or broad ("X latest data Apr 2026")
  //   4. Year-appended plain text fallback
  const newsQuery = temporal
    ? (highRecency
        ? buildHighRecencyQuery(text)
        : (buildNamedEntityEventQuery(text) ?? buildTypedQuery(text, claimType) ?? buildTemporalQuery(text)))
    : text;
  // Bing freshness: explicit high-recency → 1 day; inferred high-recency or
  // other temporal → 14 days so established events are still reachable.
  const bingFreshnessDays = explicitHighRecency ? 1 : temporal ? 14 : 7;
  // Tavily freshness: explicit high-recency → 1 day; inferred high-recency or
  // other temporal → 30 days so claims about events from weeks ago resolve.
  const tavilyDays = explicitHighRecency ? 1 : temporal ? 30 : 3;

  // [DEBUG] Remove before shipping.
  console.log(
    `[routeVerification] claim="${text}" domain=${domain} temporal=${temporal} highRecency=${highRecency} explicitHighRecency=${explicitHighRecency}` +
    ` newsQuery="${newsQuery}" tavilyDays=${tavilyDays} bingFreshnessDays=${bingFreshnessDays}`
  );

  // 1) Formal fact checks first — only short-circuit if matches carry a rating.
  //    Unrated Google entries (URL-only, no verdict text) fall through to Bing
  //    so the user gets richer coverage context rather than a bare link.
  //    The unrated results are preserved in `google` and used as a last resort
  //    at the end if Bing and NewsAPI also find nothing.
  //
  //    Exception: highRecency event claims (e.g. "Pam Bondi was fired") skip
  //    the early Google return so Tavily and SerpAPI can surface live coverage
  //    first. Google's result is still returned as a fallback at the end if
  //    every live provider misses.
  try {
    google = await googleFactCheckSearch(text);

    if (!explicitHighRecency && google.status === "matched" && hasMatches(google) && hasRatedMatches(google)) {
      console.log("[routeVerification] winner=google_factcheck"); // [DEBUG]
      return {
        status: "matched",
        matches: google.matches,
        top: google.top ?? google.matches[0],
        mode: google.mode ?? "fact_check",
      };
    }

    // For scientific and historical claims, Google Fact Check is the highest-
    // epistemic-quality source available. If it has any match (even unrated),
    // return it immediately rather than falling through to news providers whose
    // results are journalistic coverage rather than fact-check verdicts.
    if (
      (domain === "scientific" || domain === "historical") &&
      google.status === "matched" &&
      hasMatches(google) &&
      !explicitHighRecency
    ) {
      console.log("[routeVerification] winner=google_factcheck_domain_early"); // [DEBUG]
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
      tavily = await tavilySearch(newsQuery, { days: tavilyDays, maxResults: 5 });

      if (tavily.status === "matched" && hasMatches(tavily)) {
        const tavilyMatches = tavily.matches.filter((m) => passesTemporalFilter(text, m));
        if (tavilyMatches.length > 0) {
          console.log("[routeVerification] winner=tavily"); // [DEBUG]
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

  // 3) SerpAPI Google Search — high-recency claims only (today/yesterday/just/breaking,
  //    or "what did X say"). Runs after Tavily so Tavily's semantic results take
  //    priority; SerpAPI fills the gap when Tavily finds nothing usable.
  if (highRecency) {
    // Build a filter-safe version of the claim with ≤3-char tokens removed from
    // multi-word title-case entities. passesHighRecencyFilter's wordMatchesFuzzy
    // has a hard ≤3-char guard, so "Jos" in "Jos Biden" can never fuzzy-match
    // "Joe" — stripping it lets the reliable "Biden" token anchor the check.
    // The filter function itself is unchanged; we just give it better input.
    //   "Jos Biden dropped out" → "Biden dropped out"
    //   "Kristi Noem resigned"  → "Kristi Noem resigned"  (both tokens ≥4, unchanged)
    const highRecencyFilterText = text.replace(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
      (m) => {
        const strong = m.split(/\s+/).filter((t) => t.length >= 4);
        return strong.length > 0 ? strong.join(" ") : m;
      }
    );
    console.log(`[routeVerification] highRecencyFilterText="${highRecencyFilterText}"`); // [DEBUG]

    try {
      serp = await serpApiSearch(newsQuery, { num: 5 });

      // [DEBUG] Remove before shipping.
      const _serpRaw = Array.isArray(serp.matches) ? serp.matches.length : 0;
      if (serp.status === "matched" && hasMatches(serp)) {
        // High-recency claims use the lenient filter — entity presence only.
        // passesTemporalFilter rejects active-voice breaking-news headlines.
        const serpMatches = serp.matches.filter((m) => passesHighRecencyFilter(highRecencyFilterText, m));
        console.log(
          `[routeVerification] serp.status=${serp.status} raw=${_serpRaw} filtered=${serpMatches.length}`
        ); // [DEBUG]
        if (serpMatches.length > 0) {
          console.log("[routeVerification] winner=serpapi"); // [DEBUG]
          return {
            status: "matched",
            matches: serpMatches,
            top: serpMatches[0],
            mode: "recent_coverage",
          };
        }
      } else {
        console.log(`[routeVerification] serp.status=${serp.status} raw=${_serpRaw} filtered=0`); // [DEBUG]
      }
    } catch (err: any) {
      serp = {
        status: "error",
        matches: [],
        message: err?.message || "SerpAPI provider failure.",
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
        console.log("[routeVerification] winner=bing"); // [DEBUG]
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
        console.log("[routeVerification] winner=newsapi"); // [DEBUG]
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
    console.log("[routeVerification] winner=google_factcheck_unrated"); // [DEBUG]
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
    serp.status === "error" &&
    bing.status === "error" &&
    news.status === "error";

  if (allErrored) {
    return {
      status: "error",
      matches: [],
      message:
        getMessage(google) ||
        getMessage(serp) ||
        getMessage(bing) ||
        getMessage(news) ||
        "All verification providers failed.",
    };
  }

  const noMatchMessages = [
    google.status === "no_match" ? getMessage(google) : "",
    tavily.status === "no_match" ? getMessage(tavily) : "",
    serp.status === "no_match" ? getMessage(serp) : "",
    bing.status === "no_match" ? getMessage(bing) : "",
    news.status === "no_match" ? getMessage(news) : "",
  ].filter(Boolean);

  return {
    status: "no_match",
    matches: [],
    message: noMatchMessages[0] || "No matching fact check or recent coverage found.",
  };
}