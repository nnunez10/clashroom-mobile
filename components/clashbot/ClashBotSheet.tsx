import React, { useEffect, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View
} from "react-native";
import {
  buildClaimFamilyViews,
  getFamilyStatusLabel,
  getFamilySummaryLine,
  getLatestFamilyEvent,
  type ClaimFamilyStatus,
  type ClaimFamilyView,
} from "@/lib/claim/claimFamily";
import { type EvidenceRecord, type ReasonCode, type Stance } from "@/lib/claim/types";
import { formatEvidenceDate, formatVerificationAge } from "@/lib/clashbot/verificationService";
import {
  getReasonCodeHelperText,
  getStatusPresentation,
  type StatusStyleKey,
} from "@/lib/clashbot/statusPresentation";

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
  relevance?: {
    relevant: boolean;
    reason: string;
  };
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
  status?: "queued" | "checking" | "matched" | "no_match" | "error" | "disputed";
  verification?: VerificationResult | any;
  checkingAt?: number;
  completedAt?: number;
  timeline?: ClaimTimeline;
  familyId?: string;
  derivedFromClaimId?: string | null;
  evidence?: EvidenceRecord[];
  events?: ClaimEvent[];
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
  mode?: "dashboard" | "quick_verify";
  initialDraft?: string;
};

function getStatusBadge(status?: ClaimItem["status"], stance?: Stance, reasonCode?: ReasonCode) {
  const { label, styleKey, reasonCode: code } = getStatusPresentation(status, stance, reasonCode);
  const styleMap: Record<StatusStyleKey, object> = {
    statusMatched:     styles.statusMatched,
    statusDisputed:    styles.statusDisputed,
    statusUnconfirmed: styles.statusUnconfirmed,
    statusChecking:    styles.statusChecking,
    statusNoMatch:     styles.statusNoMatch,
    statusError:       styles.statusError,
    statusQueued:      styles.statusQueued,
  };
  return { label, style: styleMap[styleKey], reasonCode: code };
}

function getSourceTypeLabel(verification?: VerificationResult | any) {
  const provider = verification?.top?.provider || verification?.matches?.[0]?.provider;
  const mode = verification?.mode;

  if (provider === "known_fact_override") return "Known Fact";
  if (mode === "fact_check" || provider === "google_factcheck") return "Fact Check";
  if (mode === "recent_coverage" || provider === "bing_news" || provider === "newsapi") {
    return "Recent Coverage";
  }

  return "Source";
}

function getVerdictLabel(claim: ClaimItem) {
  const verification = claim.verification;
  const ratingText =
    verification?.top?.rating?.text ||
    verification?.top?.rating?.raw ||
    verification?.matches?.[0]?.rating?.text ||
    verification?.matches?.[0]?.rating?.raw ||
    "";

  const normalized = String(ratingText).toLowerCase();
  const stance = verification?.stance;

  if (claim.status === "checking") return "Checking";
  if (claim.status === "queued") return "Queued";
  if (claim.status === "error") return "Error";
  if (claim.status === "no_match") return "Unverified";

  if (stance === "contradicted") return "Contradicted";
  if (stance === "supported") return "Supported";

  if (claim.status === "disputed") return "Weak Match";

  if (normalized.includes("mostly false")) return "Mostly False";
  if (normalized.includes("false")) return "False";
  if (normalized.includes("misleading")) return "Misleading";
  if (normalized.includes("half true")) return "Mixed";
  if (normalized.includes("mixed")) return "Mixed";
  if (normalized.includes("mostly true")) return "Mostly True";
  if (normalized.includes("true")) return "True";
  if (normalized.includes("contradicted")) return "Contradicted";
  if (normalized.includes("supported")) return "Supported";

  if (claim.status === "matched" && stance === "unclear") return "Unconfirmed";
  if (claim.status === "matched") return "Matched";

  return "Unknown";
}

function getEvidenceSummary(verification?: VerificationResult | any) {
  if (!verification) return null;

  const totalMatches = Array.isArray(verification?.matches) ? verification.matches.length : 0;
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
    return `${providerLabel} found ${totalMatches} sources — showing top match.`;
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

function getTimelineStepState(claim: ClaimItem) {
  const status = claim.status;

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
  switch (claim.status) {
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
  switch (claim.status) {
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

function formatEventType(type?: string) {
  if (!type) return "Unknown event";
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function safeTimeFromNumber(value?: number | null) {
  if (!value || Number.isNaN(value)) return 0;
  return value;
}

function getClaimCreatedTime(claim: ClaimItem) {
  return (
    safeTimeFromNumber(claim.timeline?.queuedAt) ||
    safeTimeFromNumber(claim.checkingAt) ||
    safeTimeFromNumber(claim.completedAt) ||
    0
  );
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
      <Pressable style={styles.debugHeaderRow} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.debugTitle}>Verification Trace</Text>
        <View style={styles.debugPill}>
          <Text style={styles.debugPillText}>{open ? "Hide" : "Show"}</Text>
        </View>
      </Pressable>

      {open && (
        <>
          <Text style={styles.debugLine} numberOfLines={3}>
            <Text style={styles.debugLineLabel}>Claim: </Text>{claim.text}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Provider: </Text>{provider}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Stance: </Text>{v?.stance ?? "—"}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Reason: </Text>{v?.reasonCode ?? "—"}
          </Text>
          <Text style={styles.debugLine} numberOfLines={2}>
            <Text style={styles.debugLineLabel}>Evidence: </Text>{topMatch?.title ?? "—"}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Source: </Text>{topMatch?.publisher ?? "—"}
          </Text>
          <Text style={styles.debugLine}>
            <Text style={styles.debugLineLabel}>Age: </Text>{evidenceAge}
          </Text>
          {!!v?.message && (
            <Text style={styles.debugLine} numberOfLines={3}>
              <Text style={styles.debugLineLabel}>Message: </Text>{v.message}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

function QuickVerifyStatus({ claims }: { claims: ClaimItem[] }) {
  const latest = claims[0] ?? null;

  if (!latest) {
    return (
      <View style={styles.quickStatusCard}>
        <Text style={styles.quickStatusText}>Claim submitted — verifying…</Text>
      </View>
    );
  }

  const isActive = latest.status === "checking" || latest.status === "queued";
  const statusBadge = getStatusBadge(latest.status, latest.verification?.stance, latest.verification?.reasonCode);
  const helperText = getReasonCodeHelperText(statusBadge.reasonCode);

  return (
    <View style={styles.quickStatusCard}>
      <View style={[styles.statusBadge, statusBadge.style]}>
        <Text style={styles.statusBadgeText}>{statusBadge.label}</Text>
      </View>
      {!!helperText && <Text style={styles.badgeHelperText}>{helperText}</Text>}
      <Text style={styles.quickStatusClaimText} numberOfLines={2}>
        {latest.text}
      </Text>
      {isActive && (
        <Text style={styles.quickStatusHint}>Checking sources…</Text>
      )}
    </View>
  );
}

export default function ClashBotSheet({
  isOpen,
  onClose,
  transcript,
  claims,
  onSubmitClaim,
  mode = "dashboard",
  initialDraft = "",
}: ClashBotSheetProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDraft(initialDraft);
  }, [initialDraft, isOpen]);

  const sortedClaims = useMemo(() => {
    return [...claims].reverse();
  }, [claims]);

  const familyViews = useMemo(() => {
    return buildClaimFamilyViews(sortedClaims);
  }, [sortedClaims]);

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

  const titleText = mode === "quick_verify" ? "Quick Verify" : "ClashBot Dashboard";

  function handleSubmit() {
    const text = draft.trim();
    if (!text) return;
    onSubmitClaim(text);
    setDraft("");
  }

  function toggleFamily(familyId: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedFamilies((prev) => ({
      ...prev,
      [familyId]: !prev[familyId],
    }));
  }

  function renderClaimCard(claim: ClaimItem, options?: { nested?: boolean }) {
    const verification = claim.verification;
    const topMatch: FactCheckMatch | undefined =
      verification?.top || verification?.matches?.[0];
    const message = verification?.message;
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
    const additionalSourceCount = Array.isArray(verification?.matches)
      ? Math.min(verification.matches.length - 1, 3)
      : 0;
    const statusBadge = getStatusBadge(claim.status, claim.verification?.stance, claim.verification?.reasonCode);
    const helperText = getReasonCodeHelperText(statusBadge.reasonCode);

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
            <Text style={styles.statusBadgeText}>{statusBadge.label}</Text>
          </View>

          {topMatch?.url ? (
            <Pressable onPress={() => openLink(topMatch.url)} style={styles.receiptsButton}>
              <Text style={styles.receiptsButtonText}>Receipts</Text>
            </Pressable>
          ) : null}
        </View>

        {!!helperText && <Text style={styles.badgeHelperText}>{helperText}</Text>}

        <Text style={styles.claimText}>{claim.text}</Text>

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
                  claim.status === "matched"
                    ? styles.timelineStepTextDone
                    : claim.status === "disputed" || claim.status === "error"
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

        <View style={styles.verdictRow}>
          <View style={[styles.verdictBadge, getVerdictTone(claim)]}>
            <Text style={[styles.verdictBadgeText, getVerdictTextTone(claim)]}>
              {getVerdictLabel(claim)}
            </Text>
          </View>

          {!!verification?.mode && (
            <Text style={styles.verdictMetaText}>
              {verification.mode === "fact_check" ? "Fact Check" : "Recent Coverage"}
            </Text>
          )}
        </View>

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
                {claim.derivedFromClaimId ? getShortId(claim.derivedFromClaimId, 16) : "—"}
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

        {!!verification && (
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

            {!!message && <Text style={styles.messageText}>{message}</Text>}

            {!!verification?.relevance?.reason && (
              <Text style={styles.relevanceText}>
                Relevance: {verification.relevance.reason}
              </Text>
            )}

            {!!evidenceSummary && (
              <Text style={styles.evidenceSummaryText}>{evidenceSummary}</Text>
            )}

            {!!topMatch?.title && (
              <>
                <Text style={styles.primarySourceLabel}>Primary source</Text>
                <Text style={styles.sourceTitleText} numberOfLines={2}>
                  {topMatch.title}
                </Text>
              </>
            )}

            {!!topMatch?.rating?.text && (
              <Text style={styles.ratingText}>{topMatch.rating.text}</Text>
            )}

            {!!topMatch?.snippet && (
              <Text style={styles.snippetText} numberOfLines={4}>
                {topMatch.snippet}
              </Text>
            )}

            {!!topMatch?.url && (
              <Pressable onPress={() => openLink(topMatch.url)}>
                <Text style={styles.linkText}>
                  {topMatch.publisher
                    ? `Open ${topMatch.publisher} →`
                    : "Open source →"}
                </Text>
              </Pressable>
            )}

            {Array.isArray(verification?.matches) && verification.matches.length > 1 && (
              <View style={styles.sourcesBlock}>
                <Text style={styles.sourcesTitle}>
                  {additionalSourceCount === 1 ? "1 more source" : `${additionalSourceCount} more sources`}
                </Text>

                {verification.matches
                  .slice(1, 4)
                  .map((m: FactCheckMatch, idx: number) => (
                    <Pressable
                      key={`${claim.id}-src-${idx}`}
                      onPress={() => openLink(m.url)}
                      style={styles.sourceItem}
                    >
                      <View style={styles.sourceItemTopRow}>
                        <Text style={styles.sourceItemTitle} numberOfLines={2}>
                          {m.title || "Source"}
                        </Text>

                        {!!m.provider && (
                          <View style={styles.miniSourceBadge}>
                            <Text style={styles.miniSourceBadgeText}>
                              {m.provider === "google_factcheck"
                                ? "Fact Check"
                                : m.provider === "known_fact_override"
                                ? "Known Fact"
                                : m.provider === "bing_news" || m.provider === "newsapi"
                                ? "Coverage"
                                : "Source"}
                            </Text>
                          </View>
                        )}
                      </View>

                      {!!m.publisher && (
                        <Text style={styles.sourceItemPublisher} numberOfLines={1}>
                          {m.publisher}
                        </Text>
                      )}

                      {!!m.rating?.text && (
                        <Text style={styles.sourceItemRating} numberOfLines={1}>
                          {m.rating.text}
                        </Text>
                      )}

                      {!!m.url && (
                        <Text style={styles.sourceItemTap}>
                          {m.publisher ? `Open ${m.publisher} →` : "Open source →"}
                        </Text>
                      )}
                    </Pressable>
                  ))}
              </View>
            )}
          </>
        )}
      </View>
    );
  }

  if (!isOpen) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />

        <View
          style={[
            styles.sheet,
            mode === "quick_verify" ? styles.sheetQuickVerify : styles.sheetDashboard,
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>ClashBot</Text>
              <Text style={styles.subtitle}>{titleText}</Text>
            </View>

            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>

          {mode === "dashboard" ? (
            <View style={styles.inputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Type a claim..."
                placeholderTextColor="rgba(15, 23, 42, 0.45)"
                style={styles.input}
                onSubmitEditing={handleSubmit}
                returnKeyType="done"
              />

              <Pressable onPress={handleSubmit} style={styles.verifyButton}>
                <Text style={styles.verifyButtonText}>Verify</Text>
              </Pressable>
            </View>
          ) : (
            <QuickVerifyStatus claims={sortedClaims} />
          )}

          {mode === "dashboard" ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.sectionTitle}>Claims</Text>

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
                          <Text style={styles.familyLatestEventText} numberOfLines={2}>
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
                              <Text style={styles.familySectionTitle}>Lead claim</Text>
                              {renderClaimCard(family.leadClaim, { nested: true })}
                            </View>
                          )}

                          {family.totalClaims > 1 && (
                            <View style={styles.familySection}>
                              <Text style={styles.familySectionTitle}>Related claims</Text>
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
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2, 8, 23, 0.55)",
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
    // No TextInput in quick_verify mode — height is determined by
    // handle + header + QuickVerifyStatus card only (~190px).
    maxHeight: 210,
  },

  quickStatusCard: {
    marginBottom: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(15, 23, 42, 0.07)",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
    gap: 8,
  },
  quickStatusText: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(11, 23, 35, 0.70)",
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

  verifyButton: {
    backgroundColor: "#2fd3f5",
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  verifyButtonText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#03131d",
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
    marginBottom: 12,
  },

  verdictBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  verdictBadgeText: {
    fontSize: 12,
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
    fontSize: 12,
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.52)",
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
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.58)",
    marginBottom: 10,
  },

  primarySourceLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#22d3ee",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  sourceTitleText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800",
    color: "#102232",
    marginBottom: 8,
  },

  ratingText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
    color: "#0b6b7d",
    marginBottom: 8,
  },

  snippetText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    color: "rgba(15, 23, 42, 0.72)",
    marginBottom: 8,
  },

  linkText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800",
    color: "#0e95b8",
    marginBottom: 8,
  },

  sourcesBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(15, 23, 42, 0.08)",
  },

  sourcesTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#132230",
    marginBottom: 8,
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
});