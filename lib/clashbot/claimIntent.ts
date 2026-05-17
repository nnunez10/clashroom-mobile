// lib/clashbot/claimIntent.ts
//
// Lightweight heuristic classifier that runs before routeVerification().
// Determines whether a claim is worth routing to any provider, what kind of
// claim it is, and which verification domain best fits it.
//
// Deliberately no ML, no network calls, no imports from other engine modules.
// Designed to be stable under future ClaimDNA evolution — ClaimIntent is the
// intended hook point for attaching richer classification later.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ClaimCategory =
  | "factual"       // worth routing to a provider
  | "opinion"       // "I think / I believe / in my opinion"
  | "rhetorical"    // "isn't it obvious / everyone knows / clearly"
  | "chatter"       // conversational noise with no assertion
  | "question"      // pure interrogative without embedded claim
  | "subjective";   // comparison without a verifiable standard

export type ClaimDomain =
  | "scientific"      // vaccines, climate, medicine, biology
  | "historical"      // dated past events, firsts, records
  | "economic"        // prices, GDP, unemployment, markets
  | "political"       // legislation, elections, governance
  | "sports"          // scores, records, player/team stats
  | "current_events"  // temporal breaking news (person fired/arrested/…)
  | "general";        // encyclopedic / no strong domain signal

export type ClaimIntent = {
  /** High-level claim type. Determines whether we route at all. */
  category: ClaimCategory;
  /** Best-fit verification domain. Informs provider ordering in the router. */
  domain: ClaimDomain;
  /**
   * Composite worthiness score, 0–1.
   * Claims below WORTHINESS_THRESHOLD are returned as no_match immediately,
   * without touching any external provider.
   */
  worthiness: number;
  /**
   * Human-readable signals that drove the classification.
   * Included in debug logs; designed to become a ClaimDNA field once the
   * DNA layer gains semantic annotation.
   */
  signals: string[];
};

/** Claims below this score never reach routeVerification(). */
export const WORTHINESS_THRESHOLD = 0.2;

// ---------------------------------------------------------------------------
// Category detection patterns
// ---------------------------------------------------------------------------

// Conversational openers — these almost never lead a genuine factual assertion.
// Ordered to match both bare tokens and compound starters.
const CHATTER_OPENERS =
  /^(well[,\s]|yeah[,\s]|yep[,\s]|yup[,\s]|nope[,\s]|nah[,\s]|okay[,\s]|ok[,\s]|right[,\s]|so[,\s]|like[,\s]|look[,\s]|hey[,\s]|listen[,\s]|alright[,\s]|hmm[,\s]|uh[,\s]|um[,\s]|bruh[,\s]|bro[,\s]|fr[,\s]|lmao[,\s]|lol[,\s]|omg[,\s]|wow[,\s]|wait[,\s]|no cap[,\s]|lowkey[,\s]|ngl[,\s]|tbh[,\s]|imo[,\s])/i;

// Direct address / conversation about the other speaker, not a fact.
const DIRECT_ADDRESS =
  /\b(why (are|do|did|would|should|is|you) you|what (are|do|did|is) you (saying|talking|thinking|doing)|you('re| are) saying|you said|why (you|would you)|you talking|you always|why you)\b/i;

// Personal reactions that comment on the conversation, not assert a fact.
const PERSONAL_REACTION =
  /^(that('s| is)|this is|it('s| is)) (crazy|insane|stupid|dumb|ridiculous|obvious|wild|cap|not cap|a lie|lies|false|wrong|right|bs|nonsense)/i;

// First-person opinion declarations — speaker is expressing a view, not a fact.
const OPINION_MARKERS =
  /^(i (think|believe|feel|know|would say|don't think|don't believe)|in my (opinion|view|experience|perspective)|imo\b|to me\b|personally\b|don't you (think|agree)|seems to me|if you ask me)\b/i;

// Rhetorical assertions that assume shared knowledge rather than stating a fact.
const RHETORICAL_MARKERS =
  /\b(isn't it obvious|everyone knows|clearly\b|obviously\b|of course\b|it goes without saying|don't you think|any reasonable person|you'd have to agree|it's common knowledge)\b/i;

// Subjective comparisons — opinion disguised as a ranking claim.
const SUBJECTIVE_MARKERS =
  /\b(better than|worse than|is the best|is the worst|superior to|inferior to|more important than|less important than|greatest of all time|\bgoat\b|g\.o\.a\.t)\b/i;

// Pure interrogative: starts with a question word AND ends with "?".
// A question that embeds an assertion ("did you know that vaccines cause X?")
// will still pass the sentence-ending check, but its assertion part is factual.
const PURE_QUESTION =
  /^(who|what|when|where|why|how|did|does|do|is|are|was|were|can|could|would|should|will)\b.+\?$/i;

// ---------------------------------------------------------------------------
// Domain detection patterns
// ---------------------------------------------------------------------------

const SCIENTIFIC_TERMS =
  /\b(vaccine|vaccination|covid|coronavirus|climate change|global warming|climate hoax|evolution|dna|rna|gene|cancer|autism|virus|bacteria|pathogen|study shows|research (shows|finds|says|found)|scientists (say|found|report|claim)|peer.reviewed|clinical (trial|study)|causes? (disease|cancer|diabetes|heart)|cure[sd]?|treatment|immunization|immune system|flat earth|chemtrail|anti.?vaxx?|pseudoscience|homeopathy)\b/i;

const HISTORICAL_TERMS =
  /\b(in (19|18|17|16|15)\d{2}|world war (i|ii|1|2|one|two)|civil war|cold war|great depression|founded|invented by|discovered by|first (man|woman|person|country|nation) to|world record|longest|tallest|shortest|oldest|created by|built in \d{4}|the holocaust|the revolution|moon landing|moon walk|apollo (11|mission|program)|jfk\b|kennedy assassination|9\/11|september 11|world trade center|pearl harbor|area 51)\b/i;

const ECONOMIC_TERMS =
  /\b(\d+(\.\d+)?%|inflation|gdp|gross domestic product|unemployment( rate)?|jobs report|trade (deficit|surplus)|national debt|interest rate|dow jones|nasdaq|s&p (500)?|stock market|economy (grew|shrank|contracted|expanded)|prices? (rose|fell|increased|decreased|are (up|down)|went up|went down)|minimum wage|federal reserve|tariff)\b/i;

const POLITICAL_TERMS =
  /\b(congress(ional)?|senate|senator|representative|president|governor|mayor|white house|executive order|bill|legislation|passed (the|a|into)|signed into law|vetoed|election|ballot|vote[sd]?|political party|democrat|republican|administration|policy)\b/i;

const SPORTS_TERMS =
  /\b(nfl|nba|mlb|nhl|mls|super bowl|world series|championship|playoffs|touchdown|home run|hat trick|score|win(s|ning|ner)|loss|beat|defeated|mvp|roster|draft pick|batting average|\bera\b|yards|points per game|standings|season record)\b/i;

// Temporal event verbs that signal a breaking/recent occurrence.
const CURRENT_EVENT_VERBS =
  /\b(fired|resigned|appointed|arrested|indicted|charged|elected|announced|declared|signed|banned|expelled|impeached|convicted|sentenced|launched|stepped down|ousted|removed)\b/i;

function detectDomain(lower: string, original: string): ClaimDomain {
  if (SCIENTIFIC_TERMS.test(lower)) return "scientific";
  if (ECONOMIC_TERMS.test(lower)) return "economic";
  if (HISTORICAL_TERMS.test(lower)) return "historical";
  if (POLITICAL_TERMS.test(lower)) return "political";
  if (SPORTS_TERMS.test(lower)) return "sports";
  if (CURRENT_EVENT_VERBS.test(lower)) return "current_events";
  return "general";
}

// ---------------------------------------------------------------------------
// Worthiness scoring
// ---------------------------------------------------------------------------

// Verbs that signal a factual assertion (as opposed to filler or opinion).
const ASSERTION_VERBS =
  /\b(is|are|was|were|has|have|had|causes?|proves?|proven|shows?|confirms?|says|said|increases?|decreases?|grew|fell|rose|dropped|reached|surpassed|exceeded)\b/i;

function hasNamedEntity(text: string): boolean {
  // Title-case word after the first position — not a sentence-start capital.
  const words = text.split(/\s+/);
  return words.slice(1).some((w) => /^[A-Z][a-z]{2,}/.test(w));
}

function hasNumber(text: string): boolean {
  return /\d/.test(text);
}

function computeWorthiness(text: string, category: ClaimCategory): number {
  // Non-factual categories get fixed low scores, never reaching the threshold.
  switch (category) {
    case "chatter":   return 0;
    case "subjective": return 0.05;
    case "rhetorical": return 0.1;
    case "question":   return 0.1;
    case "opinion":    return 0.15;
    case "factual":    break;
  }

  // Factual category: score the claim on specificity signals.
  let score = 0.3; // base — passes the threshold on its own

  if (ASSERTION_VERBS.test(text)) score += 0.15;
  if (hasNumber(text))            score += 0.20;
  if (hasNamedEntity(text))       score += 0.15;

  // Citation / attribution phrases are strong signals of a sourced claim.
  if (/\b(according to|study shows|data shows|report says|statistics show|research (shows|finds)|per the)\b/i.test(text)) {
    score += 0.15;
  }

  // Superlatives / absolutes: "the highest ever", "never happened", "all vaccines"
  if (/\b(always|never|all\b|none\b|every|no one|everyone|impossible|proven|highest ever|lowest ever|most (ever|in history)|record)\b/i.test(text)) {
    score += 0.05;
  }

  // Longer claims carry more verifiable content on average.
  if (text.length > 40) score += 0.05;

  return Math.min(1, score);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classifies a claim text into a category, domain, and worthiness score.
 * Runs synchronously — no I/O, no network, no imports from other engine modules.
 *
 * The returned `ClaimIntent` is designed to be forward-compatible with ClaimDNA:
 * when the DNA layer gains semantic annotation, `category`, `domain`, and
 * `signals` can be persisted alongside the fingerprint without a breaking change.
 */
export function classifyClaimIntent(text: string): ClaimIntent {
  const lower = text.toLowerCase().trim();
  const signals: string[] = [];

  // ── Category detection (priority: chatter → question → rhetorical → opinion → subjective → factual) ──
  let category: ClaimCategory = "factual";

  if (
    CHATTER_OPENERS.test(lower) ||
    DIRECT_ADDRESS.test(text) ||
    PERSONAL_REACTION.test(lower)
  ) {
    category = "chatter";
    if (CHATTER_OPENERS.test(lower))  signals.push("chatter_opener");
    if (DIRECT_ADDRESS.test(text))    signals.push("direct_address");
    if (PERSONAL_REACTION.test(lower)) signals.push("personal_reaction");
  } else if (PURE_QUESTION.test(text.trim())) {
    category = "question";
    signals.push("pure_question");
  } else if (RHETORICAL_MARKERS.test(lower)) {
    category = "rhetorical";
    signals.push("rhetorical_marker");
  } else if (OPINION_MARKERS.test(lower)) {
    category = "opinion";
    signals.push("opinion_marker");
  } else if (SUBJECTIVE_MARKERS.test(lower)) {
    category = "subjective";
    signals.push("subjective_comparison");
  } else {
    // Factual — record the positive signals that contributed.
    if (hasNumber(text))              signals.push("has_number");
    if (hasNamedEntity(text))         signals.push("has_named_entity");
    if (ASSERTION_VERBS.test(text))   signals.push("has_assertion_verb");
  }

  const domain = detectDomain(lower, text);
  if (domain !== "general") signals.push(`domain:${domain}`);

  const worthiness = computeWorthiness(text, category);

  return { category, domain, worthiness, signals };
}
