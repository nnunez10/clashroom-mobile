// lib/clashbot/useMockClashBotEngine.ts

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verifyClaimText } from ".";
import { areClaimsInSameFamily, getClaimDna } from "./claimDna";
import { Claim, claimFingerprint, extractClaimsFromLine } from "./extractClaims";
import { findKnownFactOverride } from "./knownFacts";
import { startMockTranscriptStream } from "./mockStream";
import { normalizeClaimInput, suggestTypoCorrection } from "./normalizeInput";
import {
  assessRelevance,
  buildCandidateText,
  buildEvidenceFromResult,
  buildExceptionVerification,
  buildOverrideVerification,
  buildVerificationFromResult,
  classifyClaimStance,
  makeId,
  type EvidenceRecord,
  type RelevanceAssessment,
} from "./verificationService";

type EngineOptions = {
  demoMode?: boolean;
};

type ClaimStatus =
  | "queued"
  | "checking"
  | "matched"
  | "no_match"
  | "error"
  | "disputed";

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

// [COMPAT] Temporary type matching the engine's current runtime verification shape.
// Uses "fact_check"/"recent_coverage" mode values and loose optional fields.
// Replace with VerificationOutcome once mode values and ProviderMatch fields
// are aligned with the engine's output (Phase 4 target).
type EngineMatchCompat = {
  provider?: string;
  claim?: string;
  claimReviewed?: string;
  claimDate?: string;
  url?: string;
  publisher?: string;
  title?: string;
  text?: string;
  snippet?: string;
  rating?: { text?: string; raw?: string };
};

type EngineVerificationCompat = {
  status?: "matched" | "no_match" | "error";
  mode?: "fact_check" | "recent_coverage";
  matches?: EngineMatchCompat[];
  top?: EngineMatchCompat;
  message?: string;
  stance?: "supported" | "contradicted" | "unclear";
  relevance?: { relevant: boolean; reason: string };
};

type EngineClaim = Omit<Claim, "verification"> & {
  createdAt?: number;
  status?: ClaimStatus;
  verification?: EngineVerificationCompat;
  checkingAt?: number;
  completedAt?: number;
  timeline?: {
    queuedAt?: number;
    checkingAt?: number;
    completedAt?: number;
  };
  /** Surface-cleaned version of text used for API queries and matching. */
  normalizedText?: string;
  /** Typo-corrected suggestion, set only on no_match results. Never auto-applied. */
  suggestedText?: string;
  claimDna?: ReturnType<typeof getClaimDna>;
  fingerprint?: string;
  familyId?: string;
  derivedFromClaimId?: string | null;
  evidence?: EvidenceRecord[];
  events?: ClaimEvent[];
};

type FamilyRegistryEntry = {
  familyId: string;
  leadClaimId: string;
  seedText: string;
};

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
  // Synchronous mirror of claims state — kept fresh on every render so
  // submitDirectClaim can read current claims without capturing a stale closure.
  const claimsRef = useRef<EngineClaim[]>([]);
  claimsRef.current = claims;

  // Maps fingerprint → timestamp (ms) of first submission this session.
  // Claims whose entry is older than SEEN_CLAIM_COOLDOWN_MS are eligible for re-verification.
  const SEEN_CLAIM_COOLDOWN_MS = 5 * 60 * 1000;
  const seenClaimsRef = useRef<Map<string, number>>(new Map());
  const familyRegistryRef = useRef<FamilyRegistryEntry[]>([]);
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

    seenClaimsRef.current = new Map();
    familyRegistryRef.current = [];
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

          const seenAt = seenClaimsRef.current.get(fp);
          const exactSeen = seenAt !== undefined && ts - seenAt < SEEN_CLAIM_COOLDOWN_MS;
          if (exactSeen) continue;

          const existingFamily =
            familyRegistryRef.current.find((entry) =>
              areClaimsInSameFamily(entry.seedText, c.text)
            ) || null;

          // Record (or refresh) the submission timestamp so the cooldown window
          // starts from this attempt, whether or not the claim is ultimately queued.
          seenClaimsRef.current.set(fp, ts);

          if (demoMode) demoClaimIdsRef.current.add(c.id);

          const resolvedFamilyId = existingFamily?.familyId || dna.familyId;
          const parentClaimId =
            existingFamily?.leadClaimId ||
            familyClaimIdMapRef.current.get(resolvedFamilyId) ||
            null;

          // Suppress near-duplicate: if this family already has a claim that
          // is queued or actively checking, don't pile up another pending
          // entry for the same topic. The timestamp was already recorded in
          // seenClaimsRef above, so the exact text is blocked until cooldown expires.
          const familyHasActiveClaim = prev.some(
            (existing) =>
              existing.familyId === resolvedFamilyId &&
              (existing.status === "queued" || existing.status === "checking")
          );
          if (familyHasActiveClaim) continue;

          if (!existingFamily) {
            familyRegistryRef.current.push({
              familyId: resolvedFamilyId,
              leadClaimId: c.id,
              seedText: c.text,
            });
          }

          if (!familyClaimIdMapRef.current.has(resolvedFamilyId)) {
            familyClaimIdMapRef.current.set(resolvedFamilyId, c.id);
          }

          const seededClaim: EngineClaim = {
            ...c,
            createdAt: ts,
            status: "queued",
            fingerprint: dna.fingerprint,
            claimDna: {
              ...dna,
              familyId: resolvedFamilyId,
            },
            familyId: resolvedFamilyId,
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
            existingFamily
              ? "Related claim detected and attached to existing claim family."
              : "Claim detected from transcript.",
            {
              text: c.text,
              familyId: resolvedFamilyId,
              derivedFromClaimId: parentClaimId,
            }
          );

          seededClaim.events = appendClaimEvent(
            seededClaim,
            "claim_queued",
            ts,
            "Claim added to verification queue.",
            {
              text: c.text,
              familyId: resolvedFamilyId,
              derivedFromClaimId: parentClaimId,
            }
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

  // Direct claim submission — bypasses NLP extraction scoring so that text
  // explicitly submitted by the user is always queued for verification,
  // regardless of how "claim-like" the heuristics would score it.
  const submitDirectClaim = useCallback(
    (text: string) => {
      const { raw, normalized } = normalizeClaimInput(String(text || ""));
      if (!raw) return;

      const ts = Date.now();

      setTranscript((prev) => [raw, ...prev].slice(0, 10));

      // Use normalized text for DNA / fingerprinting so that minor typing
      // noise ("teh earth is flat" vs "the earth is flat") maps to the same
      // family.  raw is preserved for display; normalized goes to the API.
      const claimId = makeId("claim", `${normalized}_${ts}`);
      const fp = claimFingerprint(normalized);
      const dna = getClaimDna(normalized);

      // All acceptance decisions are made here, outside the updater, so the
      // updater stays pure. claimsRef.current is a synchronous snapshot of the
      // current claims state — safe to read in a single-threaded event handler.
      const seenAt = seenClaimsRef.current.get(fp);
      if (seenAt !== undefined && ts - seenAt < SEEN_CLAIM_COOLDOWN_MS) return;

      const existingFamily =
        familyRegistryRef.current.find((entry) =>
          areClaimsInSameFamily(entry.seedText, normalized)
        ) || null;

      const resolvedFamilyId = existingFamily?.familyId || dna.familyId;
      const parentClaimId =
        existingFamily?.leadClaimId ||
        familyClaimIdMapRef.current.get(resolvedFamilyId) ||
        null;

      // Acceptance gate: read current claims via ref before committing any mutations.
      const familyHasActiveClaim = claimsRef.current.some(
        (existing) =>
          existing.familyId === resolvedFamilyId &&
          (existing.status === "queued" || existing.status === "checking")
      );
      if (familyHasActiveClaim) return;

      // Accepted — commit side effects only now, after the gate has passed.
      seenClaimsRef.current.set(fp, ts);

      if (!existingFamily) {
        familyRegistryRef.current.push({
          familyId: resolvedFamilyId,
          leadClaimId: claimId,
          seedText: normalized,
        });
      }

      if (!familyClaimIdMapRef.current.has(resolvedFamilyId)) {
        familyClaimIdMapRef.current.set(resolvedFamilyId, claimId);
      }

      // raw → displayed to user; normalized → sent to API and used for matching
      const c = { id: claimId, text: raw, ts };

      const seededClaim: EngineClaim = {
        ...c,
        normalizedText: normalized !== raw ? normalized : undefined,
        createdAt: ts,
        status: "queued",
        fingerprint: dna.fingerprint,
        claimDna: {
          ...dna,
          familyId: resolvedFamilyId,
        },
        familyId: resolvedFamilyId,
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
        existingFamily
          ? "Related claim detected and attached to existing claim family."
          : "Claim submitted directly by user.",
        { text: raw, familyId: resolvedFamilyId, derivedFromClaimId: parentClaimId }
      );

      seededClaim.events = appendClaimEvent(
        seededClaim,
        "claim_queued",
        ts,
        "Claim added to verification queue.",
        { text: raw, familyId: resolvedFamilyId, derivedFromClaimId: parentClaimId }
      );

      // Pure updater: no side effects, just the array insertion.
      setClaims((prev) => [seededClaim, ...prev].slice(0, 20));

      setLastClaimAt(ts);
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
    // Use the surface-cleaned version for API queries when available;
    // fall back to raw text so the original claim is still verifiable.
    const claimText = nextQueued.normalizedText ?? nextQueued.text;
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
              const evidence = buildEvidenceFromResult(overrideVerification, stance, completedAt);

              return withTimeline(c, {
                status: override.contradictsClaim ? "disputed" : "matched",
                verification: overrideVerification ?? undefined,
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
              const verification: EngineVerificationCompat = buildVerificationFromResult(
                result,
                assessment,
                "unclear",
                mode,
                claimText
              );

              const evidence = buildEvidenceFromResult(result, "unclear", completedAt, claimText);

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
                const verification: EngineVerificationCompat = buildVerificationFromResult(
                  result,
                  assessment,
                  stance,
                  mode
                );

                const evidence = buildEvidenceFromResult(result, stance, completedAt, claimText);

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
                const verification: EngineVerificationCompat = buildVerificationFromResult(
                  result,
                  assessment,
                  stance,
                  mode
                );

                const evidence = buildEvidenceFromResult(result, stance, completedAt, claimText);

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

              const verification: EngineVerificationCompat = buildVerificationFromResult(
                result,
                assessment,
                stance,
                mode,
                claimText
              );

              const evidence = buildEvidenceFromResult(result, stance, completedAt, claimText);

              const claimStatus =
                stance === "supported"
                  ? "matched"
                  : stance === "contradicted"
                  ? "disputed"
                  : "disputed";

              return withTimeline(c, {
                status: claimStatus,
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
              const verification: EngineVerificationCompat = buildVerificationFromResult(
                result,
                assessment,
                "unclear",
                mode,
                claimText
              );
              const suggestion = suggestTypoCorrection(c.text);

              return withTimeline(c, {
                status: "no_match",
                verification,
                evidence: [],
                completedAt,
                suggestedText: suggestion ?? undefined,
                events: appendClaimEvent(
                  c,
                  "claim_no_match",
                  completedAt,
                  verification.message,
                  { familyId: c.familyId }
                ),
              });
            }

            const verification: EngineVerificationCompat = buildVerificationFromResult(
              result,
              assessment,
              "unclear",
              mode,
              claimText
            );

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

        const exceptionVerification = buildExceptionVerification(e);
        setClaims((prev) =>
          prev.map((c) =>
            c.id === claimId
              ? withTimeline(c, {
                  status: "error",
                  verification: exceptionVerification,
                  evidence: [],
                  completedAt,
                  events: appendClaimEvent(
                    c,
                    "claim_error",
                    completedAt,
                    exceptionVerification.message,
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
    submitDirectClaim,
  };
}