// lib/clashbot/useMockClashBotEngine.ts

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verifyClaimText } from ".";
import { applyLoss } from "./behaviorEngine";
import {
  canChallengeClaim,
  issueChallengeOnClaim,
  resolveChallengeDefense,
} from "./challengeEngine";
import { areClaimsInSameFamily, getClaimDna } from "./claimDna";
import { Claim, claimFingerprint, extractClaimsFromLine } from "./extractClaims";
import { findKnownFactOverride } from "./knownFacts";
import { getNextPriorityClaim } from "./liveDebateQueue";
import { startMockTranscriptStream } from "./mockStream";
import { normalizeClaimInput, suggestTypoCorrection } from "./normalizeInput";
import { invertSubjectiveClaim, isSubjectiveClaim } from "./subjectiveClash";
import {
  assessRelevance,
  buildCandidateText,
  buildDisplayVerdict,
  buildEvidenceFromResult,
  buildExceptionVerification,
  buildOverrideVerification,
  buildVerificationFromResult,
  buildVerdictTrace,
  classifyClaimStance,
  makeId,
  type ClaimType,
  type DisplayVerdict,
  type EvidenceRecord,
  type RelevanceAssessment,
  type VerdictTrace,
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
  | "claim_error"
  | "auto_loss_no_response"
  | "duplicate_detected"
  | "challenge_issued"
  | "challenge_defended";

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
  reasonCode?: string;
  confidenceTier?: string;
  confidenceScore?: number;
  /** Derived by getResultMeta — what kind of result this is. */
  resultType?: "breaking_coverage" | "fact_check" | "mixed";
  /** Human-readable confidence label, e.g. "High confidence". */
  confidenceLabel?: string;
  /** One sentence explaining why this result was selected. */
  shortWhyItWon?: string;
  /** Internal reasoning and audit trail. Never rendered directly. */
  verdictTrace?: VerdictTrace;
  /** UI-safe display fields derived from verdictTrace. */
  displayVerdict?: DisplayVerdict;
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
  isClash?: boolean;
  clashPartnerId?: string | null;
  isSubjective?: boolean;
  pendingResponse?: boolean;
  responseDeadline?: number;
  authorId?: string;
  authorName?: string;
  challengedBy?: {
    userId: string;
    userName: string;
    at: number;
    message?: string;
  } | null;
};

type FamilyRegistryEntry = {
  familyId: string;
  leadClaimId: string;
  seedText: string;
};

const RESPONSE_WINDOW_MS = 15_000;

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

function getResolvedStance(status?: ClaimStatus, verification?: EngineVerificationCompat) {
  if (status !== "matched" && status !== "disputed") return null;

  const stance = verification?.stance;
  if (stance === "supported" || stance === "contradicted") return stance;

  return null;
}

function markFamilyClash(claims: EngineClaim[], familyId?: string | null): EngineClaim[] {
  if (!familyId) return claims;

  const familyClaims = claims.filter((c) => c.familyId === familyId);

  const supportedClaim =
    familyClaims.find(
      (c) => getResolvedStance(c.status, c.verification) === "supported"
    ) ?? null;

  const contradictedClaim =
    familyClaims.find(
      (c) => getResolvedStance(c.status, c.verification) === "contradicted"
    ) ?? null;

  const isClashFamily = !!supportedClaim && !!contradictedClaim;
  if (!isClashFamily) return claims;

  return claims.map((c) => {
    if (c.familyId !== familyId) return c;

    if (supportedClaim && c.id === supportedClaim.id) {
      return {
        ...c,
        isClash: true,
        clashPartnerId: contradictedClaim?.id ?? null,
      };
    }

    if (contradictedClaim && c.id === contradictedClaim.id) {
      return {
        ...c,
        isClash: true,
        clashPartnerId: supportedClaim?.id ?? null,
      };
    }

    return {
      ...c,
      isClash: true,
      clashPartnerId: c.clashPartnerId ?? null,
    };
  });
}

function clearPendingDefenseForFamily(
  claims: EngineClaim[],
  familyId?: string | null
): EngineClaim[] {
  if (!familyId) return claims;

  const defendedAt = Date.now();

  return claims.map((claim) => {
    if (claim.familyId !== familyId || !claim.pendingResponse) return claim;

    const defendedClaim = resolveChallengeDefense(claim);
    if (!claim.challengedBy) return defendedClaim;

    return {
      ...defendedClaim,
      events: appendClaimEvent(
        defendedClaim,
        "challenge_defended",
        defendedAt,
        "Challenge defended.",
        {
          familyId,
          challengedBy: claim.challengedBy,
        }
      ),
    };
  });
}

export function useMockClashBotEngine(options: EngineOptions = {}) {
  const demoMode = !!options.demoMode;

  const [transcript, setTranscript] = useState<string[]>([]);
  const [claims, setClaims] = useState<EngineClaim[]>([]);
  const [clashCred, setClashCred] = useState(100);
  // Synchronous mirror of claims state — kept fresh on every render so
  // submitDirectClaim can read current claims without capturing a stale closure.
  const claimsRef = useRef<EngineClaim[]>([]);
  claimsRef.current = claims;
  const autoLossAppliedRef = useRef<Set<string>>(new Set());

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
    autoLossAppliedRef.current = new Set();

    setLastClaimAt(0);
    setClashCred(100);
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
        let updatedClaims = [...prev];
        let addedAny = false;

        for (const c of newClaims) {
          const fp = claimFingerprint(c.text);
          const dna = getClaimDna(c.text);

          const seenAt = seenClaimsRef.current.get(fp);
          const exactSeen =
            seenAt !== undefined && ts - seenAt < SEEN_CLAIM_COOLDOWN_MS;
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

          // Repeat/family escalation: if this family already has an active claim,
          // boost the whole family's recency instead of creating another claim.
          const existingActiveClaim = updatedClaims.find(
            (existing) =>
              existing.familyId === resolvedFamilyId &&
              (existing.status === "queued" || existing.status === "checking")
          );

          if (existingActiveClaim) {
            const boostedAt = Date.now();

            updatedClaims = updatedClaims.map((claim) =>
              claim.familyId === resolvedFamilyId
                ? {
                    ...claim,
                    createdAt: boostedAt,
                    timeline: {
                      ...claim.timeline,
                      queuedAt: boostedAt,
                    },
                  }
                : claim
            );

            continue;
          }

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

          updatedClaims = clearPendingDefenseForFamily(updatedClaims, resolvedFamilyId);
          updatedClaims.unshift(seededClaim);
          addedAny = true;
        }

        if (addedAny) setLastClaimAt(Date.now());
        return updatedClaims.slice(0, 20);
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
      // family. raw is preserved for display; normalized goes to the API.
      const claimId = makeId("claim", `${normalized}_${ts}`);
      const fp = claimFingerprint(normalized);
      const dna = getClaimDna(normalized);

      // All acceptance decisions are made here, outside the updater, so the
      // updater stays pure. claimsRef.current is a synchronous snapshot of the
      // current claims state — safe to read in a single-threaded event handler.
      const seenAt = seenClaimsRef.current.get(fp);
      if (seenAt !== undefined && ts - seenAt < SEEN_CLAIM_COOLDOWN_MS) {
        console.log(`[submitDirectClaim] blocked: seenClaim cooldown (elapsed ${ts - seenAt}ms < ${SEEN_CLAIM_COOLDOWN_MS}ms) fp="${fp}"`);
        return;
      }

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
      if (familyHasActiveClaim) {
        console.log(`[submitDirectClaim] blocked: familyHasActiveClaim familyId="${resolvedFamilyId}"`);
        if (
          claimsRef.current.some(
            (existing) =>
              existing.familyId === resolvedFamilyId && existing.pendingResponse
          )
        ) {
          setClaims((prev) => clearPendingDefenseForFamily(prev, resolvedFamilyId));
        }
        return;
      }

      // Fingerprint dedup: if a completed claim with the same fingerprint already
      // exists in the list, tag it with a duplicate_detected event and bail out.
      const fingerprintDuplicate = claimsRef.current.find(
        (c) => c.claimDna?.fingerprint === fp
      );
      if (fingerprintDuplicate) {
        console.log(`[submitDirectClaim] blocked: fingerprintDuplicate id="${fingerprintDuplicate.id}" status="${fingerprintDuplicate.status}"`);
        setClaims((prev) =>
          prev.map((c) =>
            c.id === fingerprintDuplicate.id
              ? {
                  ...c,
                  events: appendClaimEvent(
                    c,
                    "duplicate_detected",
                    ts,
                    "Similar claim already exists.",
                    { fingerprint: fp }
                  ),
                }
              : c
          )
        );
        return;
      }

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

      // ---------------------------------------------------------------------------
      // Subjective claim fast-path: skip verification, inject clash pair directly.
      // ---------------------------------------------------------------------------
      if (isSubjectiveClaim(raw)) {
        console.log(`[submitDirectClaim] subjective fast-path: creating clash pair text="${raw.slice(0, 80)}"`);
        const invertedText = invertSubjectiveClaim(raw);
        const invertedId = makeId("claim", `${invertedText}_${ts}`);
        const invertedDna = getClaimDna(invertedText);

        // Register the inverted text in seenClaimsRef so it isn't re-queued
        seenClaimsRef.current.set(claimFingerprint(invertedText), ts);

        const _subjectiveResult = { matches: [] };
        const _subjectiveAssessment = { relevant: false, reason: "Subjective claim — not verifiable." };
        const _subjectiveTrace = buildVerdictTrace({
          stance: "unclear",
          status: "no_match",
          result: _subjectiveResult,
          assessment: _subjectiveAssessment,
          confidenceScore: 0,
          confidence: "none",
          reasonCode: "subjective_claim",
          claimType: "subjective" as ClaimType,
          overrideUsed: false,
        });
        const _subjectiveDisplayVerdict = buildDisplayVerdict(_subjectiveTrace);
        const subjectiveVerification: EngineVerificationCompat = {
          status: "no_match",
          matches: [],
          stance: "unclear",
          reasonCode: "subjective_claim",
          confidenceTier: "none",
          confidenceScore: 0,
          verdictTrace: _subjectiveTrace,
          displayVerdict: _subjectiveDisplayVerdict,
        };

        const claimA: EngineClaim = {
          id: claimId,
          text: raw,
          ts,
          normalizedText: normalized !== raw ? normalized : undefined,
          createdAt: ts,
          status: "no_match",
          fingerprint: dna.fingerprint,
          claimDna: { ...dna, familyId: resolvedFamilyId },
          familyId: resolvedFamilyId,
          derivedFromClaimId: null,
          evidence: [],
          events: [],
          timeline: { queuedAt: ts, completedAt: ts },
          completedAt: ts,
          isClash: true,
          clashPartnerId: invertedId,
          isSubjective: true,
          verification: subjectiveVerification,
        };

        const claimB: EngineClaim = {
          id: invertedId,
          text: invertedText,
          ts,
          createdAt: ts,
          status: "no_match",
          fingerprint: invertedDna.fingerprint,
          claimDna: { ...invertedDna, familyId: resolvedFamilyId },
          familyId: resolvedFamilyId,
          derivedFromClaimId: claimId,
          evidence: [],
          events: [],
          timeline: { queuedAt: ts, completedAt: ts },
          completedAt: ts,
          isClash: true,
          clashPartnerId: claimId,
          isSubjective: true,
          verification: subjectiveVerification,
        };

        setClaims((prev) =>
          [claimB, claimA, ...clearPendingDefenseForFamily(prev, resolvedFamilyId)].slice(
            0,
            20
          )
        );
        setLastClaimAt(ts);
        return;
      }
      // ---------------------------------------------------------------------------

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

      console.log(`[submitDirectClaim] accepted: queuing claim text="${raw}" familyId="${resolvedFamilyId}"`);

      // Pure updater: no side effects, just the array insertion.
      setClaims((prev) =>
        [seededClaim, ...clearPendingDefenseForFamily(prev, resolvedFamilyId)].slice(
          0,
          20
        )
      );

      setLastClaimAt(ts);
    },
    [demoMode]
  );

  const challengeClaim = useCallback((claimId: string) => {
    const challenger = {
      userId: "local_user",
      userName: "You",
    };
    const now = Date.now();
    const target = claimsRef.current.find((claim) => claim.id === claimId);

    if (!target) return false;
    if (target.pendingResponse || target.challengedBy) return false;
    if (!canChallengeClaim(target, challenger)) return false;

    setClaims((prev) =>
      prev.map((claim) => {
        if (claim.id !== claimId) return claim;

        const challengedClaim = issueChallengeOnClaim(
          claim,
          challenger,
          RESPONSE_WINDOW_MS,
          now
        );

        return {
          ...challengedClaim,
          events: appendClaimEvent(
            challengedClaim,
            "challenge_issued",
            now,
            "Claim challenged by @You.",
            {
              familyId: claim.familyId,
              challengedBy: challengedClaim.challengedBy,
            }
          ),
        };
      })
    );

    setLastClaimAt(now);
    return true;
  }, []);

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
    const timer = setInterval(() => {
      const now = Date.now();
      const expiredClaimIds = claimsRef.current
        .filter(
          (claim) =>
            claim.pendingResponse &&
            claim.responseDeadline &&
            now > claim.responseDeadline &&
            !autoLossAppliedRef.current.has(claim.id)
        )
        .map((claim) => claim.id);

      if (!expiredClaimIds.length) return;

      for (const claimId of expiredClaimIds) {
        autoLossAppliedRef.current.add(claimId);
      }

      setClashCred((prev) =>
        expiredClaimIds.reduce((nextCred) => applyLoss(nextCred), prev)
      );

      setClaims((prev) => {
        const expired = new Set(expiredClaimIds);

        return prev.map((claim) => {
          if (!expired.has(claim.id) || !claim.pendingResponse) return claim;

          return {
            ...claim,
            pendingResponse: false,
            responseDeadline: undefined,
            events: appendClaimEvent(
              claim,
              "auto_loss_no_response",
              now,
              "No response in time",
              { familyId: claim.familyId }
            ),
          };
        });
      });
    }, 500);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (verifyingRef.current) return;

    const nextQueued = getNextPriorityClaim(claims as any) as EngineClaim | undefined;
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
          console.log(
            `[ClashBot] knownFacts override hit: id="${override.id}"` +
            ` contradictsClaim=${override.contradictsClaim}` +
            ` text="${claimText.slice(0, 80)}"`
          );

          const overrideVerification = buildOverrideVerification(override);
          const completedAt = Date.now();

          if (!mountedRef.current) return;

          const overrideStance = override.contradictsClaim ? "contradicted" : "supported";

          setClaims((prev) =>
            markFamilyClash(
              prev.map((c) => {
                if (c.id !== claimId) return c;

                const evidence = buildEvidenceFromResult(overrideVerification, overrideStance, completedAt);
                const pendingResponse = overrideVerification?.displayVerdict?.clashMechanic === "factual_clash";

                return withTimeline(c, {
                  status: override.contradictsClaim ? "disputed" : "matched",
                  verification: overrideVerification ?? undefined,
                  evidence,
                  completedAt,
                  pendingResponse,
                  responseDeadline: pendingResponse
                    ? completedAt + RESPONSE_WINDOW_MS
                    : undefined,
                  events: appendClaimEvent(
                    c,
                    "claim_override_matched",
                    completedAt,
                    override.reason,
                    {
                      familyId: c.familyId,
                      stance: overrideStance,
                      evidenceCount: evidence.length,
                    }
                  ),
                });
              }),
              nextQueued.familyId
            )
          );

          console.log(
            `[ClashBot] override verdict committed: status="${override.contradictsClaim ? "disputed" : "matched"}"` +
            ` stance="${overrideStance}" id="${override.id}"`
          );
          setLastClaimAt(Date.now());
          return;
        }

        const rawResult: any = await verifyClaimText(claimText);
        if (!mountedRef.current) return;

        const result = rawResult || {};

        // Explicit fallback: if the API returned nothing actionable, resolve as no_match
        // so the claim always exits "checking" state.
        if (!result.status && !result.matches?.length) {
          const completedAt = Date.now();
          setClaims((prev) =>
            prev.map((c) => {
              if (c.id !== claimId) return c;
              return withTimeline(c, {
                status: "no_match",
                verification: { status: "no_match", matches: [] },
                evidence: [],
                completedAt,
                events: appendClaimEvent(
                  c,
                  "claim_no_match",
                  completedAt,
                  "No result returned by verification service.",
                  { familyId: c.familyId }
                ),
              });
            })
          );
          setLastClaimAt(Date.now());
          return;
        }

        const top: any = result?.top || result?.matches?.[0] || null;
        const mode = result?.mode as "fact_check" | "recent_coverage" | undefined;
        const candidateText = buildCandidateText(result, top);

        const assessment: RelevanceAssessment =
          result?.status !== "matched"
            ? { relevant: true, reason: "" }
            : assessRelevance(claimText, candidateText, mode);

        // Hoist stance computation so it can be logged before the setClaims updater runs.
        const stance =
          result?.status === "matched" && assessment.relevant
            ? classifyClaimStance(claimText, candidateText, result)
            : "unclear";

        console.log(
          `[ClashBot] verdict: status="${result?.status ?? "unknown"}"` +
          ` stance="${stance}" relevant=${assessment.relevant}` +
          ` mode="${mode ?? "none"}" claimId="${claimId}"`
        );

        const completedAt = Date.now();

        setClaims((prev) =>
          markFamilyClash(
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
              // stance is computed above and closed over here.

              if (stance === "contradicted") {
                const verification: EngineVerificationCompat = buildVerificationFromResult(
                  result,
                  assessment,
                  stance,
                  mode
                );

                const evidence = buildEvidenceFromResult(result, stance, completedAt, claimText);
                const pendingResponse = verification.displayVerdict?.clashMechanic === "factual_clash";

                return withTimeline(c, {
                  status: "disputed",
                  verification,
                  evidence,
                  completedAt,
                  pendingResponse,
                  responseDeadline: pendingResponse
                    ? completedAt + RESPONSE_WINDOW_MS
                    : undefined,
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

              return withTimeline(c, {
                status: "disputed",
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
          }),
          nextQueued.familyId
          )
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
    clashCred,
    activeClaimsCount,
    bubbleIsChecking,
    pushTranscriptLine,
    submitDirectClaim,
    challengeClaim,
  };
}
