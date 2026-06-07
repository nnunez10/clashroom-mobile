// components/clashbot/ClaimCardDetail.tsx

import React from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { type SavedClaimCard } from "@/lib/claim/savedCard";

export type ClaimCardDetailProps = {
  card: SavedClaimCard | null;
  onClose: () => void;
};

function formatSavedAgo(savedAt: number): string {
  const seconds = Math.floor((Date.now() - savedAt) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(ts?: number): string | null {
  if (!ts) return null;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function verdictToneToColor(tone?: string): string {
  if (tone === "supported")    return "#15803d";
  if (tone === "contradicted") return "#dc2626";
  if (tone === "unclear")      return "#b45309";
  if (tone === "subjective")   return "#7c3aed";
  if (tone === "no_match")     return "#0e7490";
  return "rgba(11,23,35,0.50)";
}

function verdictToneToBg(tone?: string): string {
  if (tone === "supported")    return "rgba(36,230,184,0.14)";
  if (tone === "contradicted") return "rgba(255,77,77,0.12)";
  if (tone === "unclear")      return "rgba(245,166,35,0.12)";
  if (tone === "subjective")   return "rgba(124,58,237,0.10)";
  if (tone === "no_match")     return "rgba(34,211,238,0.10)";
  return "rgba(11,23,35,0.06)";
}

function resultTypeLabel(rt?: string): string | null {
  if (rt === "fact_check") return "Fact Check";
  if (rt === "breaking_coverage") return "Breaking";
  if (rt === "mixed") return "Developing";
  return null;
}

export default function ClaimCardDetail({ card, onClose }: ClaimCardDetailProps) {
  if (!card) return null;

  const tone = card.displayVerdict?.tone;
  const accentColor = verdictToneToColor(tone);
  const accentBg = verdictToneToBg(tone);
  const verifiedDate = formatDate(card.completedAt);
  const rtLabel = resultTypeLabel(card.resultType);

  return (
    <View style={styles.overlay}>
      <View style={styles.header}>
        <Pressable onPress={onClose} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>CLAIM RECEIPT</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Claim text */}
        <View style={[styles.claimCard, { borderLeftColor: accentColor }]}>
          <Text style={styles.claimEyebrow}>CLAIM</Text>
          <Text style={styles.claimText}>"{card.text}"</Text>
        </View>

        {/* Verdict */}
        {!!card.displayVerdict?.label && (
          <View style={[styles.verdictCard, { backgroundColor: accentBg }]}>
            <View style={styles.verdictTopRow}>
              <View style={[styles.verdictBadge, { backgroundColor: accentColor }]}>
                <Text style={styles.verdictBadgeText}>
                  {card.displayVerdict.label.toUpperCase()}
                </Text>
              </View>
              {card.isSubjective && (
                <View style={styles.subjectivePill}>
                  <Text style={styles.subjectivePillText}>SUBJECTIVE</Text>
                </View>
              )}
              {!!rtLabel && (
                <View style={styles.typePill}>
                  <Text style={styles.typePillText}>{rtLabel}</Text>
                </View>
              )}
            </View>
            {!!card.displayVerdict.sublabel && (
              <Text style={styles.sublabel}>{card.displayVerdict.sublabel}</Text>
            )}
          </View>
        )}

        {/* Why this verdict won */}
        {!!card.shortWhyItWon && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>WHY THIS VERDICT WON</Text>
            <Text style={styles.whyText}>{card.shortWhyItWon}</Text>
          </View>
        )}

        {/* Meta grid */}
        <View style={styles.metaCard}>
          {!!card.confidenceLabel && (
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Confidence</Text>
              <Text style={styles.metaVal}>
                {card.confidenceLabel}
                {card.confidenceTier ? ` · ${card.confidenceTier}` : ""}
              </Text>
            </View>
          )}
          {!!card.mode && (
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Source type</Text>
              <Text style={styles.metaVal}>
                {card.mode === "fact_check" ? "Fact Check" : "Recent Coverage"}
              </Text>
            </View>
          )}
          {!!card.reasonCode && (
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Reason code</Text>
              <Text style={styles.metaVal}>{card.reasonCode}</Text>
            </View>
          )}
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Saved</Text>
            <Text style={styles.metaVal}>{formatSavedAgo(card.savedAt)}</Text>
          </View>
          {!!verifiedDate && (
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Verified</Text>
              <Text style={styles.metaVal}>{verifiedDate}</Text>
            </View>
          )}
        </View>

        {/* Evidence sources */}
        {!!card.evidenceReps?.length && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              SOURCES ({card.evidenceReps.length})
            </Text>
            {card.evidenceReps.map((rep, i) => (
              <View key={i} style={styles.sourceCard}>
                {!!rep.publisher && (
                  <Text style={styles.sourcePublisher}>{rep.publisher}</Text>
                )}
                {!!(rep.title ?? rep.claimReviewed) && (
                  <Text style={styles.sourceTitle} numberOfLines={3}>
                    {rep.title ?? rep.claimReviewed}
                  </Text>
                )}
                {!!rep.rating?.text && (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Rating</Text>
                    <Text style={styles.ratingText}>{rep.rating.text}</Text>
                  </View>
                )}
                {!!rep.claimDate && (
                  <Text style={styles.sourceDate}>{rep.claimDate}</Text>
                )}
                {!!rep.url && (
                  <Pressable
                    onPress={() => Linking.openURL(rep.url!)}
                    style={styles.sourceUrlBtn}
                    hitSlop={8}
                  >
                    <Text style={styles.sourceUrlText}>View source →</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Claim ID */}
        <Text style={styles.claimId}>ID: {card.id}</Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const SHEET_BG = "rgba(223, 248, 248, 0.99)";
const TEXT    = "#0b1723";
const TEXT2   = "rgba(11,23,35,0.62)";
const TEXT3   = "rgba(11,23,35,0.42)";
const BORDER  = "rgba(11,23,35,0.10)";
const CARD_BG = "rgba(255,255,255,0.68)";

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 10,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },

  backBtn: {
    width: 70,
  },

  backBtnText: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 15,
  },

  headerTitle: {
    color: TEXT2,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1.2,
  },

  headerSpacer: {
    width: 70,
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  claimCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 14,
    borderLeftWidth: 4,
    marginBottom: 12,
  },

  claimEyebrow: {
    fontSize: 11,
    fontWeight: "900",
    color: TEXT3,
    letterSpacing: 1,
    marginBottom: 6,
  },

  claimText: {
    fontSize: 17,
    fontWeight: "800",
    color: TEXT,
    lineHeight: 24,
  },

  verdictCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },

  verdictTopRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },

  verdictBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },

  verdictBadgeText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.5,
  },

  subjectivePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(124,58,237,0.12)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.25)",
  },

  subjectivePillText: {
    color: "#7c3aed",
    fontWeight: "900",
    fontSize: 11,
  },

  typePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(11,23,35,0.08)",
  },

  typePillText: {
    color: TEXT2,
    fontWeight: "800",
    fontSize: 11,
  },

  sublabel: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT2,
    lineHeight: 20,
  },

  section: {
    marginBottom: 12,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: TEXT3,
    letterSpacing: 1,
    marginBottom: 8,
  },

  whyText: {
    fontSize: 15,
    fontWeight: "700",
    color: TEXT,
    lineHeight: 22,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 12,
  },

  metaCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 12,
  },

  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },

  metaKey: {
    fontSize: 13,
    fontWeight: "700",
    color: TEXT3,
  },

  metaVal: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
    flexShrink: 1,
    textAlign: "right",
    marginLeft: 16,
  },

  sourceCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },

  sourcePublisher: {
    fontSize: 11,
    fontWeight: "900",
    color: TEXT3,
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: "uppercase",
  },

  sourceTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: TEXT,
    lineHeight: 20,
    marginBottom: 6,
  },

  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },

  ratingLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: TEXT3,
  },

  ratingText: {
    fontSize: 12,
    fontWeight: "800",
    color: TEXT2,
  },

  sourceDate: {
    fontSize: 12,
    fontWeight: "700",
    color: TEXT3,
    marginBottom: 6,
  },

  sourceUrlBtn: {
    marginTop: 4,
  },

  sourceUrlText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0e7490",
  },

  claimId: {
    fontSize: 11,
    fontWeight: "700",
    color: TEXT3,
    textAlign: "center",
    marginTop: 8,
  },
});
