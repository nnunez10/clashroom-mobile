// lib/clashbot/useMockClashBotEngine.ts

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verifyClaimText } from ".";
import { areClaimsInSameFamily, getClaimDna } from "./claimDna";
import { Claim, claimFingerprint, extractClaimsFromLine } from "./extractClaims";
import { findKnownFactOverride } from "./knownFacts";
import { startMockTranscriptStream } from "./mockStream";

type EngineOptions = {
  demoMode?: boolean;
};

type Stance = "supported" | "contradicted" | "unclear";

type ClaimStatus =
  | "queued"
  | "checking"
  | "matched"
  | "no_match"
  | "error"
  | "disputed";

type FactCheckMatch = {
  provider?: string;
  claim?: string;
  claimReviewed?: string;
  claimDate?: string;
  url?: string;
  publisher?: string;
  title?: string;
  text?: string;
  snippet?: string;
  rating?: {
    text?: string;
    raw?: string;
  };
};

type VerificationResult = {
  status?: "matched" | "no_match" | "error";
  mode?: "fact_check" | "recent_coverage";
  matches?: FactCheckMatch[];
  top?: FactCheckMatch;
  message?: string;
  stance?: Stance;
  relevance?: {
    relevant: boolean;
    reason: string;
  };
};

type EvidenceRecord = {
  id: string;
  provider: string;
  kind: "fact_check" | "coverage" | "override" | "unknown";
  url?: string;
  publisher?: string;
  title?: string;
  claim?: string;
  claimReviewed?: string;
  claimDate?: string;
  snippet?: string;
  ratingText?: string;
  ratingRaw?: string;
  capturedAt: number;
  supports?: boolean;
  contradicts?: boolean;
  stance?: Stance;
};

type ClaimEventType =
  | "claim_detected"
  | "claim_queued"
  | "claim_check_started"
  | "claim_override_matched"
  | "claim_match_found"
  | "claim_supported"
  | "claim_contradicted"
  | "claim_unclear"
  | "claim_no_match"
  | "claim_error";

type ClaimEvent = {
  id: string;
  type: ClaimEventType;
  at: number;
  message?: string;
  meta?: Record<string, any>;
};

type EngineClaim = Claim & {
  createdAt?: number;
  status?: ClaimStatus;
  verification?: VerificationResult | any;
  checkingAt?: number;
  completedAt?: number;
  timeline?: {
    queuedAt?: number;
    checkingAt?: number;
    completedAt?: number;
  };
  claimDna?: ReturnType<typeof getClaimDna>;
  fingerprint?: string;
  familyId?: string;
  derivedFromClaimId?: string | null;
  evidence?: EvidenceRecord[];
  events?: ClaimEvent[];
};

function safeString(x: any) {
  return typeof x === "string" ? x : "";
}

function makeId(prefix: string, seed?: string) {
  const base = String(seed || `${Date.now()}_${Math.random()}`);
  let hash = 2166136261;

  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function tokenizeLower(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "from",
  "with",
  "about",
  "this",
  "that",
  "it",
  "as",
  "by",
  "you",
  "your",
  "we",
  "they",
  "he",
  "she",
  "i",
  "me",
  "my",
  "our",
  "their",
  "not",
  "no",
  "yes",
  "up",
  "down",
  "over",
  "under",
]);

const CONTRADICTION_PHRASES = [
  "false",
  "not true",
  "incorrect",
  "inaccurate",
  "misleading",
  "debunked",
  "no evidence",
  "lacks evidence",
  "without evidence",
  "fact check false",
  "fact-check false",
  "fact check: false",
  "fact-check: false",
  "pants on fire",
  "wrong",
  "hoax",
  "myth",
  "refuted",
  "contradicted",
];

const SUPPORT_PHRASES = [
  "true",
  "correct",
  "accurate",
  "confirmed",
  "supported by data",
  "supported by evidence",
  "verified",
  "fact check true",
  "fact-check true",
  "fact check: true",
  "fact-check: true",
  "mostly true",
  "supported",
];

function meaningfulTokens(s: string) {
  return tokenizeLower(s).filter((t) => t.length >= 4 && !STOP.has(t));
}

function extractNumbers(s: string) {
  const text = String(s || "");
  const matches = text.match(/(\$?\d[\d,]*(?:\.\d+)?%?)/g) || [];
  return matches.map((m) => m.replace(/,/g, "").toLowerCase());
}

function extractNamedEntitiesHeuristic(s: string) {
  const text = String(s || "");

  const capsPhrases = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g) || [];
  const allCaps = text.match(/\b([A-Z]{2,})\b/g) || [];

  const combined = [...capsPhrases, ...allCaps]
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 3);

  return Array.from(new Set(combined.map((x) => x.toLowerCase())));
}

function setOverlapCount(a: string[], b: string[]) {
  const setB = new Set(b);
  let shared = 0;
  for (const t of a) {
    if (setB.has(t)) shared++;
  }
  return shared;
}

function buildCandidateText(result: any, top: any) {
  return [
    safeString(top?.claim),
    safeString(top?.claimReviewed),
    safeString(top?.title),
    safeString(top?.text),
    safeString(top?.snippet),
    safeString(top?.publisher),
    safeString(top?.rating?.text),
    safeString(result?.message),
  ]
    .filter(Boolean)
    .join(" ");
}

type RelevanceAssessment = {
  relevant: boolean;
  reason: string;
};

function assessRelevance(
  claimText: string,
  matchText: string,
  mode?: "fact_check" | "recent_coverage"
): RelevanceAssessment {
  const claimNums = extractNumbers(claimText);
  const matchNums = extractNumbers(matchText);

  const claimEnts = extractNamedEntitiesHeuristic(claimText);
  const matchEnts = extractNamedEntitiesHeuristic(matchText);

  const sharedNums = setOverlapCount(claimNums, matchNums);
  const sharedEnts = setOverlapCount(claimEnts, matchEnts);

  const hasAnchors = claimNums.length > 0 || claimEnts.length > 0;

  if (hasAnchors) {
    if (sharedNums >= 1 || sharedEnts >= 1) {
      return {
        relevant: true,
        reason: "Source shares a key entity or number with the claim.",
      };
    }

    return {
      relevant: false,
      reason: "Returned source does not share a key entity or number with the claim.",
    };
  }

  const a = meaningfulTokens(claimText);
  const b = meaningfulTokens(matchText);

  if (a.length === 0 || b.length === 0) {
    return {
      relevant: false,
      reason: "Not enough meaningful overlap to verify relevance.",
    };
  }

  const shared = setOverlapCount(a, b);
  const overlap = shared / Math.max(1, Math.min(a.length, b.length));

  if (mode === "recent_coverage") {
    if (shared >= 2 || overlap >= 0.18) {
      return {
        relevant: true,
        reason: "Recent coverage appears meaningfully related to the claim.",
      };
    }

    return {
      relevant: false,
      reason: "Recent coverage found, but it appears only loosely related.",
    };
  }

  if (shared >= 2 || overlap >= 0.22) {
    return {
      relevant: true,
      reason: "Source text is meaningfully related to the claim.",
    };
  }

  return {
    relevant: false,
    reason: "Returned source appears related, but relevance is weak.",
  };
}

function mergeVerificationMessage(result: any, extra: string) {
  const prior = safeString(result?.message).trim();
  if (!prior) return extra;
  if (prior.includes(extra)) return prior;
  return `${prior} ${extra}`.trim();
}

function countPhraseHits(text: string, phrases: string[]) {
  const hay = String(text || "").toLowerCase();
  let hits = 0;
  for (const phrase of phrases) {
    if (hay.includes(phrase)) hits++;
  }
  return hits;
}

function classifyClaimStance(claimText: string, matchText: string, result: any): Stance {
  const combined = [
    safeString(matchText),
    safeString(result?.message),
    safeString(result?.top?.rating?.text),
    safeString(result?.matches?.[0]?.rating?.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const contradictionHits = countPhraseHits(combined, CONTRADICTION_PHRASES);
  const supportHits = countPhraseHits(combined, SUPPORT_PHRASES);

  const claimNums = extractNumbers(claimText);
  const matchNums = extractNumbers(matchText);
  const claimEnts = extractNamedEntitiesHeuristic(claimText);
  const matchEnts = extractNamedEntitiesHeuristic(matchText);

  const sharedNums = setOverlapCount(claimNums, matchNums);
  const sharedEnts = setOverlapCount(claimEnts, matchEnts);

  if (contradictionHits > supportHits && contradictionHits >= 1) {
    return "contradicted";
  }

  if (supportHits > contradictionHits && supportHits >= 1) {
    return "supported";
  }

  if (sharedNums >= 1 || sharedEnts >= 1) {
    return "unclear";
  }

  return "unclear";
}

function buildOverrideVerification(override: ReturnType<typeof findKnownFactOverride>) {
  if (!override) return null;

  return {
    status: "matched" as const,
    mode: "fact_check" as const,
    stance: override.contradictsClaim ? ("contradicted" as const) : ("supported" as const),
    relevance: {
      relevant: true,
      reason: "Known fact override matched this claim family.",
    },
    matches: [
      {
        provider: "known_fact_override",
        claim: override.reason,
        url: override.sourceUrl || "",
        publisher: override.sourceLabel || "Known facts",
        title: override.label || "Known fact override",
        rating: {
          text: override.contradictsClaim ? "Contradicted" : "Supported",
          raw: override.contradictsClaim ? "Contradicted" : "Supported",
        },
        snippet: override.reason,
      },
    ],
    top: {
      provider: "known_fact_override",
      claim: override.reason,
      url: override.sourceUrl || "",
      publisher: override.sourceLabel || "Known facts",
      title: override.label || "Known fact override",
      rating: {
        text: override.contradictsClaim ? "Contradicted" : "Supported",
        raw: override.contradictsClaim ? "Contradicted" : "Supported",
      },
      snippet: override.reason,
    },
    message: override.reason,
  };
}

function normalizeEvidenceKind(provider?: string, mode?: string): EvidenceRecord["kind"] {
  if (provider === "known_fact_override") return "override";
  if (mode === "fact_check" || provider === "google_factcheck") return "fact_check";
  if (mode === "recent_coverage" || provider === "bing_news" || provider === "newsapi") {
    return "coverage";
  }
  return "unknown";
}

function buildEvidenceFromMatches(
  matches: FactCheckMatch[] | undefined,
  mode: VerificationResult["mode"],
  stance: Stance,
  capturedAt: number
): EvidenceRecord[] {
  const list = Array.isArray(matches) ? matches : [];

  return list.map((m, index) => {
    const provider = safeString(m?.provider) || "unknown";

    return {
      id: makeId("evidence", `${provider}_${m?.url || m?.title || index}_${capturedAt}`),
      provider,
      kind: normalizeEvidenceKind(provider, mode),
      url: safeString(m?.url) || undefined,
      publisher: safeString(m?.publisher) || undefined,
      title: safeString(m?.title) || undefined,
      claim: safeString(m?.claim) || undefined,
      claimReviewed: safeString(m?.claimReviewed) || undefined,
      claimDate: safeString(m?.claimDate) || undefined,
      snippet: safeString(m?.snippet) || undefined,
      ratingText: safeString(m?.rating?.text) || undefined,
      ratingRaw: safeString(m?.rating?.raw) || undefined,
      capturedAt,
      supports: stance === "supported",
      contradicts: stance === "contradicted",
      stance,
    };
  });
}

function appendClaimEvent(
  claim: EngineClaim,
  type: ClaimEventType,
  at: number,
  message?: string,
  meta?: Record<string, any>
): ClaimEvent[] {
  const nextEvent: ClaimEvent = {
    id: makeId("evt", `${claim.id}_${type}_${at}_${message || ""}`),
    type,
    at,
    message,
    meta,
  };

  return [...(claim.events || []), nextEvent];
}

function withTimeline(claim: EngineClaim, patch: Partial<EngineClaim>): EngineClaim {
  return {
    ...claim,
    ...patch,
    timeline: {
      queuedAt: claim.timeline?.queuedAt ?? claim.createdAt ?? Date.now(),
      checkingAt: patch.checkingAt ?? claim.timeline?.checkingAt,
      completedAt: patch.completedAt ?? claim.timeline?.completedAt,
    },
  };
}

export function useMockClashBotEngine(options: EngineOptions = {}) {
  const demoMode = !!options.demoMode;

  const [transcript, setTranscript] = useState<string[]>([]);
  const [claims, setClaims] = useState<EngineClaim[]>([]);

  const seenClaimsRef = useRef<Set<string>>(new Set());
  const seenClaimTextsRef = useRef<string[]>([]);
  const familyClaimIdMapRef = useRef<Map<string, string>>(new Map());

  const [lastClaimAt, setLastClaimAt] = useState<number>(0);
  const verifyingRef = useRef(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lastMockLineAtRef = useRef(0);
  const MOCK_MIN_MS_BETWEEN_LINES = 3500;

  const demoClaimIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (demoMode) return;

    setTranscript([]);
    setClaims((prev) => prev.filter((c) => !demoClaimIdsRef.current.has(c.id)));

    seenClaimsRef.current = new Set();
    seenClaimTextsRef.current = [];
    familyClaimIdMapRef.current = new Map();

    setLastClaimAt(0);
    lastMockLineAtRef.current = 0;

    demoClaimIdsRef.current = new Set();
  }, [demoMode]);

  const pushTranscriptLine = useCallback(
    (text: string) => {
      const line = String(text || "").trim();
      if (!line) return;

      const ts = Date.now();

      setTranscript((prev) => [line, ...prev].slice(0, 10));

      const newClaims = extractClaimsFromLine(line, ts);
      if (!newClaims.length) return;

      setClaims((prev) => {
        const next = [...prev];
        let addedAny = false;

        for (const c of newClaims) {
          const fp = claimFingerprint(c.text);
          const dna = getClaimDna(c.text);

          const exactSeen = seenClaimsRef.current.has(fp);
          const familySeen = seenClaimTextsRef.current.some((seenText) =>
            areClaimsInSameFamily(seenText, c.text)
          );

          if (exactSeen || familySeen) continue;

          seenClaimsRef.current.add(fp);
          seenClaimTextsRef.current.push(c.text);

          if (demoMode) demoClaimIdsRef.current.add(c.id);

          const parentClaimId = familyClaimIdMapRef.current.get(dna.familyId) || null;
          familyClaimIdMapRef.current.set(dna.familyId, c.id);

          const seededClaim: EngineClaim = {
  ...c,
  createdAt: ts,
  status: "queued",
  fingerprint: dna.fingerprint,
  claimDna: dna,
  familyId: dna.familyId,
  derivedFromClaimId: parentClaimId,
  evidence: [],
  events: [],
  timeline: {
    queuedAt: ts,
  },
};

          seededClaim.events = appendClaimEvent(
            seededClaim,
            "claim_detected",
            ts,
            "Claim detected from transcript.",
            { text: c.text, familyId: dna.familyId }
          );

          seededClaim.events = appendClaimEvent(
            seededClaim,
            "claim_queued",
            ts,
            "Claim added to verification queue.",
            { text: c.text, familyId: dna.familyId }
          );

          next.unshift(seededClaim);
          addedAny = true;
        }

        if (addedAny) setLastClaimAt(Date.now());
        return next.slice(0, 20);
      });
    },
    [demoMode]
  );

  useEffect(() => {
    if (!demoMode) return;

    const stop = startMockTranscriptStream((tick) => {
      const now = Date.now();
      if (now - lastMockLineAtRef.current < MOCK_MIN_MS_BETWEEN_LINES) return;
      lastMockLineAtRef.current = now;

      pushTranscriptLine(tick.text);
    });

    return stop;
  }, [demoMode, pushTranscriptLine]);

  useEffect(() => {
    if (verifyingRef.current) return;

    const nextQueued = claims.find((c) => c.status === "queued");
    if (!nextQueued) return;

    const claimId = nextQueued.id;
    const claimText = nextQueued.text;
    const startedAt = Date.now();

    verifyingRef.current = true;

    setClaims((prev) =>
      prev.map((c) =>
        c.id === claimId
          ? withTimeline(c, {
              status: "checking",
              checkingAt: startedAt,
              events: appendClaimEvent(
                c,
                "claim_check_started",
                startedAt,
                "Verification started.",
                { claimId: c.id, familyId: c.familyId }
              ),
            })
          : c
      )
    );

    (async () => {
      try {
        const override = findKnownFactOverride(claimText);

        if (override) {
          const overrideVerification = buildOverrideVerification(override);
          const completedAt = Date.now();

          if (!mountedRef.current) return;

          setClaims((prev) =>
            prev.map((c) => {
              if (c.id !== claimId) return c;

              const stance = override.contradictsClaim ? "contradicted" : "supported";
              const evidence = buildEvidenceFromMatches(
                overrideVerification?.matches,
                overrideVerification?.mode,
                stance,
                completedAt
              );

              return withTimeline(c, {
                status: override.contradictsClaim ? "disputed" : "matched",
                verification: overrideVerification,
                evidence,
                completedAt,
                events: appendClaimEvent(
                  c,
                  "claim_override_matched",
                  completedAt,
                  override.reason,
                  {
                    familyId: c.familyId,
                    stance,
                    evidenceCount: evidence.length,
                  }
                ),
              });
            })
          );

          setLastClaimAt(Date.now());
          return;
        }

        const rawResult: any = await verifyClaimText(claimText);
        if (!mountedRef.current) return;

        const result = rawResult || {};
        const top: any = result?.top || result?.matches?.[0] || null;
        const mode = result?.mode as "fact_check" | "recent_coverage" | undefined;
        const candidateText = buildCandidateText(result, top);

        const assessment: RelevanceAssessment =
          result?.status !== "matched"
            ? { relevant: true, reason: "" }
            : assessRelevance(claimText, candidateText, mode);

        const completedAt = Date.now();

        setClaims((prev) =>
          prev.map((c) => {
            if (c.id !== claimId) return c;

            if (result?.status === "matched" && !assessment.relevant) {
              const verification: VerificationResult = {
                ...result,
                stance: "unclear",
                relevance: assessment,
                message: mergeVerificationMessage(
                  result,
                  `Low relevance match. ${assessment.reason}`
                ),
              };

              const evidence = buildEvidenceFromMatches(
                verification.matches,
                verification.mode,
                "unclear",
                completedAt
              );

              return withTimeline(c, {
                status: "disputed",
                verification,
                evidence,
                completedAt,
                events: appendClaimEvent(
                  c,
                  "claim_match_found",
                  completedAt,
                  "Source found but relevance was too weak.",
                  {
                    familyId: c.familyId,
                    relevance: assessment,
                    evidenceCount: evidence.length,
                  }
                ),
              });
            }

            if (result?.status === "matched" && assessment.relevant) {
              const stance = classifyClaimStance(claimText, candidateText, result);

              if (stance === "contradicted") {
                const verification: VerificationResult = {
                  ...result,
                  stance,
                  relevance: assessment,
                  message: mergeVerificationMessage(
                    result,
                    mode === "fact_check"
                      ? "Relevant source found, and it appears to contradict the claim."
                      : "Relevant coverage found, but it appears to contradict the claim."
                  ),
                };

                const evidence = buildEvidenceFromMatches(
                  verification.matches,
                  verification.mode,
                  stance,
                  completedAt
                );

                return withTimeline(c, {
                  status: "disputed",
                  verification,
                  evidence,
                  completedAt,
                  events: appendClaimEvent(
                    c,
                    "claim_contradicted",
                    completedAt,
                    verification.message,
                    {
                      familyId: c.familyId,
                      relevance: assessment,
                      evidenceCount: evidence.length,
                    }
                  ),
                });
              }

              if (stance === "supported") {
                const verification: VerificationResult = {
                  ...result,
                  stance,
                  relevance: assessment,
                  message: mergeVerificationMessage(
                    result,
                    mode === "fact_check"
                      ? "Relevant source found, and it appears to support the claim."
                      : "Relevant current coverage found for this claim."
                  ),
                };

                const evidence = buildEvidenceFromMatches(
                  verification.matches,
                  verification.mode,
                  stance,
                  completedAt
                );

                return withTimeline(c, {
                  status: "matched",
                  verification,
                  evidence,
                  completedAt,
                  events: appendClaimEvent(
                    c,
                    "claim_supported",
                    completedAt,
                    verification.message,
                    {
                      familyId: c.familyId,
                      relevance: assessment,
                      evidenceCount: evidence.length,
                    }
                  ),
                });
              }

              const verification: VerificationResult = {
                ...result,
                stance,
                relevance: assessment,
                message: mergeVerificationMessage(
                  result,
                  mode === "fact_check"
                    ? "Relevant source found, but support versus contradiction is still unclear."
                    : "Relevant current coverage found, but the final stance is still unclear."
                ),
              };

              const evidence = buildEvidenceFromMatches(
                verification.matches,
                verification.mode,
                stance,
                completedAt
              );

              return withTimeline(c, {
                status: "matched",
                verification,
                evidence,
                completedAt,
                events: appendClaimEvent(
                  c,
                  "claim_unclear",
                  completedAt,
                  verification.message,
                  {
                    familyId: c.familyId,
                    relevance: assessment,
                    evidenceCount: evidence.length,
                  }
                ),
              });
            }

            if (result?.status === "no_match") {
              const verification: VerificationResult = {
                ...result,
                stance: "unclear",
                relevance: {
                  relevant: false,
                  reason: "No direct matching source was returned.",
                },
                message:
                  safeString(result?.message) ||
                  "No relevant fact check or recent coverage found.",
              };

              return withTimeline(c, {
                status: "no_match",
                verification,
                evidence: [],
                completedAt,
                events: appendClaimEvent(
                  c,
                  "claim_no_match",
                  completedAt,
                  verification.message,
                  { familyId: c.familyId }
                ),
              });
            }

            const verification: VerificationResult = {
              ...result,
              status: "error",
              stance: "unclear",
              relevance: {
                relevant: false,
                reason: "Verification provider failed before a usable result was returned.",
              },
              message: safeString(result?.message) || "Verification provider failed.",
            };

            return withTimeline(c, {
              status: "error",
              verification,
              evidence: [],
              completedAt,
              events: appendClaimEvent(
                c,
                "claim_error",
                completedAt,
                verification.message,
                { familyId: c.familyId }
              ),
            });
          })
        );

        setLastClaimAt(Date.now());
      } catch (e: any) {
        if (!mountedRef.current) return;

        const completedAt = Date.now();

        setClaims((prev) =>
          prev.map((c) =>
            c.id === claimId
              ? withTimeline(c, {
                  status: "error",
                  verification: {
                    status: "error",
                    matches: [],
                    stance: "unclear",
                    relevance: {
                      relevant: false,
                      reason: "Verification request threw an exception.",
                    },
                    message: e?.message || String(e) || "Unknown verification error.",
                  },
                  evidence: [],
                  completedAt,
                  events: appendClaimEvent(
                    c,
                    "claim_error",
                    completedAt,
                    e?.message || String(e) || "Unknown verification error.",
                    { familyId: c.familyId }
                  ),
                })
              : c
          )
        );

        setLastClaimAt(Date.now());
      } finally {
        verifyingRef.current = false;
      }
    })();
  }, [claims]);

  const activeClaimsCount = useMemo(() => {
    return claims.filter((c) => c.status === "queued" || c.status === "checking").length;
  }, [claims]);

  const secondsSinceLastClaim = lastClaimAt ? (Date.now() - lastClaimAt) / 1000 : 9999;

  const bubbleIsChecking =
    secondsSinceLastClaim <= 6 || claims.some((c) => c.status === "checking");

  return {
    transcript,
    claims,
    activeClaimsCount,
    bubbleIsChecking,
    pushTranscriptLine,
  };
}