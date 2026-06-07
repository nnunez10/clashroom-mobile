import { type SavedClaimCard } from "@/lib/claim/savedCard";
import {
  buildClaimFamilyViews,
  getFamilyStatusLabel,
  getFamilySummaryLine,
  getLatestFamilyEvent,
  type ClaimFamilyStatus,
} from "@/lib/claim/claimFamily";
import {
  type ConfidenceTier,
  type EvidenceRecord,
  type ReasonCode,
  type Stance,
} from "@/lib/claim/types";
import { enterPiP } from "@/lib/clashbot/pip";
import {
  applyLoss,
  applyRecovery,
  shouldIncrementStreak,
  shouldApplyRecovery,
} from "@/lib/clashbot/behaviorEngine";
import {
  getVerdictHit,
  getReactionLine,
  getVerdictLabel,
} from "@/lib/clashbot/verdictEngine";
import { LinearGradient } from "expo-linear-gradient";
import ClashVerdictOverlay, { type VerdictWord } from "./ClashVerdictOverlay";
import { clusterEvidence } from "@/lib/clashbot/evidenceClustering";
import { suggestTypoCorrection } from "@/lib/clashbot/normalizeInput";
import { getResultExplanation } from "@/lib/clashbot/resultExplanation";
import {
  getReasonCodeHelperText,
  getStatusPresentation,
  type StatusStyleKey,
} from "@/lib/clashbot/statusPresentation";
import {
  formatEvidenceDate,
  formatVerificationAge,
} from "@/lib/clashbot/verificationService";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type FactCheckMatch = {
  provider?: string;
  claim?: string;
  claimDate?: string;
  url?: string;
  publisher?: string;
  title?: string;
  claimReviewed?: string;
  text?: string;
  rating?: {
    text?: string;
    raw?: string;
  };
  snippet?: string;
};

type VerificationResult = {
  status?: "matched" | "no_match" | "error";
  mode?: "fact_check" | "recent_coverage";
  matches?: FactCheckMatch[];
  top?: FactCheckMatch;
  message?: string;
  stance?: Stance;
  reasonCode?: ReasonCode;
  confidenceScore?: number;
  confidenceTier?: ConfidenceTier;
  relevance?: {
    relevant: boolean;
    reason: string;
  };
  resultType?: "breaking_coverage" | "fact_check" | "mixed";
  confidenceLabel?: string;
  shortWhyItWon?: string;
  displayVerdict?: {
    label: string;
    sublabel: string;
    tone: string;
    clashMechanic: string;
  };
  verdictTrace?: any;
};

type ClaimTimeline = {
  queuedAt?: number;
  checkingAt?: number;
  completedAt?: number;
};

type ClaimEvent = {
  id?: string;
  type?: string;
  at?: number;
  message?: string;
  meta?: Record<string, any>;
};

type ClaimItem = {
  id: string;
  text: string;
  status?:
    | "queued"
    | "checking"
    | "matched"
    | "no_match"
    | "error"
    | "disputed";
  verification?: VerificationResult | any;
  checkingAt?: number;
  completedAt?: number;
  timeline?: ClaimTimeline;
  familyId?: string;
  derivedFromClaimId?: string | null;
  evidence?: EvidenceRecord[];
  events?: ClaimEvent[];
  suggestedText?: string;
  isClash?: boolean;
  clashPartnerId?: string | null;
  isSubjective?: boolean;
  pendingResponse?: boolean;
  responseDeadline?: number;
  challengeMode?: "live" | "async";
  authorId?: string;
  authorName?: string;
  challengedBy?: {
    userId: string;
    userName: string;
    at: number;
    message?: string;
  } | null;
  claimDna?: {
    normalized?: string;
    fingerprint?: string;
    familyFingerprint?: string;
    familyId?: string;
    nodeId?: string;
    meaningfulTokens?: string[];
  };
};

type ClashBotSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  transcript: string[];
  claims: ClaimItem[];
  onSubmitClaim: (text: string) => void;
  onDashboardSubmit?: (text: string) => void;
  mode?: "dashboard" | "quick_verify" | "saved";
  initialDraft?: string;
  quickVerifyTarget?: string;
  pendingResponse?: boolean;
  onPendingResolved?: () => void;
  onStartPending?: () => void;
  onDefendClaim?: (text: string) => void;
  onDefendSubmit?: (challengedClaimId: string, text: string) => void;
  onChallengeClaim?: (claimId: string) => void;
  savedClaimIds?: Set<string>;
  onToggleSavedClaim?: (claimId: string) => void;
  savedCards?: SavedClaimCard[];
  onOpenSavedCards?: () => void;
};

function getStatusBadge(
  status?: ClaimItem["status"],
  stance?: Stance,
  reasonCode?: ReasonCode
) {
  const {
    label,
    styleKey,
    reasonCode: code,
  } = getStatusPresentation(status, stance, reasonCode);

  const styleMap: Record<StatusStyleKey, object> = {
    statusMatched: styles.statusMatched,
    statusDisputed: styles.statusDisputed,
    statusUnconfirmed: styles.statusUnconfirmed,
    statusChecking: styles.statusChecking,
    statusNoMatch: styles.statusNoMatch,
    statusError: styles.statusError,
    statusQueued: styles.statusQueued,
  };

  return { label, style: styleMap[styleKey], reasonCode: code };
}

function getSourceTypeLabel(verification?: VerificationResult | any) {
  const provider =
    verification?.top?.provider || verification?.matches?.[0]?.provider;
  const mode = verification?.mode;

  if (provider === "known_fact_override") return "Known Fact";
  if (mode === "fact_check" || provider === "google_factcheck") {
    return "Fact Check";
  }
  if (
    mode === "recent_coverage" ||
    provider === "bing_news" ||
    provider === "newsapi"
  ) {
    return "Recent Coverage";
  }

  return "Source";
}


function getResultTypeLabel(
  verification?: VerificationResult | any
): string | null {
  if (!verification?.resultType) return null;
  if (verification.resultType === "fact_check") return "Verified";
  if (verification.resultType === "breaking_coverage") return "Breaking";
  if (verification.resultType === "mixed") return "Developing";
  return null;
}

function getVerdictHitTone(hit: string) {
  if (hit === "RIGHT") return styles.verdictHitPositive;
  if (hit === "WRONG") return styles.verdictHitNegative;
  if (hit === "TOO EARLY") return styles.verdictHitWarning;
  if (hit === "UNCLEAR") return styles.verdictHitUnclear;
  return styles.verdictHitNeutral;
}

function getVerdictBackground(hit: string) {
  if (hit === "RIGHT") return { backgroundColor: "#166534" };
  if (hit === "WRONG") return { backgroundColor: "#7f1d1d" };
  if (hit === "TOO EARLY") return { backgroundColor: "#92400e" };
  if (hit === "UNCLEAR") return { backgroundColor: "#4c1d95" };
  return { backgroundColor: "#0f172a" };
}

function getVerdictBackgroundByTone(tone: string): { backgroundColor: string } {
  switch (tone) {
    case "contradicted": return { backgroundColor: "#7f1d1d" };
    case "supported":    return { backgroundColor: "#166534" };
    case "contested":    return { backgroundColor: "#92400e" };
    case "subjective":   return { backgroundColor: "#1e3a5f" };
    case "stale":        return { backgroundColor: "#1a2744" };
    default:             return { backgroundColor: "#0f172a" };
  }
}

function getVerdictWordByTone(tone: string, isOpinion: boolean): string {
  if (isOpinion) return "TAKE";
  switch (tone) {
    case "contradicted": return "DISPUTED";
    case "supported":    return "CONFIRMED";
    case "contested":    return "CONTESTED";
    case "stale":        return "UNVERIFIED";
    case "unverifiable": return "NO MATCH";
    default:             return "UNCLEAR";
  }
}

function getVerdictTextStyleByTone(tone: string, isOpinion: boolean) {
  if (isOpinion) return styles.verdictHitNeutral;
  switch (tone) {
    case "contradicted": return styles.verdictHitNegative;
    case "supported":    return styles.verdictHitPositive;
    case "contested":    return styles.verdictHitWarning;
    case "unverifiable": return styles.verdictHitUnclear;
    default:             return styles.verdictHitNeutral;
  }
}

function getEvidenceSummary(verification?: VerificationResult | any) {
  if (!verification) return null;

  const totalMatches = Array.isArray(verification?.matches)
    ? verification.matches.length
    : 0;

  const provider =
    verification?.top?.provider ||
    verification?.matches?.[0]?.provider ||
    verification?.mode;

  const providerLabel =
    provider === "google_factcheck"
      ? "Google Fact Check"
      : provider === "known_fact_override"
        ? "Known Fact Override"
        : provider === "bing_news"
          ? "Bing News"
          : provider === "newsapi"
            ? "NewsAPI"
            : verification?.mode === "recent_coverage"
              ? "Recent Coverage"
              : verification?.mode === "fact_check"
                ? "Fact Check"
                : "Source Scan";

  if (totalMatches > 1) {
    return `${providerLabel} found ${totalMatches} sources — showing top independent matches.`;
  }

  if (totalMatches === 1) {
    const weakRelevance = verification?.relevance?.relevant === false;
    return weakRelevance
      ? `${providerLabel} found 1 source — low relevance.`
      : `${providerLabel} found 1 source.`;
  }

  if (verification?.status === "no_match") {
    return "No matching source found.";
  }

  if (verification?.status === "error") {
    return "Verification failed — no sources loaded.";
  }

  return null;
}

function getEvidenceRepresentatives(
  verification: VerificationResult | any,
  max: number = 3
): FactCheckMatch[] {
  const { clusters } = clusterEvidence(verification?.matches);
  return clusters.slice(0, max).map((c) => c.representative);
}

function getEvidenceProviderLabel(provider?: string): string {
  if (provider === "google_factcheck") return "Fact Check";
  if (provider === "known_fact_override") return "Known Fact";
  if (provider === "bing_news" || provider === "newsapi") return "Coverage";
  return "Source";
}

function getVerdictTone(claim: ClaimItem) {
  const verdict = getVerdictLabel(claim);

  switch (verdict) {
    case "True":
    case "Mostly True":
    case "Supported":
      return styles.verdictPositive;
    case "False":
    case "Mostly False":
    case "Misleading":
    case "Contradicted":
      return styles.verdictNegative;
    default:
      return styles.verdictNeutral;
  }
}

function getVerdictTextTone(claim: ClaimItem) {
  const verdict = getVerdictLabel(claim);

  switch (verdict) {
    case "True":
    case "Mostly True":
    case "Supported":
      return styles.verdictBadgeTextPositive;
    case "False":
    case "Mostly False":
    case "Misleading":
    case "Contradicted":
      return styles.verdictBadgeTextNegative;
    default:
      return styles.verdictBadgeTextNeutral;
  }
}

function effectiveDisplayStatus(claim: ClaimItem): ClaimItem["status"] {
  const stance = claim.verification?.stance;
  if (stance === "contradicted") return "disputed";

  if (claim.status === "matched") {
    const ratingText = String(
      claim.verification?.top?.rating?.text ||
        claim.verification?.top?.rating?.raw ||
        claim.verification?.matches?.[0]?.rating?.text ||
        claim.verification?.matches?.[0]?.rating?.raw ||
        ""
    ).toLowerCase();

    if (
      ratingText.includes("false") ||
      ratingText.includes("misleading") ||
      ratingText.includes("incorrect") ||
      ratingText.includes("debunked")
    ) {
      return "disputed";
    }
  }

  return claim.status;
}

function getTimelineStepState(claim: ClaimItem) {
  const status = effectiveDisplayStatus(claim);

  return {
    queued:
      status === "queued" ||
      status === "checking" ||
      status === "matched" ||
      status === "disputed" ||
      status === "no_match" ||
      status === "error",
    checking:
      status === "checking" ||
      status === "matched" ||
      status === "disputed" ||
      status === "no_match" ||
      status === "error",
    result:
      status === "matched" ||
      status === "disputed" ||
      status === "no_match" ||
      status === "error",
  };
}

function getTimelineResultLabel(claim: ClaimItem) {
  switch (effectiveDisplayStatus(claim)) {
    case "matched":
      return "Verified";
    case "disputed":
      return "Disputed";
    case "no_match":
      return "No Match";
    case "error":
      return "Error";
    default:
      return "Result";
  }
}

function getTimelineResultTone(claim: ClaimItem) {
  switch (effectiveDisplayStatus(claim)) {
    case "matched":
      return styles.timelineStepDone;
    case "disputed":
    case "error":
      return styles.timelineStepNegative;
    case "no_match":
      return styles.timelineStepNeutral;
    default:
      return styles.timelineStepIdle;
  }
}

function formatRelativeMs(ms?: number) {
  if (!ms || Number.isNaN(ms)) return null;

  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 1) return "just now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;

  return `${Math.floor(seconds / 3600)}h`;
}

function formatChallengeTimeLeft(
  ms: number,
  mode: ClaimItem["challengeMode"] = "live"
) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));

  if (mode !== "async" || seconds < 60) return `${seconds}s`;

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

function getClaimMetaLine(claim: ClaimItem) {
  const queuedAt = claim.timeline?.queuedAt;
  const checkingAt = claim.timeline?.checkingAt ?? claim.checkingAt;
  const completedAt = claim.timeline?.completedAt ?? claim.completedAt;

  if (claim.status === "queued" && queuedAt) {
    return `Queued ${formatRelativeMs(Date.now() - queuedAt)} ago`;
  }

  if (claim.status === "checking" && checkingAt) {
    return `Checking for ${formatRelativeMs(Date.now() - checkingAt)}`;
  }

  if (
    (claim.status === "matched" ||
      claim.status === "disputed" ||
      claim.status === "no_match" ||
      claim.status === "error") &&
    completedAt
  ) {
    return formatVerificationAge(completedAt);
  }

  return null;
}

function getShortId(value?: string | null, keep = 10) {
  if (!value) return "—";
  if (value.length <= keep) return value;
  return value.slice(0, keep);
}

function getFamilyStatusStyle(status: ClaimFamilyStatus) {
  switch (status) {
    case "matched":
      return styles.statusMatched;
    case "disputed":
    case "mixed":
      return styles.statusDisputed;
    case "checking":
      return styles.statusChecking;
    case "no_match":
      return styles.statusNoMatch;
    case "error":
      return styles.statusError;
    case "queued":
    default:
      return styles.statusQueued;
  }
}

function formatEventType(type?: string) {
  if (!type) return "Unknown event";
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

async function openLink(url?: string) {
  if (!url) return;

  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  } catch (err) {
    console.warn("Failed to open URL:", err);
  }
}

function VerificationTracePanel({ claim }: { claim: ClaimItem }) {
  const [open, setOpen] = useState(false);
  const v = claim.verification;
  const topMatch = v?.top || v?.matches?.[0];
  const provider = topMatch?.provider || "—";
  const evidenceAge = formatEvidenceDate(topMatch?.claimDate, v?.mode) ?? "—";

  return (
    <View style={styles.debugCard}>
      <Pressable
        style={styles.debugHeaderRow}
        onPress={() => setOpen((o) => !o)}
      >
        <Text style={styles.debugTitle}>Verification Trace</Text>
        <View style={styles.debugPill}>
          <Text style={styles.debugPillText}>{open ? "Hide" : "Show"}</Text>
        </View>
      </Pressable>

      {open && (
        <>
          <Text style={styles.debugLine} numberOfLines={3}>
            <Text style={styles.debugLineLabel}>Claim: </Text>
            {claim.text}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Provider: </Text>
            {provider}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Stance: </Text>
            {v?.stance ?? "—"}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Reason: </Text>
            {v?.reasonCode ?? "—"}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Confidence: </Text>
            {v?.confidenceTier ?? "—"}
            {v?.confidenceScore != null ? ` (${v.confidenceScore})` : ""}
          </Text>
          {(() => {
            const { representativeCount, totalMatches, duplicateCount } =
              clusterEvidence(v?.matches);
            return (
              <Text style={styles.debugLine}>
                <Text style={styles.debugLineLabel}>Clusters: </Text>
                {representativeCount} unique / {totalMatches} raw
                {duplicateCount > 0 ? ` (${duplicateCount} merged)` : ""}
              </Text>
            );
          })()}
          <Text style={styles.debugLine} numberOfLines={2}>
            <Text style={styles.debugLineLabel}>Evidence: </Text>
            {topMatch?.title ?? "—"}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Source: </Text>
            {topMatch?.publisher ?? "—"}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Age: </Text>
            {evidenceAge}
          </Text>
          {!!v?.message && (
            <Text style={styles.debugLine} numberOfLines={3}>
              <Text style={styles.debugLineLabel}>Message: </Text>
              {v.message}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const CHECKING_PHRASES = [
  "Searching sources…",
  "Comparing evidence…",
  "Checking facts…",
  "Analyzing match…",
];

function QuickVerifyStatus({
  claims,
  compact,
  quickVerifyTarget,
  savedClaimIds,
  onToggleSavedClaim,
}: {
  claims: ClaimItem[];
  compact?: boolean;
  quickVerifyTarget?: string;
  savedClaimIds?: Set<string>;
  onToggleSavedClaim?: (claimId: string) => void;
}) {
  const [phraseIdx, setPhraseIdx] = useState(0);

  const latest = useMemo(() => {
    if (quickVerifyTarget) {
      const t = quickVerifyTarget.trim().toLowerCase();
      return (
        claims.find(
          (c) =>
            (c.status === "checking" || c.status === "queued") &&
            c.text?.trim().toLowerCase() === t
        ) ??
        claims.find((c) => c.text?.trim().toLowerCase() === t) ??
        null
      );
    }

    return (
      claims.find((c) => c.status === "checking" || c.status === "queued") ??
      claims[0] ??
      null
    );
  }, [claims, quickVerifyTarget]);

  const isChecking = latest?.status === "checking";

  useEffect(() => {
    if (!isChecking) return;
    const interval = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % CHECKING_PHRASES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [isChecking]);

  if (!latest) {
    return (
      <View style={styles.quickStatusCard}>
        <Text style={styles.quickStatusText}>Queued for verification…</Text>
      </View>
    );
  }

  const verification = latest.verification;
  const topMatch: FactCheckMatch | undefined =
    verification?.top || verification?.matches?.[0];

  const statusBadge = getStatusBadge(
    effectiveDisplayStatus(latest),
    latest.verification?.stance,
    latest.verification?.reasonCode
  );

  const { representativeCount: qvRepCount } = clusterEvidence(
    latest.verification?.matches
  );

  const helperText =
    latest.verification?.shortWhyItWon ??
    getResultExplanation({
      status: latest.status,
      stance: latest.verification?.stance,
      reasonCode: statusBadge.reasonCode,
      confidenceTier: latest.verification?.confidenceTier,
      representativeCount: qvRepCount,
    }) ??
    getReasonCodeHelperText(statusBadge.reasonCode);

  const sourceType = getSourceTypeLabel(verification);
  const evidenceSummary = getEvidenceSummary(verification);
  const evidenceDate = formatEvidenceDate(
    topMatch?.claimDate,
    verification?.mode
  );
  const evidenceReps = getEvidenceRepresentatives(verification);
  const isActive = latest.status === "checking" || latest.status === "queued";

  const verdictHit = getVerdictHit(latest);
  const reactionLine = getReactionLine(latest);
  const resultTypeLabel = getResultTypeLabel(verification);

  const isOpinionLatest = (latest as any).isSubjective === true;
  const qvDisplayVerdict = verification?.displayVerdict;
  const qvTone = qvDisplayVerdict?.tone;
  const displayVerdictHit = qvTone
    ? getVerdictWordByTone(qvTone, isOpinionLatest)
    : (isOpinionLatest ? "Hot Take" : verdictHit);
  const displayReaction = qvDisplayVerdict?.label
    ?? (isOpinionLatest ? "This is a clash of takes, not a verified fact." : reactionLine);
  const displaySublabel = qvDisplayVerdict?.sublabel ?? null;
  const qvVerdictBg = qvTone
    ? getVerdictBackgroundByTone(qvTone)
    : (isOpinionLatest ? { backgroundColor: "#1e3a5f" } : getVerdictBackground(verdictHit));
  const qvHeroTextStyle = qvTone
    ? getVerdictTextStyleByTone(qvTone, isOpinionLatest)
    : undefined;
  const qvStatusLabel = latest.pendingResponse
    ? "Under Challenge"
    : isOpinionLatest
      ? "Opinion"
      : statusBadge.label;
  const isSaved = savedClaimIds?.has(latest.id) ?? false;

  return (
    <View style={styles.quickStatusCard}>
      {!compact && (
        <View style={styles.quickClaimCardHeader}>
          <View style={styles.quickClaimCardTitleWrap}>
            <Text style={styles.quickClaimCardEyebrow}>
              Generated ClaimCard
            </Text>
            <Text style={styles.quickClaimCardSub}>
              Claim + receipts from ClashRoom
            </Text>
          </View>

          <Text style={styles.quickClaimCardStatus}>
            {qvStatusLabel}
          </Text>
        </View>
      )}

      <View style={[styles.verdictHero, qvVerdictBg]}>
        <LinearGradient
          colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.00)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        <Text style={[styles.verdictHeroText, qvHeroTextStyle]}>{displayVerdictHit}</Text>
        <Text style={styles.reactionHeroText}>{displayReaction}</Text>
        {!!displaySublabel && (
          <Text style={styles.heroSublabelText}>{displaySublabel}</Text>
        )}
        <Text style={styles.claimHeroText}>{latest.text}</Text>

        <View style={styles.metaRowNew}>
          {!!verification?.confidenceLabel && (
            <View style={styles.metaPill}>
              <Text style={styles.metaPillText}>
                {verification.confidenceLabel}
              </Text>
            </View>
          )}

          {!!resultTypeLabel && (
            <View style={styles.metaPill}>
              <Text style={styles.metaPillText}>{resultTypeLabel}</Text>
            </View>
          )}
        </View>
      </View>

      {!compact && (
        <View style={styles.quickClaimCardActionRow}>
          <Pressable
            onPress={() => onToggleSavedClaim?.(latest.id)}
            style={[
              styles.quickClaimCardAction,
              isSaved && styles.quickClaimCardActionSaved,
            ]}
          >
            <Text
              style={[
                styles.quickClaimCardActionText,
                isSaved && styles.quickClaimCardActionTextSaved,
              ]}
            >
              {isSaved ? "Saved" : "Save card"}
            </Text>
          </Pressable>
          <View style={styles.quickClaimCardAction}>
            <Text style={styles.quickClaimCardActionText}>Share soon</Text>
          </View>
          <View style={styles.quickClaimCardAction}>
            <Text style={styles.quickClaimCardActionText}>
              Challenge soon
            </Text>
          </View>
        </View>
      )}

      {isActive && (
        <Text style={styles.quickStatusHint}>
          {isChecking ? CHECKING_PHRASES[phraseIdx] : "Queued for verification…"}
        </Text>
      )}

      {!!verification && (
        <View style={styles.quickEvidenceWrap}>
          {!compact && (
            <View style={styles.quickEvidenceHeader}>
              <Text style={styles.quickEvidenceLabel}>Evidence receipts</Text>
              <Text style={styles.quickEvidenceType}>{sourceType}</Text>
            </View>
          )}

          {(!!topMatch?.publisher || !!evidenceDate) && (
            <Text style={styles.publisherText} numberOfLines={1}>
              {[topMatch?.publisher, evidenceDate].filter(Boolean).join(" · ")}
            </Text>
          )}

          {!compact && !!evidenceSummary && (
            <Text style={styles.evidenceSummaryText}>{evidenceSummary}</Text>
          )}

          {!compact && evidenceReps.length > 0 && (
            <View style={styles.evidencePreview}>
              {evidenceReps.map((rep, idx) => {
                const repDate =
                  formatEvidenceDate(rep.claimDate, verification?.mode) ??
                  undefined;
                const repMeta = [rep.publisher, repDate]
                  .filter(Boolean)
                  .join(" · ");
                const repRating = rep.rating?.text ?? rep.rating?.raw ?? null;

                return (
                  <Pressable
                    key={`${latest.id}-qv-rep-${idx}`}
                    onPress={rep.url ? () => openLink(rep.url) : undefined}
                    style={styles.sourceItem}
                  >
                    <View style={styles.sourceItemTopRow}>
                      <Text style={styles.sourceItemTitle} numberOfLines={2}>
                        {rep.title || rep.claimReviewed || "Source"}
                      </Text>

                      {!!rep.provider && (
                        <View style={styles.miniSourceBadge}>
                          <Text style={styles.miniSourceBadgeText}>
                            {getEvidenceProviderLabel(rep.provider)}
                          </Text>
                        </View>
                      )}
                    </View>

                    {!!repMeta && (
                      <Text style={styles.sourceItemPublisher} numberOfLines={1}>
                        {repMeta}
                      </Text>
                    )}

                    {!!repRating && (
                      <Text style={styles.sourceItemRating} numberOfLines={1}>
                        {repRating}
                      </Text>
                    )}

                    {!!rep.url && (
                      <Text style={styles.sourceItemTap}>
                        {rep.publisher ? `Open ${rep.publisher} →` : "Open source →"}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function getArgumentSnippet(claimText: string, seed: number): string {
  const lower = claimText.toLowerCase();

  if (lower.includes("iphone") || lower.includes("ios")) {
    const options = [
      "Android gives you way more customization",
      "Android phones are cheaper for similar performance",
      "you get more device variety with Android",
    ];
    return options[seed % options.length];
  }

  if (lower.includes("android")) {
    const options = [
      "iPhones are more optimized and smoother",
      "iOS apps are usually better designed",
      "Apple has better ecosystem integration",
    ];
    return options[seed % options.length];
  }

  if (lower.includes("cold") || lower.includes("warm")) {
    const options = [
      "warmer climates are easier to live in year-round",
      "cold weather limits outdoor lifestyle",
      "weather affects quality of life more than you think",
    ];
    return options[seed % options.length];
  }

  return "there's a stronger argument on the other side";
}

function getClashSideScore(claim: ClaimItem): number {
  const confidence =
    typeof claim.verification?.confidenceScore === "number"
      ? claim.verification.confidenceScore
      : 50;

  let score = confidence;

  if (claim.status === "matched") score += 8;
  if (claim.status === "disputed") score -= 4;
  if (claim.status === "no_match") score -= 10;
  if (claim.status === "error") score -= 15;

  return score;
}

function getClashEdgeLabel(left: ClaimItem, right: ClaimItem): string {
  const leftScore = getClashSideScore(left);
  const rightScore = getClashSideScore(right);
  const diff = leftScore - rightScore;

  if (Math.abs(diff) <= 6) return "Too Close to Call";
  if (diff > 0) return "Side A Leading";
  return "Side B Leading";
}

export default function ClashBotSheet({
  isOpen,
  onClose,
  transcript,
  claims,
  onSubmitClaim,
  onDashboardSubmit,
  mode = "dashboard",
  initialDraft = "",
  quickVerifyTarget,
  pendingResponse = false,
  onPendingResolved,
  onStartPending,
  onDefendClaim,
  onDefendSubmit,
  onChallengeClaim,
  savedClaimIds: savedClaimIdsProp,
  onToggleSavedClaim,
  savedCards,
  onOpenSavedCards,
}: ClashBotSheetProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [closeEnabled, setCloseEnabled] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>(
    {}
  );
  const [dashboardVerifyTarget, setDashboardVerifyTarget] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [escalationLevel, setEscalationLevel] = useState(0);
  const [clashCred, setClashCred] = useState(100);
  const [lastCredDelta, setLastCredDelta] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [defendingClaimId, setDefendingClaimId] = useState<string | null>(null);
  const [momentumFeedback, setMomentumFeedback] = useState("");
  const [momentumFeedbackRequest, setMomentumFeedbackRequest] = useState<{
    streakIncrements: boolean;
    recoveryApplies: boolean;
    challengeResolved?: boolean;
  } | null>(null);
  const [now, setNow] = useState(Date.now());
  const savedClaimIds = savedClaimIdsProp ?? new Set<string>();
  const inputRef = useRef<TextInput | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const momentumTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastShownRef = useRef(false);
  const streakHandledRef = useRef(false);
  const seenChallengeLossEventIdsRef = useRef<Set<string>>(new Set());

  // Verdict overlay state
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayVerdict, setOverlayVerdict] = useState<VerdictWord>("CHECK");
  const [overlayReaction, setOverlayReaction] = useState("");
  const [overlayClaimText, setOverlayClaimText] = useState("");
  const shownOverlayClaimIdRef = useRef<string | null>(null);

  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      console.log("[ClashBot] seeding draft:", initialDraft);
      setDraft(initialDraft);
      if (mode === "dashboard") {
        setDashboardVerifyTarget("");
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialDraft, mode]);

  useEffect(() => {
    if (!isOpen) {
      setCloseEnabled(false);
      return;
    }
    const t = setTimeout(() => setCloseEnabled(true), 250);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 500);

    return () => clearInterval(timer);
  }, [isOpen]);

  const sortedClaims = useMemo(() => {
    return [...claims].reverse();
  }, [claims]);

  const verifyingClaim = useMemo(
    () => claims.find((c) => c.status === "checking"),
    [claims]
  );

  const nextQueuedClaims = useMemo(
    () =>
      claims
        .filter((c) => c.status === "queued")
        .slice(0, 2),
    [claims]
  );

  const activePendingClaim = useMemo(
    () => claims.find((c) => c.pendingResponse) ?? null,
    [claims]
  );

  const activeDefendingClaim = useMemo(() => {
    if (!defendingClaimId) return null;
    return claims.find((c) => c.id === defendingClaimId) ?? null;
  }, [claims, defendingClaimId]);

  const activeClashPair = useMemo(() => {
    const clashClaims = claims.filter(
      (c) => c.isClash && c.clashPartnerId && c.status !== "error"
    );

    for (const claim of clashClaims) {
      const partner = claims.find((c) => c.id === claim.clashPartnerId);
      if (!partner) continue;
      if (!partner.isClash) continue;

      return {
        left: claim,
        right: partner,
      };
    }

    return null;
  }, [claims]);

  const clashEdgeLabel = useMemo(() => {
    if (!activeClashPair) return null;
    return getClashEdgeLabel(activeClashPair.left, activeClashPair.right);
  }, [activeClashPair]);

  const isOpinionClash = !!(
    activeClashPair?.left.isSubjective || activeClashPair?.right.isSubjective
  );

  const activeChallengeMode = activePendingClaim?.challengeMode ?? "live";
  const isAsyncChallenge = pendingResponse && activeChallengeMode === "async";
  const hasTimedDefense = !!activePendingClaim?.responseDeadline;
  const clashLost = pendingResponse && escalationLevel >= 2 && !hasTimedDefense;
  const clashActive = pendingResponse || clashLost || recoveryMode;
  const isBlockingClash = pendingResponse && !clashLost && !isAsyncChallenge;
  const isDefenseMode = !!activeDefendingClaim?.pendingResponse;
  const defenseClaim = activeDefendingClaim?.pendingResponse
    ? activeDefendingClaim
    : activePendingClaim;
  const defenseChallengerName =
    defenseClaim?.challengedBy?.userName ?? (defenseClaim ? "Alex" : null);
  const defenseTimeLeft = defenseClaim?.responseDeadline
    ? formatChallengeTimeLeft(
        defenseClaim.responseDeadline - now,
        defenseClaim.challengeMode ?? "live"
      )
    : null;

  useEffect(() => {
    if (clashLost) {
      onPendingResolved?.();

      setClashCred((prev) => {
        const next = applyLoss(prev);
        setLastCredDelta(next - prev);
        return next;
      });
      setStreak(0);
      setRecoveryMode(true);
    }
  }, [clashLost]);

  const CHALLENGER_TONES = {
    casual: [
      "Nah —",
      "I don't think so —",
      "I'd push back —",
      "Not really —",
    ],
    analytical: [
      "If you break it down —",
      "Looking at it objectively —",
      "The stronger case is —",
      "Evidence points the other way —",
    ],
    spicy: [
      "That's not even close —",
      "Come on —",
      "No way —",
      "Hard pass on that take —",
    ],
  } as const;

  const challengerMessage = useMemo(() => {
    if (!isOpinionClash || !activeClashPair) return null;
    const seed = activeClashPair.left.id.charCodeAt(
      activeClashPair.left.id.length - 1
    );
    const groups = [CHALLENGER_TONES.casual, CHALLENGER_TONES.analytical, CHALLENGER_TONES.spicy];
    const group = groups[seed % 3];
    const tone = group[Math.floor(seed / 3) % group.length];
    const snippet = getArgumentSnippet(activeClashPair.left.text, seed);
    return `${tone} ${snippet}.`;
  }, [isOpinionClash, activeClashPair]);

  const familyViews = useMemo(() => {
    return buildClaimFamilyViews(sortedClaims);
  }, [sortedClaims]);

  const draftSuggestion = useMemo(() => {
    if (mode !== "dashboard" || draft.length <= 5) return null;
    return suggestTypoCorrection(draft);
  }, [mode, draft]);

  const latestDashboardClaim = sortedClaims[0] ?? null;

  useEffect(() => {
    if (!dashboardVerifyTarget) return;

    const t = dashboardVerifyTarget.trim().toLowerCase();
    const matchingClaim = sortedClaims.find(
      (claim) => claim.text?.trim().toLowerCase() === t
    );

    if (
      matchingClaim &&
      (matchingClaim.status === "matched" ||
        matchingClaim.status === "disputed" ||
        matchingClaim.status === "no_match" ||
        matchingClaim.status === "error")
    ) {
      setDashboardVerifyTarget("");
    }
  }, [dashboardVerifyTarget, sortedClaims]);

  useEffect(() => {
    setExpandedFamilies((prev) => {
      const next = { ...prev };

      for (const family of familyViews) {
        if (family.familyStatus === "checking" || family.totalClaims === 1) {
          next[family.familyId] = true;
        } else if (next[family.familyId] === undefined) {
          next[family.familyId] = false;
        }
      }

      return next;
    });
  }, [familyViews]);

  // Show full-screen verdict overlay when Quick Verify resolves
  useEffect(() => {
    if (mode !== "quick_verify" || !isOpen) return;

    // Mirror the "latest" claim logic from QuickVerifyStatus
    let latest: ClaimItem | null = null;
    if (quickVerifyTarget) {
      const t = quickVerifyTarget.trim().toLowerCase();
      latest =
        claims.find((c) => c.text?.trim().toLowerCase() === t) ?? null;
    } else {
      latest = claims[0] ?? null;
    }

    if (!latest) return;

    const isResolved =
      latest.status === "matched" ||
      latest.status === "disputed" ||
      latest.status === "no_match" ||
      latest.status === "error";

    if (!isResolved) return;

    // 🔥 NEW: Only allow strong moments to trigger overlay
    const v = latest.verification;

    const isHighImpact =
      v?.stance === "supported" ||
      v?.stance === "contradicted" ||
      (typeof v?.confidenceScore === "number" && v.confidenceScore >= 75) ||
      v?.resultType === "breaking_coverage";

    if (!isHighImpact) return;

    // Only fire once per resolved claim
    if (shownOverlayClaimIdRef.current === latest.id) return;
    shownOverlayClaimIdRef.current = latest.id;

    setOverlayVerdict(getVerdictHit(latest) as VerdictWord);
    setOverlayReaction(getReactionLine(latest));
    setOverlayClaimText(latest.text);

    // 🔥 Delay overlay for dramatic timing
    setTimeout(() => {
      setOverlayVisible(true);
    }, 300);
  }, [claims, mode, isOpen, quickVerifyTarget]);

  // Reset shown-ref when the sheet closes so a re-open can show the overlay again
  useEffect(() => {
    if (!isOpen) {
      shownOverlayClaimIdRef.current = null;
      setOverlayVisible(false);
    }
  }, [isOpen]);

  // Reset streak guard when pendingResponse clears
  useEffect(() => {
    if (!pendingResponse) {
      streakHandledRef.current = false;
      setDefendingClaimId(null);
    }
  }, [pendingResponse]);

  useEffect(() => {
    if (!defendingClaimId) return;

    const stillPending = claims.some(
      (claim) => claim.id === defendingClaimId && claim.pendingResponse
    );

    if (!stillPending) {
      setDefendingClaimId(null);
    }
  }, [claims, defendingClaimId]);

  // Reset toast guard when pendingResponse clears; escalate to level 1 on entry
  useEffect(() => {
    if (!pendingResponse) {
      toastShownRef.current = false;
      setToastVisible(false);
      setEscalationLevel(0);
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    } else {
      setEscalationLevel((prev) => (prev === 0 ? 1 : prev));
    }
  }, [pendingResponse]);

  // Escalate opinion clashes when users try to dodge; timed factual defenses
  // stay governed by responseDeadline.
  useEffect(() => {
    if (pendingResponse && !hasTimedDefense && draft.trim().length > 0) {
      setEscalationLevel(2);
    }
  }, [draft, pendingResponse, hasTimedDefense]);

  // Clean up toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (momentumTimerRef.current) clearTimeout(momentumTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!momentumFeedbackRequest) return;

    const feedback = [
      momentumFeedbackRequest.challengeResolved
        ? "⚔️ Challenge Defended"
        : "STREAK SAVED",
    ];
    if (momentumFeedbackRequest.streakIncrements) {
      feedback.push(
        momentumFeedbackRequest.challengeResolved
          ? "🔥 Streak Protected"
          : `🔥 ${streak} Win Streak`
      );
    }
    if (momentumFeedbackRequest.recoveryApplies) {
      feedback.push("+2 ClashCred Recovery");
    }

    showMomentumFeedback(feedback.join(" · "));
    setMomentumFeedbackRequest(null);
  }, [momentumFeedbackRequest, streak]);

  useEffect(() => {
    for (const claim of claims) {
      const events = Array.isArray(claim.events) ? claim.events : [];

      for (const event of events) {
        if (event.type !== "auto_loss_no_response" || !event.id) continue;
        if (!claim.challengedBy) continue;
        if (seenChallengeLossEventIdsRef.current.has(event.id)) continue;

        seenChallengeLossEventIdsRef.current.add(event.id);
        showMomentumFeedback(`❌ Lost Challenge to @${claim.challengedBy.userName}`);
      }
    }
  }, [claims]);

  function showMomentumFeedback(message: string) {
    if (momentumTimerRef.current) clearTimeout(momentumTimerRef.current);
    setMomentumFeedback(message);
    momentumTimerRef.current = setTimeout(() => {
      setMomentumFeedback("");
      momentumTimerRef.current = null;
    }, 2500);
  }

  function showPressureToast() {
    if (toastShownRef.current) return;
    toastShownRef.current = true;
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 2500);
  }

  const titleText =
    mode === "quick_verify" ? "Quick Verify"
    : mode === "saved"      ? "Saved Cards"
    : "ClashBot Dashboard";

  function handleSubmit() {
    const text = draft.trim();
    if (!text) return;

    if (isOpinionClash) {
      onStartPending?.();
    }

    const streakIncrements = shouldIncrementStreak({
      pendingResponse,
      clashLost,
      alreadyHandled: streakHandledRef.current,
    });
    const recoveryApplies = shouldApplyRecovery({
      recoveryMode,
      pendingResponse,
      clashLost,
    });
    const normalizedDefenseText = text.toLowerCase();
    const defendedClaim = claims.find(
      (claim) =>
        claim.pendingResponse &&
        claim.text.trim().toLowerCase() === normalizedDefenseText
    );
    const challengeResolved = !!defendedClaim?.challengedBy;

    if (streakIncrements) {
      setStreak((prev) => prev + 1);
      streakHandledRef.current = true;
    }

    if (recoveryApplies) {
      setClashCred(applyRecovery);
      setRecoveryMode(false);
    }

    if (pendingResponse && !clashLost) {
      setMomentumFeedbackRequest({
        streakIncrements,
        recoveryApplies,
        challengeResolved,
      });
    }

    onPendingResolved?.();

    if (mode === "dashboard") {
      if (isDefenseMode && defendingClaimId && onDefendSubmit) {
        onDefendSubmit(defendingClaimId, text);
        setDraft("");
        setDefendingClaimId(null);
        inputRef.current?.blur();
        Keyboard.dismiss();
        return;
      }
      if (onDashboardSubmit) {
        onDashboardSubmit(text);
        setDraft("");
        setDefendingClaimId(null);
        inputRef.current?.blur();
        Keyboard.dismiss();
        return;
      }
    }

    if (mode === "dashboard") {
      setDashboardVerifyTarget(text);
    }

    onSubmitClaim(text);
    setDraft("");
    setDefendingClaimId(null);
    inputRef.current?.blur();
    Keyboard.dismiss();
  }

  function toggleFamily(familyId: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedFamilies((prev) => ({
      ...prev,
      [familyId]: !prev[familyId],
    }));
  }

  function handleDefendClaim(claim: ClaimItem) {
    const text = claim.text.trim();
    if (!text) return;

    setDefendingClaimId(claim.id);
    setDraft(text);
    setDashboardVerifyTarget("");
    onDefendClaim?.(text);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleChallengeClaim(claim: ClaimItem) {
    onChallengeClaim?.(claim.id);
  }

  function renderClaimCard(claim: ClaimItem, options?: { nested?: boolean }) {
    const verification = claim.verification;
    const topMatch: FactCheckMatch | undefined =
      verification?.top || verification?.matches?.[0];
    const sourceType = getSourceTypeLabel(verification);
    const evidenceSummary = getEvidenceSummary(verification);
    const evidenceDate = formatEvidenceDate(topMatch?.claimDate, verification?.mode);
    const timeline = getTimelineStepState(claim);
    const metaLine = getClaimMetaLine(claim);
    const evidenceCount = Array.isArray(claim.evidence) ? claim.evidence.length : 0;
    const eventCount = Array.isArray(claim.events) ? claim.events.length : 0;
    const latestEvent =
      Array.isArray(claim.events) && claim.events.length > 0
        ? claim.events[claim.events.length - 1]
        : null;
    const familyId = claim.familyId || claim.claimDna?.familyId || null;
    const nodeId = claim.claimDna?.nodeId || null;
    const familyFingerprint = claim.claimDna?.familyFingerprint || null;
    const meaningfulTokensCount = Array.isArray(claim.claimDna?.meaningfulTokens)
      ? claim.claimDna?.meaningfulTokens.length
      : 0;

    const statusBadge = getStatusBadge(
      effectiveDisplayStatus(claim),
      claim.verification?.stance,
      claim.verification?.reasonCode
    );

    const { representativeCount: cardRepCount } = clusterEvidence(
      verification?.matches
    );
    const evidenceReps = getEvidenceRepresentatives(verification);

    const helperText =
      verification?.shortWhyItWon ??
      getResultExplanation({
        status: claim.status,
        stance: claim.verification?.stance,
        reasonCode: statusBadge.reasonCode,
        confidenceTier: claim.verification?.confidenceTier,
        representativeCount: cardRepCount,
      }) ??
      getReasonCodeHelperText(statusBadge.reasonCode);

    const verdictHit = getVerdictHit(claim);
    const reactionLine = getReactionLine(claim);
    const resultTypeLabel = getResultTypeLabel(verification);

    const isOpinion = claim.isSubjective === true;
    const cardDisplayVerdict = verification?.displayVerdict;
    const cardTone = cardDisplayVerdict?.tone;
    const displayVerdictHit = cardTone
      ? getVerdictWordByTone(cardTone, isOpinion)
      : (isOpinion ? "TAKE" : verdictHit);
    const displayReaction = cardDisplayVerdict?.label
      ?? (isOpinion ? "This is a clash of takes, not a verified fact." : reactionLine);
    const displaySublabel = cardDisplayVerdict?.sublabel ?? null;
    const verdictBg = cardTone
      ? getVerdictBackgroundByTone(cardTone)
      : (isOpinion ? { backgroundColor: "#1e3a5f" } : getVerdictBackground(verdictHit));
    const heroTextStyle = cardTone
      ? getVerdictTextStyleByTone(cardTone, isOpinion)
      : (isOpinion ? styles.verdictHitNeutral : getVerdictHitTone(verdictHit));
    const displayStatusLabel = claim.pendingResponse
      ? "Under Challenge"
      : isOpinion ? "Opinion" : statusBadge.label;
    const displayHelperText = isOpinion ? null : helperText;
    const challengeMode = claim.challengeMode ?? "live";
    const remainingChallengeMs =
      claim.pendingResponse && claim.responseDeadline
        ? claim.responseDeadline - now
        : 0;
    const challengeTimeLeft = formatChallengeTimeLeft(
      remainingChallengeMs,
      challengeMode
    );
    const showResponseCountdown =
      claim.pendingResponse && !!claim.responseDeadline && claim.responseDeadline > now;
    const showChallengeButton = !claim.pendingResponse && !claim.challengedBy && !claim.isSubjective;
    const challengerName =
      claim.challengedBy?.userName ?? (claim.pendingResponse ? "Alex" : null);
    const challengerLine = challengerName
      ? `${challengerName} challenged this claim`
      : null;

    return (
      <View
        key={claim.id}
        style={[
          styles.claimCard,
          options?.nested ? styles.claimCardNested : null,
        ]}
      >
        <View style={styles.claimTopRow}>
          <View style={[styles.statusBadge, statusBadge.style]}>
            <Text style={styles.statusBadgeText}>{displayStatusLabel}</Text>
          </View>

          {topMatch?.url ? (
            <Pressable
              onPress={() => openLink(topMatch.url)}
              style={styles.receiptsButton}
            >
              <Text style={styles.receiptsButtonText}>Receipts</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.verdictHero, verdictBg]}>
          <Text style={[styles.verdictHeroText, heroTextStyle]}>
            {displayVerdictHit}
          </Text>

          <Text style={styles.reactionHeroText}>{displayReaction}</Text>

          {!!displaySublabel && (
            <Text style={styles.heroSublabelText}>{displaySublabel}</Text>
          )}

          <Text style={styles.claimHeroText}>{claim.text}</Text>
        </View>

        {!!challengerLine && (
          <Text style={styles.challengedByText}>
            {challengerLine}
          </Text>
        )}

        {showResponseCountdown && (
          <>
            <Text style={styles.responseCountdownText}>
              Defend your claim. {challengeTimeLeft} left.
            </Text>

            <Pressable
              onPress={() => handleDefendClaim(claim)}
              style={styles.defendClaimButton}
            >
              <Text style={styles.defendClaimButtonText}>Defend your claim</Text>
            </Pressable>
          </>
        )}

        {showChallengeButton && (
          <Pressable
            onPress={() => handleChallengeClaim(claim)}
            style={styles.challengeClaimButton}
          >
            <Text style={styles.challengeClaimButtonText}>CHALLENGE CLAIM</Text>
          </Pressable>
        )}

        {!isOpinion && (
          <View style={styles.metaRowNew}>
            {!!verification?.confidenceLabel && (
              <View style={styles.metaPill}>
                <Text style={styles.metaPillText}>
                  {verification.confidenceLabel}
                </Text>
              </View>
            )}

            {!!resultTypeLabel && (
              <View style={styles.metaPill}>
                <Text style={styles.metaPillText}>{resultTypeLabel}</Text>
              </View>
            )}

            {verification?.confidenceScore != null && (
              <Text style={styles.metaScore}>
                {verification.confidenceScore}/100
              </Text>
            )}
          </View>
        )}

        {!!displayHelperText && (
          <Text style={styles.whySlimText}>{displayHelperText}</Text>
        )}

        <View style={styles.timelineWrap}>
          <View style={styles.timelineRow}>
            <View
              style={[
                styles.timelineStep,
                timeline.queued ? styles.timelineStepDone : styles.timelineStepIdle,
              ]}
            >
              <Text
                style={[
                  styles.timelineStepText,
                  timeline.queued
                    ? styles.timelineStepTextDone
                    : styles.timelineStepTextIdle,
                ]}
              >
                Queued
              </Text>
            </View>

            <View
              style={[
                styles.timelineConnector,
                timeline.checking
                  ? styles.timelineConnectorActive
                  : styles.timelineConnectorIdle,
              ]}
            />

            <View
              style={[
                styles.timelineStep,
                claim.status === "checking"
                  ? styles.timelineStepActive
                  : timeline.checking
                    ? styles.timelineStepDone
                    : styles.timelineStepIdle,
              ]}
            >
              <Text
                style={[
                  styles.timelineStepText,
                  claim.status === "checking"
                    ? styles.timelineStepTextActive
                    : timeline.checking
                      ? styles.timelineStepTextDone
                      : styles.timelineStepTextIdle,
                ]}
              >
                Checking
              </Text>
            </View>

            <View
              style={[
                styles.timelineConnector,
                timeline.result
                  ? styles.timelineConnectorActive
                  : styles.timelineConnectorIdle,
              ]}
            />

            <View
              style={[
                styles.timelineStep,
                timeline.result
                  ? getTimelineResultTone(claim)
                  : styles.timelineStepIdle,
              ]}
            >
              <Text
                style={[
                  styles.timelineStepText,
                  effectiveDisplayStatus(claim) === "matched"
                    ? styles.timelineStepTextDone
                    : effectiveDisplayStatus(claim) === "disputed" ||
                        effectiveDisplayStatus(claim) === "error"
                      ? styles.timelineStepTextNegative
                      : timeline.result
                        ? styles.timelineStepTextNeutral
                        : styles.timelineStepTextIdle,
                ]}
              >
                {getTimelineResultLabel(claim)}
              </Text>
            </View>
          </View>

          {!!metaLine && <Text style={styles.timelineMetaText}>{metaLine}</Text>}
        </View>

        {claim.status === "no_match" && !!claim.suggestedText && (
          <Pressable
            onPress={() => onSubmitClaim(claim.suggestedText!)}
            style={styles.suggestionChip}
          >
            <Text style={styles.suggestionChipText}>
              Did you mean: {claim.suggestedText}?
            </Text>
          </Pressable>
        )}

        {!!verification && !isOpinion && (
          <>
            <View style={styles.metaRow}>
              <View style={styles.sourceTypeBadge}>
                <Text style={styles.sourceTypeBadgeText}>{sourceType}</Text>
              </View>

              {(!!topMatch?.publisher || !!evidenceDate) && (
                <Text style={styles.publisherText} numberOfLines={1}>
                  {[topMatch?.publisher, evidenceDate].filter(Boolean).join(" · ")}
                </Text>
              )}
            </View>

            {!!evidenceSummary && (
              <Text style={styles.evidenceSummaryText}>{evidenceSummary}</Text>
            )}

            {!!topMatch && (
              <Pressable
                onPress={topMatch.url ? () => openLink(topMatch.url) : undefined}
                style={styles.topSourceCard}
              >
                <Text style={styles.sourceItemTitle} numberOfLines={2}>
                  {topMatch.title || topMatch.claimReviewed || "Top source"}
                </Text>
                {!!topMatch.publisher && (
                  <Text style={styles.sourceItemPublisher}>
                    {topMatch.publisher}
                  </Text>
                )}
                {!!(topMatch.rating?.text || topMatch.rating?.raw) && (
                  <Text style={styles.sourceItemRating}>
                    {topMatch.rating?.text || topMatch.rating?.raw}
                  </Text>
                )}
                {!!topMatch.url && (
                  <Text style={styles.sourceItemTap}>Open source →</Text>
                )}
              </Pressable>
            )}

            {evidenceReps.length > 0 && (
              <View style={styles.evidencePreview}>
                {evidenceReps.map((rep, idx) => {
                  const repDate =
                    formatEvidenceDate(rep.claimDate, verification?.mode) ??
                    undefined;
                  const repMeta = [rep.publisher, repDate].filter(Boolean).join(" · ");
                  const repRating = rep.rating?.text ?? rep.rating?.raw ?? null;

                  return (
                    <Pressable
                      key={`${claim.id}-rep-${idx}`}
                      onPress={rep.url ? () => openLink(rep.url) : undefined}
                      style={styles.sourceItem}
                    >
                      <View style={styles.sourceItemTopRow}>
                        <Text style={styles.sourceItemTitle} numberOfLines={2}>
                          {rep.title || rep.claimReviewed || "Source"}
                        </Text>

                        {!!rep.provider && (
                          <View style={styles.miniSourceBadge}>
                            <Text style={styles.miniSourceBadgeText}>
                              {getEvidenceProviderLabel(rep.provider)}
                            </Text>
                          </View>
                        )}
                      </View>

                      {!!repMeta && (
                        <Text style={styles.sourceItemPublisher} numberOfLines={1}>
                          {repMeta}
                        </Text>
                      )}

                      {!!repRating && (
                        <Text style={styles.sourceItemRating} numberOfLines={1}>
                          {repRating}
                        </Text>
                      )}

                      {!!rep.url && (
                        <Text style={styles.sourceItemTap}>
                          {rep.publisher
                            ? `Open ${rep.publisher} →`
                            : "Open source →"}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}

        <View style={styles.debugCard}>
          <View style={styles.debugHeaderRow}>
            <Text style={styles.debugTitle}>ClaimDNA / Graph Rails</Text>
            <View style={styles.debugPill}>
              <Text style={styles.debugPillText}>Live</Text>
            </View>
          </View>

          <View style={styles.debugGrid}>
            <View style={styles.debugItem}>
              <Text style={styles.debugLabel}>Family ID</Text>
              <Text style={styles.debugValue}>{getShortId(familyId, 16)}</Text>
            </View>

            <View style={styles.debugItem}>
              <Text style={styles.debugLabel}>Evidence</Text>
              <Text style={styles.debugValue}>{evidenceCount}</Text>
            </View>

            <View style={styles.debugItem}>
              <Text style={styles.debugLabel}>Events</Text>
              <Text style={styles.debugValue}>{eventCount}</Text>
            </View>

            <View style={styles.debugItem}>
              <Text style={styles.debugLabel}>Derived From</Text>
              <Text style={styles.debugValue}>
                {claim.derivedFromClaimId
                  ? getShortId(claim.derivedFromClaimId, 16)
                  : "—"}
              </Text>
            </View>
          </View>

          {!!nodeId && (
            <Text style={styles.debugLine}>
              <Text style={styles.debugLineLabel}>Node:</Text> {nodeId}
            </Text>
          )}

          {!!familyFingerprint && (
            <Text style={styles.debugLine} numberOfLines={2}>
              <Text style={styles.debugLineLabel}>Family Fingerprint:</Text>{" "}
              {familyFingerprint}
            </Text>
          )}

          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Meaningful Tokens:</Text>{" "}
            {meaningfulTokensCount}
          </Text>

          {!!latestEvent && (
            <Text style={styles.debugLine} numberOfLines={2}>
              <Text style={styles.debugLineLabel}>Latest Event:</Text>{" "}
              {formatEventType(latestEvent.type)}
              {latestEvent.message ? ` - ${latestEvent.message}` : ""}
            </Text>
          )}
        </View>

        {__DEV__ && <VerificationTracePanel claim={claim} />}
      </View>
    );
  }

  if (!isOpen) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <ClashVerdictOverlay
        visible={overlayVisible}
        verdict={overlayVerdict}
        reactionLine={overlayReaction}
        claimText={overlayClaimText}
        onClose={() => setOverlayVisible(false)}
      />

      <View style={styles.backdropPressable} />

      <KeyboardAvoidingView
        style={styles.sheetLayer}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        pointerEvents="box-none"
      >
        <View
          pointerEvents="auto"
          style={[
            styles.sheet,
            mode === "quick_verify" || mode === "saved"
              ? styles.sheetQuickVerify
              : styles.sheetDashboard,
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>ClashBot</Text>
              <Text style={styles.subtitle}>{titleText}</Text>
              <Text style={styles.credHeader}>ClashCred: {clashCred}</Text>
              <Text style={styles.streakHeader}>🔥 Streak: {streak}</Text>
              {streak > 0 && !pendingResponse && (
                <Text style={styles.streakGain}>🔥 {streak} Win Streak</Text>
              )}
              {!!momentumFeedback && (
                <Text style={styles.momentumFeedback}>{momentumFeedback}</Text>
              )}
            </View>

            <View style={styles.headerButtons}>
              {mode === "dashboard" && !!savedCards?.length && (
                <Pressable onPress={onOpenSavedCards} style={styles.savedCardsButton}>
                  <Text style={styles.savedCardsButtonText}>
                    Saved ({savedCards.length})
                  </Text>
                </Pressable>
              )}
              {Platform.OS === "android" && (
                <Pressable onPress={enterPiP} disabled={!closeEnabled} style={styles.pipButton}>
                  <Text style={styles.pipButtonText}>⊟</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => { if (!isBlockingClash) onClose(); }}
                style={[styles.closeButton, isBlockingClash && { opacity: 0.4 }]}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </View>
          </View>

          {pendingResponse && (
            <View style={[styles.pendingResponseBadge, escalationLevel >= 2 && styles.pendingResponseBadgeEscalated]}>
              <Text style={[styles.pendingResponseBadgeText, escalationLevel >= 2 && styles.pendingResponseBadgeTextEscalated]}>
                {clashLost
                  ? "You lost this clash"
                  : activePendingClaim?.challengedBy?.userName
                    ? `${activePendingClaim.challengedBy.userName} challenged this claim`
                    : "Defend your claim"}
              </Text>
            </View>
          )}

          {!!defenseClaim && pendingResponse && mode === "dashboard" && (
            <View
              style={[
                styles.defenseFocusCard,
                isDefenseMode && styles.defenseFocusCardActive,
              ]}
            >
              <View style={styles.defenseFocusTopRow}>
                <Text style={styles.defenseFocusLabel}>
                  {isDefenseMode ? "DEFENDING CLAIM" : "UNDER CHALLENGE"}
                </Text>
                {!!defenseTimeLeft && (
                  <Text style={styles.defenseFocusCountdown}>
                    {defenseTimeLeft} left
                  </Text>
                )}
              </View>

              {!!defenseChallengerName && (
                <Text style={styles.defenseFocusLine}>
                  {defenseChallengerName} challenged this claim
                </Text>
              )}

              <Text style={styles.defenseFocusClaim} numberOfLines={3}>
                {defenseClaim.text}
              </Text>

              {!isDefenseMode && (
                <Pressable
                  onPress={() => handleDefendClaim(defenseClaim)}
                  style={styles.defenseFocusButton}
                >
                  <Text style={styles.defenseFocusButtonText}>
                    Defend your claim
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {mode === "dashboard" ? (
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                value={draft}
                onChangeText={setDraft}
                placeholder={isDefenseMode ? "Write your defense..." : "Type a claim..."}
                placeholderTextColor="rgba(15, 23, 42, 0.45)"
                editable={!clashLost}
                style={[
                  styles.input,
                  Platform.OS === "android" && { includeFontPadding: false },
                  pendingResponse && !isDefenseMode && styles.inputDimmed,
                  isDefenseMode && styles.inputDefending,
                  clashLost && styles.inputLocked,
                ]}
                onSubmitEditing={handleSubmit}
                returnKeyType="done"
                onFocus={() => console.log("[ClashBot] input focused")}
                onBlur={() => console.log("[ClashBot] input blurred")}
              />

              <Pressable
                onPress={handleSubmit}
                style={[
                  styles.verifyButton,
                  isDefenseMode && styles.verifyButtonDefending,
                ]}
              >
                <Text
                  style={[
                    styles.verifyButtonText,
                    isDefenseMode && styles.verifyButtonTextDefending,
                  ]}
                >
                  {isDefenseMode ? "Defend" : "Verify"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {pendingResponse && draft.trim().length > 0 && (
            <View style={styles.escapeWarning}>
              <Text style={styles.escapeWarningText}>
                {hasTimedDefense
                  ? "Defend your claim before the clock hits zero"
                  : "Finish your current clash first"}
              </Text>
            </View>
          )}

          {draftSuggestion ? (
            <Pressable
              onPress={() => {
                setDraft(draftSuggestion);
                inputRef.current?.focus();
              }}
              style={styles.suggestionChip}
            >
              <Text style={styles.suggestionChipText}>
                Did you mean: {draftSuggestion}?
              </Text>
            </Pressable>
          ) : null}

          {mode === "dashboard" &&
            draft.trim().length === 0 &&
            (dashboardVerifyTarget ||
              latestDashboardClaim?.status === "queued" ||
              latestDashboardClaim?.status === "checking") && (
              <QuickVerifyStatus
                claims={sortedClaims}
                compact
                quickVerifyTarget={dashboardVerifyTarget || undefined}
              />
            )}

          {mode === "saved" && (
            <ScrollView
              style={styles.quickVerifyScroll}
              contentContainerStyle={styles.quickVerifyScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {!savedCards?.length ? (
                <View style={styles.savedEmptyState}>
                  <Text style={styles.savedEmptyStateText}>
                    No saved cards yet.{"\n"}Verify a claim and tap Save card.
                  </Text>
                </View>
              ) : (
                savedCards.map((card) => (
                  <QuickVerifyStatus
                    key={card.id}
                    claims={[{
                      id: card.claimId,
                      text: card.text,
                      status: card.status,
                      isSubjective: card.isSubjective,
                      completedAt: card.completedAt,
                      verification: {
                        stance: card.stance,
                        displayVerdict: card.displayVerdict,
                        confidenceLabel: card.confidenceLabel,
                        resultType: card.resultType,
                        shortWhyItWon: card.shortWhyItWon,
                        mode: card.mode,
                        matches: card.evidenceReps ?? [],
                        top: card.evidenceReps?.[0],
                        reasonCode: card.reasonCode,
                        confidenceTier: card.confidenceTier,
                      },
                    }]}
                    savedClaimIds={savedClaimIdsProp}
                    onToggleSavedClaim={onToggleSavedClaim}
                  />
                ))
              )}
            </ScrollView>
          )}

          {mode === "quick_verify" && (
            <ScrollView
              style={styles.quickVerifyScroll}
              contentContainerStyle={styles.quickVerifyScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {!!defenseClaim && pendingResponse && (
                <View
                  style={[
                    styles.defenseFocusCard,
                    isDefenseMode && styles.defenseFocusCardActive,
                  ]}
                >
                  <View style={styles.defenseFocusTopRow}>
                    <Text style={styles.defenseFocusLabel}>
                      {isDefenseMode ? "DEFENDING CLAIM" : "UNDER CHALLENGE"}
                    </Text>
                    {!!defenseTimeLeft && (
                      <Text style={styles.defenseFocusCountdown}>
                        {defenseTimeLeft} left
                      </Text>
                    )}
                  </View>

                  {!!defenseChallengerName && (
                    <Text style={styles.defenseFocusLine}>
                      {defenseChallengerName} challenged this claim
                    </Text>
                  )}

                  <Text style={styles.defenseFocusClaim} numberOfLines={3}>
                    {defenseClaim.text}
                  </Text>

                  {!isDefenseMode && (
                    <Pressable
                      onPress={() => handleDefendClaim(defenseClaim)}
                      style={styles.defenseFocusButton}
                    >
                      <Text style={styles.defenseFocusButtonText}>
                        Defend your claim
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
              <QuickVerifyStatus
                claims={sortedClaims}
                quickVerifyTarget={quickVerifyTarget}
                savedClaimIds={savedClaimIds}
                onToggleSavedClaim={onToggleSavedClaim}
              />
            </ScrollView>
          )}

          {mode === "dashboard" ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onScroll={(e) => {
                if (pendingResponse && !hasTimedDefense && e.nativeEvent.contentOffset.y > 80) {
                  showPressureToast();
                  setEscalationLevel(2);
                }
              }}
              scrollEventThrottle={100}
            >
              <Text style={styles.sectionTitle}>Claims</Text>

              <View style={{ marginBottom: 12 }}>
                {verifyingClaim && (
                  <Text style={{ fontWeight: "800", color: "#0b1723", marginBottom: 4 }}>
                    🔴 Now Checking:
                  </Text>
                )}

                {verifyingClaim && (
                  <Text numberOfLines={2} style={{ marginBottom: 8 }}>
                    {verifyingClaim.text}
                  </Text>
                )}

                {nextQueuedClaims.length > 0 && (
                  <Text style={{ fontWeight: "800", color: "#0b1723", marginBottom: 4 }}>
                    ⏭ Next Up:
                  </Text>
                )}

                {nextQueuedClaims.map((c) => (
                  <Text key={c.id} numberOfLines={1} style={{ opacity: 0.7 }}>
                    • {c.text}
                  </Text>
                ))}
              </View>

              {activeClashPair && (
                <View style={[styles.clashCard, pendingResponse && styles.clashCardPending]}>
                  <Text style={styles.clashCardTitle}>
                    {isOpinionClash ? "Opinion Clash" : "Clash in Progress"}
                  </Text>

                  {isOpinionClash ? (
                    <Text style={styles.clashOpinionSubtext}>
                      This is a clash of takes, not a verified fact.
                    </Text>
                  ) : clashEdgeLabel ? (
                    <Text style={styles.clashEdgeText}>{clashEdgeLabel}</Text>
                  ) : null}

                  {!!challengerMessage && (
                    <Text style={styles.challengerMessage}>
                      {challengerMessage}
                    </Text>
                  )}

                  <View style={styles.clashRow}>
                    <View style={styles.clashSide}>
                      <Text style={styles.clashSideLabel}>Side A</Text>
                      <Text style={styles.clashClaimText} numberOfLines={3}>
                        {activeClashPair.left.text}
                      </Text>
                    </View>

                    <View style={styles.clashVsWrap}>
                      <Text style={styles.clashVsText}>VS</Text>
                    </View>

                    <View style={styles.clashSide}>
                      <Text style={styles.clashSideLabel}>Side B</Text>
                      <Text style={styles.clashClaimText} numberOfLines={3}>
                        {activeClashPair.right.text}
                      </Text>
                    </View>
                  </View>

                  {clashLost && (
                    <>
                      <Text style={styles.clashEscalationText}>
                        ❌ You lost this clash
                      </Text>
                      <Text style={styles.clashSideBWins}>Side B wins</Text>
                      {lastCredDelta !== null && (
                        <Text style={styles.credDelta}>
                          ClashCred: {clashCred - lastCredDelta} → {clashCred}
                        </Text>
                      )}
                      {streak === 0 && (
                        <Text style={styles.streakLoss}>💔 Streak lost</Text>
                      )}
                      {recoveryMode && (
                        <Text style={styles.recoveryText}>
                          🔥 Win it back — respond to recover points
                        </Text>
                      )}
                    </>
                  )}

                  {clashLost && (
                    <View style={styles.lossExplanation}>
                      <Text style={styles.lossExplanationReason}>
                        You didn't respond in time
                      </Text>

                      <Text style={styles.lossExplanationContext}>
                        This is an opinion clash — no single correct answer
                      </Text>

                      <Text style={styles.lossExplanationArgsLabel}>
                        Common arguments for Side B:
                      </Text>
                      <Text style={styles.lossExplanationArg}>· More customizable</Text>
                      <Text style={styles.lossExplanationArg}>· Better value for price</Text>
                      <Text style={styles.lossExplanationArg}>· More device options</Text>
                    </View>
                  )}

                  {recoveryMode ? (
                    <Pressable
                      onPress={() => inputRef.current?.focus()}
                      style={styles.respondCtaButton}
                    >
                      <Text style={styles.respondCtaText}>Defend Again</Text>
                    </Pressable>
                  ) : pendingResponse ? (
                    <Pressable
                      onPress={() => {
                        if (activePendingClaim) {
                          handleDefendClaim(activePendingClaim);
                          return;
                        }
                        inputRef.current?.focus();
                      }}
                      style={styles.respondCtaButton}
                    >
                      <Text style={styles.respondCtaText}>Defend your claim</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}

              {familyViews.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No claims yet</Text>
                  <Text style={styles.emptyText}>
                    Start talking or type a claim. ClashBot will surface them here.
                  </Text>
                </View>
              ) : (
                familyViews.map((family) => {
                  const isExpanded = !!expandedFamilies[family.familyId];
                  const latestFamilyEvent = getLatestFamilyEvent(family);

                  return (
                    <View key={family.familyId} style={styles.familyCard}>
                      <Pressable
                        onPress={() => toggleFamily(family.familyId)}
                        style={styles.familyHeader}
                      >
                        <View style={styles.familyHeaderTopRow}>
                          <View
                            style={[
                              styles.statusBadge,
                              getFamilyStatusStyle(family.familyStatus),
                            ]}
                          >
                            <Text style={styles.statusBadgeText}>
                              {getFamilyStatusLabel(family.familyStatus)}
                            </Text>
                          </View>

                          {family.totalClaims > 1 ? (
                            <View style={styles.familyToggleBadge}>
                              <Text style={styles.familyToggleBadgeText}>
                                {isExpanded ? "Hide Family" : "Show Family"}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <Text style={styles.familyTitle}>{family.canonicalText}</Text>

                        <Text style={styles.familyMetaText}>
                          {getFamilySummaryLine(family)}
                        </Text>

                        {!!latestFamilyEvent && (
                          <Text
                            style={styles.familyLatestEventText}
                            numberOfLines={2}
                          >
                            Latest Event: {formatEventType(latestFamilyEvent.type)}
                            {latestFamilyEvent.message
                              ? ` - ${latestFamilyEvent.message}`
                              : ""}
                          </Text>
                        )}

                        <View style={styles.familyDebugRow}>
                          <Text style={styles.familyDebugText}>
                            Family ID: {getShortId(family.familyId, 16)}
                          </Text>
                          <Text style={styles.familyDebugText}>
                            Lead: {getShortId(family.leadClaimId, 16)}
                          </Text>
                        </View>
                      </Pressable>

                      {isExpanded && (
                        <View style={styles.familyBody}>
                          {family.totalClaims > 1 && (
                            <View style={styles.familySection}>
                              <Text style={styles.familySectionTitle}>
                                Lead claim
                              </Text>
                              {renderClaimCard(family.leadClaim, { nested: true })}
                            </View>
                          )}

                          {family.totalClaims > 1 && (
                            <View style={styles.familySection}>
                              <Text style={styles.familySectionTitle}>
                                Related claims
                              </Text>
                              {family.claims
                                .filter((claim) => claim.id !== family.leadClaimId)
                                .map((claim) =>
                                  renderClaimCard(claim, { nested: true })
                                )}
                            </View>
                          )}

                          {family.totalClaims === 1 && (
                            <View style={styles.familySection}>
                              {renderClaimCard(family.leadClaim, { nested: true })}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })
              )}

              <Text style={styles.sectionTitle}>Transcript</Text>
              <View style={styles.transcriptCard}>
                {transcript.length === 0 ? (
                  <Text style={styles.transcriptEmpty}>No transcript yet.</Text>
                ) : (
                  transcript.map((line, idx) => (
                    <Text key={`${line}-${idx}`} style={styles.transcriptLine}>
                      • {line}
                    </Text>
                  ))
                )}
              </View>
            </ScrollView>
          ) : null}

          {toastVisible && (
            <View style={styles.pressureToast} pointerEvents="none">
              <Text style={styles.pressureToastText}>
                This challenge is still waiting on you
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2, 8, 23, 0.55)",
  },

  sheetLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },

  sheet: {
    backgroundColor: "rgba(223, 248, 248, 0.96)",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
  },

  sheetQuickVerify: {
    maxHeight: "62%",
  },

  quickVerifyScroll: {
    maxHeight: "100%",
  },

  quickVerifyScrollContent: {
    paddingBottom: 80,
  },

  quickStatusCard: {
    marginBottom: 6,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "rgba(15,23,42,0.04)",
  },

  quickStatusText: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(11, 23, 35, 0.70)",
  },

  quickClaimCardHeader: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.72)",
  },

  quickClaimCardTitleWrap: {
    flex: 1,
  },

  quickClaimCardEyebrow: {
    fontSize: 12,
    fontWeight: "900",
    color: "#0d3b4a",
    textTransform: "uppercase",
  },

  quickClaimCardSub: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.58)",
  },

  quickClaimCardStatus: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(34,211,238,0.14)",
    color: "#0d3b4a",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    overflow: "hidden",
  },

  quickStatusExplanation: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.82)",
  },

  quickStatusClaimText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0b1723",
    lineHeight: 19,
  },

  quickStatusHint: {
    fontSize: 12,
    color: "rgba(11, 23, 35, 0.55)",
  },

  quickClaimCardActionRow: {
    paddingHorizontal: 14,
    paddingTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.72)",
  },

  quickClaimCardAction: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(15, 23, 42, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
  },

  quickClaimCardActionSaved: {
    backgroundColor: "rgba(36, 230, 184, 0.16)",
    borderColor: "rgba(36, 230, 184, 0.34)",
  },

  quickClaimCardActionText: {
    fontSize: 11,
    fontWeight: "900",
    color: "rgba(15, 23, 42, 0.46)",
  },

  quickClaimCardActionTextSaved: {
    color: "#0d3b4a",
  },

  quickEvidenceWrap: {
    padding: 14,
    gap: 8,
  },

  quickEvidenceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  quickEvidenceLabel: {
    fontSize: 12,
    fontWeight: "900",
    color: "#0d3b4a",
    textTransform: "uppercase",
  },

  quickEvidenceType: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.52)",
  },

  sheetDashboard: {
    maxHeight: "86%",
  },

  handle: {
    alignSelf: "center",
    width: 92,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.18)",
    marginBottom: 18,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },

  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#0b1723",
  },

  subtitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(11, 23, 35, 0.72)",
    marginTop: 2,
  },

  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  savedCardsButton: {
    backgroundColor: "rgba(34,211,238,0.10)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 6,
  },

  savedCardsButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#22d3ee",
  },

  savedEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },

  savedEmptyStateText: {
    fontSize: 15,
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
    lineHeight: 22,
  },

  pipButton: {
    backgroundColor: "rgba(34,211,238,0.08)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },

  pipButtonText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#22d3ee",
  },

  closeButton: {
    backgroundColor: "rgba(15, 23, 42, 0.08)",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  closeButtonText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#22303c",
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 18,
  },

  input: {
    flex: 1,
    backgroundColor: "rgba(114, 226, 239, 0.16)",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    fontSize: 18,
    fontWeight: "700",
    color: "#0b1723",
  },

  inputDefending: {
    opacity: 1,
    backgroundColor: "rgba(254, 226, 226, 0.92)",
    borderWidth: 1.5,
    borderColor: "rgba(220, 38, 38, 0.54)",
    color: "#7f1d1d",
  },

  verifyButton: {
    backgroundColor: "#2fd3f5",
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  verifyButtonDefending: {
    backgroundColor: "#dc2626",
  },

  verifyButtonText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#03131d",
  },

  verifyButtonTextDefending: {
    color: "#ffffff",
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: 140,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#08131d",
    marginBottom: 12,
    marginTop: 8,
  },

  emptyCard: {
    backgroundColor: "rgba(255,255,255,0.78)",
    borderRadius: 24,
    padding: 24,
    marginBottom: 18,
  },

  emptyTitle: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },

  emptyText: {
    textAlign: "center",
    fontSize: 16,
    lineHeight: 24,
    color: "rgba(17, 24, 39, 0.68)",
    fontWeight: "700",
  },

  familyCard: {
    backgroundColor: "rgba(255,255,255,0.70)",
    borderRadius: 24,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(47, 211, 245, 0.12)",
  },

  familyHeader: {
    gap: 8,
  },

  familyHeaderTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  familyToggleBadge: {
    backgroundColor: "rgba(47, 211, 245, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  familyToggleBadgeText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#0b6b7d",
  },

  familyTitle: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "900",
    color: "#0f172a",
  },

  familyMetaText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.58)",
  },

  familyLatestEventText: {
    fontSize: 12,
    lineHeight: 19,
    fontWeight: "800",
    color: "#0b6b7d",
  },

  familyDebugRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 2,
  },

  familyDebugText: {
    fontSize: 11,
    fontWeight: "900",
    color: "rgba(15, 23, 42, 0.48)",
  },

  familyBody: {
    marginTop: 14,
    gap: 14,
  },

  familySection: {
    gap: 10,
  },

  familySectionTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0d3b4a",
  },

  claimCard: {
    backgroundColor: "rgba(255,255,255,0.84)",
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
  },

  claimCardNested: {
    marginBottom: 0,
    backgroundColor: "rgba(255,255,255,0.88)",
  },

  claimTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },

  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  statusBadgeText: {
    fontWeight: "900",
    fontSize: 14,
  },

  statusMatched: {
    backgroundColor: "rgba(58, 229, 170, 0.16)",
  },

  statusDisputed: {
    backgroundColor: "rgba(245, 169, 184, 0.34)",
  },

  statusChecking: {
    backgroundColor: "rgba(250, 204, 21, 0.24)",
  },

  statusNoMatch: {
    backgroundColor: "rgba(148, 163, 184, 0.22)",
  },

  statusUnconfirmed: {
    backgroundColor: "rgba(139, 92, 246, 0.14)",
  },

  statusError: {
    backgroundColor: "rgba(248, 113, 113, 0.18)",
  },

  statusQueued: {
    backgroundColor: "rgba(148, 163, 184, 0.18)",
  },

  badgeHelperText: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.52)",
    marginTop: 4,
    marginBottom: 2,
  },

  receiptsButton: {
    backgroundColor: "rgba(186, 234, 244, 0.86)",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },

  receiptsButtonText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#21313b",
  },

  claimText: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "900",
    color: "#0f172a",
    marginBottom: 12,
  },

  responseCountdownText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#dc2626",
    marginBottom: 8,
  },

  defendClaimButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(239, 68, 68, 0.16)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.42)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },

  defendClaimButtonText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#991b1b",
  },

  challengedByText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    color: "#991b1b",
    marginTop: 12,
    marginBottom: 6,
  },

  challengeClaimButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(245, 158, 11, 0.14)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.38)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },

  challengeClaimButtonText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#92400e",
  },

  timelineWrap: {
    backgroundColor: "rgba(47, 211, 245, 0.08)",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },

  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  timelineStep: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },

  timelineStepIdle: {
    backgroundColor: "rgba(148, 163, 184, 0.12)",
  },

  timelineStepActive: {
    backgroundColor: "rgba(250, 204, 21, 0.20)",
  },

  timelineStepDone: {
    backgroundColor: "rgba(58, 229, 170, 0.16)",
  },

  timelineStepNegative: {
    backgroundColor: "rgba(248, 113, 113, 0.16)",
  },

  timelineStepNeutral: {
    backgroundColor: "rgba(47, 211, 245, 0.12)",
  },

  timelineStepText: {
    fontSize: 11,
    fontWeight: "900",
  },

  timelineStepTextIdle: {
    color: "rgba(15, 23, 42, 0.44)",
  },

  timelineStepTextActive: {
    color: "#8a5a00",
  },

  timelineStepTextDone: {
    color: "#0d6b50",
  },

  timelineStepTextNegative: {
    color: "#a12b2b",
  },

  timelineStepTextNeutral: {
    color: "#0b6b7d",
  },

  timelineConnector: {
    flex: 1,
    height: 2,
    borderRadius: 999,
    marginHorizontal: 6,
  },

  timelineConnectorIdle: {
    backgroundColor: "rgba(148, 163, 184, 0.20)",
  },

  timelineConnectorActive: {
    backgroundColor: "rgba(47, 211, 245, 0.40)",
  },

  timelineMetaText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.52)",
  },

  verdictRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    marginTop: 4,
  },

  verdictBadge: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },

  verdictBadgeText: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  verdictPositive: {
    backgroundColor: "rgba(58, 229, 170, 0.18)",
  },

  verdictNegative: {
    backgroundColor: "rgba(248, 113, 113, 0.18)",
  },

  verdictNeutral: {
    backgroundColor: "rgba(47, 211, 245, 0.12)",
  },

  verdictBadgeTextPositive: {
    color: "#0d6b50",
  },

  verdictBadgeTextNegative: {
    color: "#a12b2b",
  },

  verdictBadgeTextNeutral: {
    color: "#0b6b7d",
  },

  verdictMetaText: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.52)",
  },

  confidenceStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },

  confidenceTierBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  confidenceTierHigh: {
    backgroundColor: "rgba(36,230,184,0.14)",
  },

  confidenceTierMedium: {
    backgroundColor: "rgba(245,166,35,0.14)",
  },

  confidenceTierLow: {
    backgroundColor: "rgba(255,77,77,0.12)",
  },

  confidenceTierNone: {
    backgroundColor: "rgba(15,23,42,0.08)",
  },

  confidenceTierText: {
    fontSize: 11,
    fontWeight: "900",
    color: "rgba(15,23,42,0.72)",
  },

  confidenceScoreText: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(15,23,42,0.45)",
  },

  verdictHitPositive: {
    color: "#16a34a",
  },

  verdictHitNegative: {
    color: "#dc2626",
  },

  verdictHitWarning: {
    color: "#f59e0b",
  },

  verdictHitUnclear: {
    color: "#7c3aed",
  },

  verdictHitNeutral: {
    color: "rgba(15, 23, 42, 0.55)",
  },

  verdictHero: {
    position: "relative",
    padding: 20,
    borderRadius: 22,
    marginBottom: 0,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

  verdictHeroText: {
    fontSize: 52,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#ffffff",
  },

  reactionHeroText: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    color: "rgba(255,255,255,0.92)",
    marginTop: 6,
  },

  heroSublabelText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "500",
    color: "rgba(255,255,255,0.62)",
    marginTop: 4,
  },

  claimHeroText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: "rgba(255,255,255,0.72)",
    marginTop: 10,
    marginBottom: 14,
  },

  metaRowNew: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 2,
  },

  metaPill: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  metaPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#ffffff",
  },

  metaScore: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(15,23,42,0.6)",
  },

  whySlimText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(15,23,42,0.5)",
    marginBottom: 12,
  },

  debugCard: {
    backgroundColor: "rgba(6, 20, 26, 0.05)",
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(47, 211, 245, 0.14)",
  },

  debugHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },

  debugTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0d3b4a",
  },

  debugPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(47, 211, 245, 0.12)",
  },

  debugPillText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#0b6b7d",
  },

  debugGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },

  debugItem: {
    minWidth: "46%",
    flexGrow: 1,
    backgroundColor: "rgba(255,255,255,0.55)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },

  debugLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: "rgba(15, 23, 42, 0.48)",
    marginBottom: 4,
  },

  debugValue: {
    fontSize: 13,
    fontWeight: "900",
    color: "#102232",
  },

  debugLine: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.68)",
    marginTop: 6,
  },

  debugLineLabel: {
    fontWeight: "900",
    color: "#102232",
  },

  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },

  sourceTypeBadge: {
    backgroundColor: "rgba(47, 211, 245, 0.14)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  sourceTypeBadgeText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#0b6b7d",
  },

  publisherText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.60)",
  },

  messageText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.78)",
    marginBottom: 10,
  },

  relevanceText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.58)",
    marginBottom: 10,
  },

  evidenceSummaryText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.46)",
    marginBottom: 10,
  },

  evidencePreview: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(15, 23, 42, 0.1)",
  },

  topSourceCard: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.22)",
  },

  sourceItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15, 23, 42, 0.06)",
  },

  sourceItemTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },

  sourceItemTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },

  miniSourceBadge: {
    backgroundColor: "rgba(47, 211, 245, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  miniSourceBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#0b6b7d",
  },

  sourceItemPublisher: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.58)",
    marginBottom: 3,
  },

  sourceItemRating: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0b6b7d",
    marginBottom: 3,
  },

  sourceItemTap: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1597b8",
  },

  transcriptCard: {
    backgroundColor: "rgba(255,255,255,0.78)",
    borderRadius: 24,
    padding: 18,
  },

  transcriptEmpty: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(17, 24, 39, 0.6)",
  },

  transcriptLine: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 8,
  },

  suggestionChip: {
    marginTop: 12,
    backgroundColor: "rgba(47, 211, 245, 0.14)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },

  suggestionChipText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0b6b7d",
  },

  clashCard: {
    backgroundColor: "rgba(255,255,255,0.82)",
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.16)",
  },

  clashCardTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#7f1d1d",
    marginBottom: 12,
  },

  clashRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },

  clashSide: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.04)",
    borderRadius: 16,
    padding: 12,
  },

  clashSideLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: "rgba(15, 23, 42, 0.48)",
    marginBottom: 6,
  },

  clashClaimText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    color: "#0f172a",
  },

  clashVsWrap: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 2,
  },

  clashVsText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#b91c1c",
  },

  clashEdgeText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#b91c1c",
    marginBottom: 10,
  },

  clashOpinionSubtext: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.55)",
    marginBottom: 6,
    fontStyle: "italic",
  },

  challengerMessage: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0b6b7d",
    marginBottom: 10,
  },

  pendingResponseBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.22)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.48)",
  },

  pendingResponseBadgeText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#78350f",
  },

  defenseFocusCard: {
    backgroundColor: "rgba(254, 242, 242, 0.96)",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(220, 38, 38, 0.42)",
    padding: 14,
    marginBottom: 14,
    gap: 8,
  },

  defenseFocusCardActive: {
    backgroundColor: "rgba(254, 226, 226, 0.98)",
    borderColor: "rgba(220, 38, 38, 0.66)",
  },

  defenseFocusTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },

  defenseFocusLabel: {
    fontSize: 13,
    fontWeight: "900",
    color: "#991b1b",
    letterSpacing: 0.4,
  },

  defenseFocusCountdown: {
    fontSize: 13,
    fontWeight: "900",
    color: "#dc2626",
  },

  defenseFocusLine: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
    color: "#7f1d1d",
  },

  defenseFocusClaim: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
    color: "#0f172a",
  },

  defenseFocusButton: {
    alignSelf: "flex-start",
    backgroundColor: "#dc2626",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 2,
  },

  defenseFocusButtonText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#ffffff",
  },

  respondCtaButton: {
    marginTop: 12,
    backgroundColor: "rgba(239, 68, 68, 0.18)",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(239, 68, 68, 0.46)",
  },

  respondCtaText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#991b1b",
    letterSpacing: 0.3,
  },

  pressureToast: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: "rgba(17, 24, 39, 0.94)",
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.40)",
  },

  pressureToastText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fbbf24",
  },

  inputDimmed: {
    opacity: 0.5,
  },

  escapeWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.14)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
  },

  escapeWarningText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#92400e",
  },

  clashCardPending: {
    borderColor: "rgba(239, 68, 68, 0.46)",
    borderWidth: 1.5,
  },

  pendingResponseBadgeEscalated: {
    backgroundColor: "rgba(239, 68, 68, 0.22)",
    borderColor: "rgba(239, 68, 68, 0.48)",
  },

  pendingResponseBadgeTextEscalated: {
    color: "#991b1b",
  },

  clashEscalationText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#dc2626",
    marginBottom: 4,
    marginTop: 4,
  },

  clashSideBWins: {
    fontSize: 12,
    fontWeight: "900",
    color: "#dc2626",
    marginBottom: 8,
    letterSpacing: 0.5,
    opacity: 0.72,
  },

  inputLocked: {
    opacity: 0.35,
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },

  credDelta: {
    fontSize: 13,
    fontWeight: "900",
    color: "#dc2626",
    marginTop: 4,
  },

  credHeader: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0f172a",
    marginBottom: 6,
  },

  streakHeader: {
    fontSize: 13,
    fontWeight: "900",
    color: "#f97316",
    marginBottom: 4,
  },

  streakGain: {
    fontSize: 13,
    fontWeight: "900",
    color: "#16a34a",
    marginTop: 4,
  },

  momentumFeedback: {
    fontSize: 12,
    fontWeight: "900",
    color: "#0b6b7d",
    marginTop: 4,
  },

  streakLoss: {
    fontSize: 12,
    fontWeight: "800",
    color: "#dc2626",
    marginTop: 2,
  },

  recoveryText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#f97316",
    marginTop: 6,
  },

  lossExplanation: {
    backgroundColor: "rgba(239, 68, 68, 0.06)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },

  lossExplanationReason: {
    fontSize: 12,
    fontWeight: "800",
    color: "#991b1b",
  },

  lossExplanationContext: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(15, 23, 42, 0.52)",
    fontStyle: "italic",
  },

  lossExplanationArgsLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: "rgba(15, 23, 42, 0.48)",
    marginTop: 4,
  },

  lossExplanationArg: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.60)",
  },
});
