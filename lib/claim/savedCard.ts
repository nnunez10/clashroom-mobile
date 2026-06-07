// lib/claim/savedCard.ts
//
// SavedClaimCard: a slim, self-contained snapshot of a Generated ClaimCard
// taken at the moment the user taps "Save card".
//
// Design constraints:
//   - Must render faithfully without access to the live claims array.
//   - Survives the 20-claim engine eviction cap.
//   - Decoupled from EngineClaim/ClaimItem type evolution.
//   - schemaVersion enables forward migration when persistence lands.

import { clusterEvidence } from "@/lib/clashbot/evidenceClustering";

// ---------------------------------------------------------------------------
// SavedClaimCard — the approved v1 schema
// ---------------------------------------------------------------------------

export type SavedClaimCardEvidenceRep = {
  provider?: string;
  title?: string;
  claimReviewed?: string;
  publisher?: string;
  claimDate?: string;
  url?: string;
  rating?: { text?: string; raw?: string };
};

export type SavedClaimCard = {
  schemaVersion: 1;
  id: string;       // stable record key (= claimId for v1)
  claimId: string;  // engine claim ID — for session unsave toggle

  text: string;
  savedAt: number;

  // Verdict signals
  status: "matched" | "no_match" | "error" | "disputed";
  stance?: "supported" | "contradicted" | "unclear";
  isSubjective?: boolean;

  // Pre-computed display verdict — cannot be re-derived without VerdictTrace
  displayVerdict?: {
    tone: string;
    label: string;
    sublabel: string;
  };

  // Meta pills
  confidenceLabel?: string;
  resultType?: "fact_check" | "breaking_coverage" | "mixed";

  // Helper text (primary path — skips getResultExplanation if present)
  shortWhyItWon?: string;

  // Source typing (drives date formatting and source type label)
  mode?: "fact_check" | "recent_coverage";

  // Top 3 clustered evidence representatives, snapshotted at save time
  evidenceReps?: SavedClaimCardEvidenceRep[];

  // Optional metadata
  completedAt?: number;
  reasonCode?: string;
  confidenceTier?: string;
};

// ---------------------------------------------------------------------------
// SnapshotInput — duck-typed to accept both EngineClaim and ClaimItem shapes
// ---------------------------------------------------------------------------

type SnapshotInput = {
  id: string;
  text: string;
  status?: string;
  isSubjective?: boolean;
  completedAt?: number;
  verification?: {
    stance?: string;
    displayVerdict?: { tone: string; label: string; sublabel: string };
    confidenceLabel?: string;
    resultType?: string;
    shortWhyItWon?: string;
    mode?: string;
    matches?: any[];
    top?: any;
    reasonCode?: string;
    confidenceTier?: string;
  };
};

// ---------------------------------------------------------------------------
// snapshotSavedCard — pure, no side effects
// ---------------------------------------------------------------------------

export function snapshotSavedCard(claim: SnapshotInput): SavedClaimCard {
  const v = claim.verification;

  // Run clustering once at save time to get the top 3 independent reps.
  const { clusters } = clusterEvidence(v?.matches ?? []);
  const evidenceReps: SavedClaimCardEvidenceRep[] = clusters
    .slice(0, 3)
    .map((c) => {
      const rep = c.representative;
      return {
        provider: rep?.provider,
        title: rep?.title,
        claimReviewed: rep?.claimReviewed,
        publisher: rep?.publisher,
        claimDate: rep?.claimDate,
        url: rep?.url,
        rating: rep?.rating
          ? { text: rep.rating.text, raw: rep.rating.raw }
          : undefined,
      };
    });

  const rawStatus = claim.status ?? "error";
  const status: SavedClaimCard["status"] =
    rawStatus === "matched" || rawStatus === "no_match" ||
    rawStatus === "error"   || rawStatus === "disputed"
      ? rawStatus
      : "error";

  return {
    schemaVersion: 1,
    id: claim.id,
    claimId: claim.id,
    text: claim.text,
    savedAt: Date.now(),
    status,
    stance: v?.stance as SavedClaimCard["stance"],
    isSubjective: claim.isSubjective,
    displayVerdict: v?.displayVerdict
      ? { tone: v.displayVerdict.tone, label: v.displayVerdict.label, sublabel: v.displayVerdict.sublabel }
      : undefined,
    confidenceLabel: v?.confidenceLabel,
    resultType: v?.resultType as SavedClaimCard["resultType"],
    shortWhyItWon: v?.shortWhyItWon,
    mode: v?.mode as SavedClaimCard["mode"],
    evidenceReps: evidenceReps.length > 0 ? evidenceReps : undefined,
    completedAt: claim.completedAt,
    reasonCode: v?.reasonCode,
    confidenceTier: v?.confidenceTier,
  };
}
