// lib/clashbot/useMockClashBotEngine.ts

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verifyClaimText } from ".";
import { Claim, claimFingerprint, extractClaimsFromLine } from "./extractClaims";
import { startMockTranscriptStream } from "./mockStream";

type EngineOptions = {
  demoMode?: boolean;
};

function safeString(x: any) {
  return typeof x === "string" ? x : "";
}

function tokenizeLower(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// small stopword list, tuned to avoid accidental matches
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

function meaningfulTokens(s: string) {
  return tokenizeLower(s).filter((t) => t.length >= 4 && !STOP.has(t));
}

function extractNumbers(s: string) {
  const text = String(s || "");
  // picks up: 2024, 3.5, 12%, $4.99, 1,200
  const matches = text.match(/(\$?\d[\d,]*(?:\.\d+)?%?)/g) || [];
  return matches.map((m) => m.replace(/,/g, "").toLowerCase());
}

function extractNamedEntitiesHeuristic(s: string) {
  const text = String(s || "");

  // Heuristic: sequences of Capitalized Words (e.g., "New York", "Joe Biden"),
  // plus ALLCAPS abbreviations (e.g., "FBI", "NBA").
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
  for (const t of a) if (setB.has(t)) shared++;
  return shared;
}

/**
 * Relevance gate to prevent garbage matches:
 *
 * Rule A (strong): if claim has entities or numbers, require at least ONE shared entity/number
 * Rule B (fallback): otherwise require meaningful keyword overlap (shared >= 2 OR overlap ratio)
 */
function isLikelyRelevant(claimText: string, matchText: string) {
  const claimNums = extractNumbers(claimText);
  const matchNums = extractNumbers(matchText);

  const claimEnts = extractNamedEntitiesHeuristic(claimText);
  const matchEnts = extractNamedEntitiesHeuristic(matchText);

  const hasAnchors = claimNums.length > 0 || claimEnts.length > 0;

  if (hasAnchors) {
    const sharedNums = setOverlapCount(claimNums, matchNums);
    const sharedEnts = setOverlapCount(claimEnts, matchEnts);

    if (sharedNums >= 1 || sharedEnts >= 1) return true;
    return false;
  }

  const a = meaningfulTokens(claimText);
  const b = meaningfulTokens(matchText);
  if (a.length === 0 || b.length === 0) return false;

  const shared = setOverlapCount(a, b);
  const overlap = shared / Math.max(1, Math.min(a.length, b.length));

  if (shared >= 2) return true;
  if (overlap >= 0.22) return true;
  return false;
}

export function useMockClashBotEngine(options: EngineOptions = {}) {
  const demoMode = !!options.demoMode;

  const [transcript, setTranscript] = useState<string[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const seenClaimsRef = useRef<Set<string>>(new Set());

  // bubble activity
  const [lastClaimAt, setLastClaimAt] = useState<number>(0);

  // ensures we only verify one claim at a time
  const verifyingRef = useRef(false);

  // safety: avoid setting state after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Throttle mock transcript so it doesn't fly by
  const lastMockLineAtRef = useRef(0);
  const MOCK_MIN_MS_BETWEEN_LINES = 3500;

  // Track which claims were created while in demo mode
  const demoClaimIdsRef = useRef<Set<string>>(new Set());

  // If user turns Demo Mode OFF, wipe mock noise so the next claim is the star
  useEffect(() => {
    if (demoMode) return;

    // Stop any pending "checking" carryover from demo by dropping demo-origin claims
    setTranscript([]);
    setClaims((prev) => prev.filter((c) => !demoClaimIdsRef.current.has(c.id)));

    // Reset seen claims so user's real claim isn't blocked by an earlier demo fingerprint
    seenClaimsRef.current = new Set();

    // Reset activity + mock throttle
    setLastClaimAt(0);
    lastMockLineAtRef.current = 0;

    // Clear demo marker set
    demoClaimIdsRef.current = new Set();
  }, [demoMode]);

  const pushTranscriptLine = useCallback(
    (text: string) => {
      const line = String(text || "").trim();
      if (!line) return;

      const ts = Date.now();

      // Add to transcript (most recent first)
      setTranscript((prev) => [line, ...prev].slice(0, 10));

      // Extract claims from this line
      const newClaims = extractClaimsFromLine(line, ts);
      if (!newClaims.length) return;

      setClaims((prev) => {
        const next = [...prev];
        let addedAny = false;

        for (const c of newClaims) {
          const fp = claimFingerprint(c.text);
          if (seenClaimsRef.current.has(fp)) continue;

          seenClaimsRef.current.add(fp);

          // Mark whether this claim was created during demo mode
          if (demoMode) demoClaimIdsRef.current.add(c.id);

          next.unshift({ ...c, status: "queued" });
          addedAny = true;
        }

        if (addedAny) setLastClaimAt(Date.now());
        return next.slice(0, 20);
      });
    },
    [demoMode]
  );

  // transcript stream -> claim extraction
  // IMPORTANT: only run mock stream in Demo Mode
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

  // REAL verification pipeline: queued -> checking -> matched/no_match/error
  useEffect(() => {
    if (verifyingRef.current) return;

    const nextQueued = claims.find((c) => c.status === "queued");
    if (!nextQueued) return;

    const claimId = nextQueued.id;
    const claimText = nextQueued.text;

    verifyingRef.current = true;

    // mark as checking
    setClaims((prev) =>
      prev.map((c) =>
        c.id === claimId ? { ...c, status: "checking", checkingAt: Date.now() } : c
      )
    );

    (async () => {
      try {
        const result: any = await verifyClaimText(claimText);
        if (!mountedRef.current) return;

        const top: any = result?.top || result?.matches?.[0] || result?.matches?.[0]?.top || null;

        // Build a candidate “match text” to judge relevance
        const candidateText =
          safeString(top?.claimReviewed) +
          " " +
          safeString(top?.title) +
          " " +
          safeString(top?.text) +
          " " +
          safeString(top?.publisher);

        const relevant =
          result?.status !== "matched" ? true : isLikelyRelevant(claimText, candidateText);

        setClaims((prev) =>
          prev.map((c) => {
            if (c.id !== claimId) return c;

            if (result?.status === "matched" && relevant) {
              return {
                ...c,
                status: "matched",
                verification: result,
                completedAt: Date.now(),
              };
            }

            if (result?.status === "matched" && !relevant) {
              return {
                ...c,
                status: "disputed",
                verification: {
                  ...result,
                  message:
                    "Low relevance match. Returned source does not share a key entity/number with the claim.",
                },
                completedAt: Date.now(),
              };
            }

            if (result?.status === "no_match") {
              return {
                ...c,
                status: "no_match",
                verification: result,
                completedAt: Date.now(),
              };
            }

            return {
              ...c,
              status: "error",
              verification: result,
              completedAt: Date.now(),
            };
          })
        );

        setLastClaimAt(Date.now());
      } catch (e: any) {
        if (!mountedRef.current) return;

        setClaims((prev) =>
          prev.map((c) =>
            c.id === claimId
              ? {
                  ...c,
                  status: "error",
                  verification: {
                    status: "error",
                    matches: [],
                    message: e?.message || String(e),
                  },
                  completedAt: Date.now(),
                }
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