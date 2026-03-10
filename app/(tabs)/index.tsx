// app/(tabs)/index.tsx

import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import ClashBotSheet from "../../components/clashbot/ClashBotSheet";
import ClashBotWidget from "../../components/clashbot/ClashBotWidget";
import { useMockClashBotEngine } from "../../lib/clashbot/useMockClashBotEngine";

type SheetMode = "dashboard" | "quick_verify";
type WidgetTone = "unverified" | "checking" | "verified" | "disputed";

const COLORS = {
  bg: "#06141A",
  glass: "rgba(34, 211, 238, 0.12)",
  glass2: "rgba(36, 230, 184, 0.10)",
  stroke: "rgba(255,255,255,0.10)",
  strokeTeal: "rgba(34,211,238,0.28)",
  text: "rgba(255,255,255,0.95)",
  text2: "rgba(255,255,255,0.72)",
  text3: "rgba(255,255,255,0.55)",
  accent: "#22D3EE",
  accent2: "#24E6B8",
  pillDark: "rgba(0,0,0,0.18)",
};

function ClipCard({
  title,
  caption,
  tag,
  onPress,
}: {
  title: string;
  caption: string;
  tag: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.clipCard}>
      <View style={styles.clipTopRow}>
        <Text style={styles.clipTag}>{tag}</Text>
        <Text style={styles.clipPill}>Preview</Text>
      </View>

      <Text style={styles.clipTitle} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.clipCaption} numberOfLines={2}>
        {caption}
      </Text>

      <View style={styles.clipBottomRow}>
        <View style={styles.miniStat}>
          <Text style={styles.miniStatLabel}>Votes</Text>
          <Text style={styles.miniStatValue}>—</Text>
        </View>
        <View style={styles.miniStat}>
          <Text style={styles.miniStatLabel}>Clashes</Text>
          <Text style={styles.miniStatValue}>—</Text>
        </View>
        <View style={styles.miniStat}>
          <Text style={styles.miniStatLabel}>Verified</Text>
          <Text style={styles.miniStatValue}>—</Text>
        </View>
      </View>
    </Pressable>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statTileLabel}>{label}</Text>
      <Text style={styles.statTileValue}>{value}</Text>
      <Text style={styles.statTileSub}>{sub}</Text>
    </View>
  );
}

function getLatestResolvedClaim(claims: any[]) {
  return claims.find(
    (c) =>
      c.status === "matched" ||
      c.status === "disputed" ||
      c.status === "no_match" ||
      c.status === "error"
  );
}

export default function HomeScreen() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("dashboard");
  const [quickDraft, setQuickDraft] = useState("");

  const { transcript, claims, activeClaimsCount, bubbleIsChecking, pushTranscriptLine } =
    useMockClashBotEngine();

  const checkingClaim = useMemo(() => claims.find((c) => c.status === "checking") || null, [claims]);
  const queuedClaim = useMemo(() => claims.find((c) => c.status === "queued") || null, [claims]);
  const lastResolved = useMemo(() => getLatestResolvedClaim(claims), [claims]);

  const widgetTone = useMemo<WidgetTone>(() => {
    if (claims.some((c) => c.status === "checking")) return "checking";
    if (lastResolved?.status === "matched") return "verified";
    if (lastResolved?.status === "disputed" || lastResolved?.status === "error") return "disputed";
    return "unverified";
  }, [claims, lastResolved]);

  const widgetSubtitle = useMemo(() => {
    if (checkingClaim?.text) return "Checking live claim…";
    if (queuedClaim?.text) return "Claim queued";
    if (lastResolved?.status === "matched") return "Receipts ready";
    if (lastResolved?.status === "disputed") return "Claim disputed";
    if (lastResolved?.status === "error") return "Check failed";
    if (lastResolved?.status === "no_match") return "No direct match";
    return "Tap to verify";
  }, [checkingClaim, queuedClaim, lastResolved]);

  const subtitle = useMemo(() => {
    if (checkingClaim) return "Checking sources…";
    if (queuedClaim) return "Claim added to queue.";
    if (lastResolved?.status === "matched") return "Receipts found for the latest claim.";
    if (lastResolved?.status === "disputed") return "Latest claim appears contradicted.";
    if (lastResolved?.status === "error") return "Latest check hit an error.";
    if (lastResolved?.status === "no_match") return "No direct source found for the latest claim.";
    return "ClashBot verifies claims in real time.";
  }, [checkingClaim, queuedClaim, lastResolved]);

  const heroLiveLine = useMemo(() => {
    if (checkingClaim?.text) return `Checking: "${checkingClaim.text}"`;
    if (queuedClaim?.text) return `Queued: "${queuedClaim.text}"`;
    if (lastResolved?.text) {
      if (lastResolved.status === "matched") return `Latest verified: "${lastResolved.text}"`;
      if (lastResolved.status === "disputed") return `Latest disputed: "${lastResolved.text}"`;
      if (lastResolved.status === "no_match") return `Latest no-match: "${lastResolved.text}"`;
      if (lastResolved.status === "error") return `Latest error: "${lastResolved.text}"`;
    }
    return "No live claim yet.";
  }, [checkingClaim, queuedClaim, lastResolved]);

  const liveBadge = useMemo(() => {
    if (claims.some((c) => c.status === "checking")) return "LIVE: Checking";
    if (claims.some((c) => c.status === "queued")) return "LIVE: Queued";
    if (lastResolved?.status === "matched") return "LIVE: Verified";
    if (lastResolved?.status === "disputed") return "LIVE: Disputed";
    if (lastResolved?.status === "no_match") return "LIVE: No Match";
    if (lastResolved?.status === "error") return "LIVE: Error";
    return "LIVE: Ready";
  }, [claims, lastResolved]);

  const liveBadgeStyle = useMemo(() => {
    if (claims.some((c) => c.status === "checking")) return styles.badgeLiveChecking;
    if (claims.some((c) => c.status === "queued")) return styles.badgeLiveQueued;
    if (lastResolved?.status === "matched") return styles.badgeLiveMatched;
    if (lastResolved?.status === "disputed") return styles.badgeLiveDisputed;
    if (lastResolved?.status === "no_match") return styles.badgeLiveNoMatch;
    if (lastResolved?.status === "error") return styles.badgeLiveDisputed;
    return styles.badgeLiveReady;
  }, [claims, lastResolved]);

  const statusValue = useMemo(() => {
    if (claims.some((c) => c.status === "checking")) return "Checking…";
    if (claims.some((c) => c.status === "queued")) return "Queued";
    if (lastResolved?.status === "matched") return "Verified";
    if (lastResolved?.status === "disputed") return "Disputed";
    if (lastResolved?.status === "no_match") return "No Match";
    if (lastResolved?.status === "error") return "Error";
    return "Ready";
  }, [claims, lastResolved]);

  const lastValue = useMemo(() => {
    if (!lastResolved) return "—";
    if (lastResolved.status === "matched") return "Verified";
    if (lastResolved.status === "disputed") return "Disputed";
    if (lastResolved.status === "no_match") return "No match";
    if (lastResolved.status === "error") return "Error";
    return "—";
  }, [lastResolved]);

  function openDashboard() {
    setSheetMode("dashboard");
    setSheetOpen(true);
  }

  function openQuickVerify() {
    setSheetMode("quick_verify");
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setSheetMode("dashboard");
  }

  function submitQuickVerify() {
    const t = quickDraft.trim();
    if (!t) return;
    pushTranscriptLine(t);
    setQuickDraft("");
    openQuickVerify();
  }

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.ambientWrap}>
        <View style={styles.glowTL} />
        <View style={styles.glowTR} />
        <View style={styles.vignetteTop} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={styles.badgeRow}>
            <Text style={styles.heroBadge}>ClashRoom</Text>
            <Text style={styles.heroBadgeGhost}>Mobile Preview</Text>
          </View>

          <View style={[styles.liveBadge, liveBadgeStyle]}>
            <Text style={styles.liveBadgeText}>{liveBadge}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Debate. Verify. Settle it.</Text>
          <Text style={styles.heroSub}>
            Tap ClashBot when someone says “you sure about that?” Then it pulls receipts, not vibes.
          </Text>

          <View style={styles.quickRow}>
            <TextInput
              value={quickDraft}
              onChangeText={setQuickDraft}
              placeholder='Quick Verify: "Gas prices are the highest ever"'
              placeholderTextColor="rgba(255,255,255,0.40)"
              style={styles.quickInput}
              returnKeyType="done"
              onSubmitEditing={submitQuickVerify}
            />

            <Pressable onPress={openQuickVerify} style={styles.micBtn} hitSlop={10}>
              <Text style={styles.micBtnText}>Mic</Text>
            </Pressable>

            <Pressable onPress={submitQuickVerify} style={styles.verifyBtn} hitSlop={10}>
              <Text style={styles.verifyBtnText}>Verify</Text>
            </Pressable>
          </View>

          <Text style={styles.privacyLine}>Privacy: not listening unless you tap Mic.</Text>

          <View style={styles.heroLiveCard}>
            <Text style={styles.heroLiveLabel}>ClashBot Live</Text>
            <Text style={styles.heroLiveText} numberOfLines={2}>
              {heroLiveLine}
            </Text>
            <Text style={styles.heroLiveSub}>{subtitle}</Text>
          </View>

          <View style={styles.heroStrip}>
            <View style={styles.stripItem}>
              <Text style={styles.stripLabel}>Status</Text>
              <Text style={styles.stripValue}>{statusValue}</Text>
            </View>

            <View style={styles.stripDivider} />

            <View style={styles.stripItem}>
              <Text style={styles.stripLabel}>Queue</Text>
              <Text style={styles.stripValue}>{activeClaimsCount}</Text>
            </View>

            <View style={styles.stripDivider} />

            <View style={styles.stripItem}>
              <Text style={styles.stripLabel}>Last</Text>
              <Text style={styles.stripValue} numberOfLines={1}>
                {lastValue}
              </Text>
            </View>
          </View>

          <Pressable onPress={openDashboard} style={styles.primaryCta}>
            <Text style={styles.primaryCtaText}>Open ClashBot</Text>
          </Pressable>

          <Pressable onPress={openQuickVerify} style={styles.secondaryCta}>
            <Text style={styles.secondaryCtaText}>Verify a claim</Text>
          </Pressable>

          <Text style={styles.heroHint}>Tip: Type or say a claim. ClashBot returns receipts.</Text>
        </View>

        <View style={styles.statsRow}>
          <StatTile label="Verified today" value="18" sub="Across public sources" />
          <StatTile label="Receipts opened" value="46" sub="Tap a match to view" />
          <StatTile label="Streak" value="3d" sub="Truth flex" />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>Why this is not just Google</Text>
            <Text style={styles.sectionPill}>Fast mode</Text>
          </View>

          <View style={styles.whyCard}>
            <View style={styles.whyRow}>
              <View style={styles.whyDot} />
              <Text style={styles.whyText}>
                One tap flow. No tab switching, no hunting, no reading 12 links.
              </Text>
            </View>
            <View style={styles.whyRow}>
              <View style={styles.whyDot} />
              <Text style={styles.whyText}>
                Receipts-first UI. It shows the match, rating, and source instantly.
              </Text>
            </View>
            <View style={styles.whyRow}>
              <View style={styles.whyDot} />
              <Text style={styles.whyText}>
                Keeps the vibe. You verify without turning the moment into a lecture.
              </Text>
            </View>

            <Pressable onPress={openQuickVerify} style={styles.secondaryCta}>
              <Text style={styles.secondaryCtaText}>Try a quick verify</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>ClashClips</Text>
            <Text style={styles.sectionPill}>Feed Preview</Text>
          </View>

          <ClipCard
            tag="Hot Take"
            title="“Inflation is down” vs “Prices are still up”"
            caption="ClashBot separates measurable data from interpretation."
            onPress={openQuickVerify}
          />
          <ClipCard
            tag="Sports"
            title="“This is the best QB season ever”"
            caption="Stats vs narratives. Verified numbers, not vibes."
            onPress={openQuickVerify}
          />
          <ClipCard
            tag="Pop Culture"
            title="“That clip is edited”"
            caption="Show context sources and flag uncertainty clearly."
            onPress={openQuickVerify}
          />
        </View>

        <View style={{ height: 160 }} />
      </ScrollView>

      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <ClashBotSheet
          isOpen={sheetOpen}
          onClose={closeSheet}
          transcript={transcript}
          claims={claims}
          onSubmitClaim={(text) => pushTranscriptLine(text)}
          mode={sheetMode as any}
        />

        {!sheetOpen && (
          <ClashBotWidget
            tone={widgetTone}
            subtitle={widgetSubtitle}
            activeCount={activeClaimsCount}
            onPress={openQuickVerify}
            initialSide="right"
            style={styles.bubble}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { padding: 16, paddingTop: 52 },

  ambientWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 420,
    overflow: "hidden",
  },
  glowTL: {
    position: "absolute",
    top: -160,
    left: -120,
    width: 420,
    height: 420,
    borderRadius: 240,
    backgroundColor: "rgba(36, 230, 184, 0.18)",
  },
  glowTR: {
    position: "absolute",
    top: -170,
    right: -150,
    width: 480,
    height: 480,
    borderRadius: 260,
    backgroundColor: "rgba(34, 211, 238, 0.16)",
  },
  vignetteTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 320,
    backgroundColor: "rgba(6, 20, 26, 0.45)",
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  badgeRow: { flexDirection: "row", gap: 10, alignItems: "center" },

  heroBadge: {
    color: COLORS.text,
    fontWeight: "900",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(36, 230, 184, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(36, 230, 184, 0.32)",
  },
  heroBadgeGhost: {
    color: "rgba(255,255,255,0.78)",
    fontWeight: "800",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  liveBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveBadgeText: { color: "white", fontWeight: "900", fontSize: 12 },
  badgeLiveReady: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
  },
  badgeLiveQueued: {
    backgroundColor: "rgba(34,211,238,0.12)",
    borderColor: "rgba(34,211,238,0.28)",
  },
  badgeLiveChecking: {
    backgroundColor: "rgba(245,166,35,0.14)",
    borderColor: "rgba(245,166,35,0.32)",
  },
  badgeLiveMatched: {
    backgroundColor: "rgba(36,230,184,0.16)",
    borderColor: "rgba(36,230,184,0.34)",
  },
  badgeLiveDisputed: {
    backgroundColor: "rgba(255,77,77,0.14)",
    borderColor: "rgba(255,77,77,0.30)",
  },
  badgeLiveNoMatch: {
    backgroundColor: "rgba(34,211,238,0.12)",
    borderColor: "rgba(34,211,238,0.28)",
  },

  hero: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.strokeTeal,
  },
  heroTitle: { color: "white", fontSize: 40, fontWeight: "900", marginTop: 2 },
  heroSub: { color: "rgba(255,255,255,0.78)", marginTop: 10, lineHeight: 20 },

  quickRow: { marginTop: 14, flexDirection: "row", gap: 10, alignItems: "center" },
  quickInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: COLORS.pillDark,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    color: "white",
    fontWeight: "800",
  },
  micBtn: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.10)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.30)",
  },
  micBtnText: { color: "rgba(34,211,238,0.95)", fontWeight: "900" },
  verifyBtn: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.92)",
  },
  verifyBtnText: { color: "#031016", fontWeight: "900" },

  privacyLine: { marginTop: 10, color: COLORS.text3, fontSize: 12 },

  heroLiveCard: {
    marginTop: 14,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.18)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.20)",
  },
  heroLiveLabel: {
    color: "rgba(34,211,238,0.95)",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 6,
  },
  heroLiveText: {
    color: "white",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
  },
  heroLiveSub: {
    color: "rgba(255,255,255,0.64)",
    marginTop: 6,
    fontSize: 12,
    fontWeight: "700",
  },

  heroStrip: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  stripItem: { flex: 1 },
  stripLabel: { color: COLORS.text3, fontSize: 11, fontWeight: "800" },
  stripValue: { color: "white", fontSize: 13, fontWeight: "900", marginTop: 5 },
  stripDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginHorizontal: 10,
  },

  primaryCta: {
    marginTop: 14,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.92)",
  },
  primaryCtaText: { color: "#031016", fontWeight: "900", fontSize: 16 },

  secondaryCta: {
    marginTop: 10,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  secondaryCtaText: { color: "rgba(255,255,255,0.90)", fontWeight: "900", fontSize: 16 },

  heroHint: { color: COLORS.text3, marginTop: 10, fontSize: 12 },

  statsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  statTile: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.18)",
  },
  statTileLabel: { color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: "900" },
  statTileValue: { color: COLORS.accent, fontSize: 26, fontWeight: "900", marginTop: 6 },
  statTileSub: { color: COLORS.text3, fontSize: 12, marginTop: 6 },

  section: { marginTop: 16 },
  sectionHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: "white", fontSize: 18, fontWeight: "900" },
  sectionPill: {
    color: "rgba(255,255,255,0.80)",
    fontWeight: "900",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  whyCard: {
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.18)",
  },
  whyRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 10 },
  whyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.accent2, marginTop: 5 },
  whyText: { flex: 1, color: COLORS.text2, lineHeight: 20, fontWeight: "700" },

  clipCard: {
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.18)",
  },
  clipTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  clipTag: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(34,211,238,0.14)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.28)",
  },
  clipPill: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "900",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  clipTitle: { color: "white", fontWeight: "900", fontSize: 16, marginTop: 12 },
  clipCaption: { color: COLORS.text2, marginTop: 8, lineHeight: 20 },
  clipBottomRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  miniStat: {
    flex: 1,
    borderRadius: 14,
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  miniStatLabel: { color: COLORS.text3, fontSize: 11, fontWeight: "900" },
  miniStatValue: { color: "white", marginTop: 4, fontWeight: "900" },

  bubble: {
    zIndex: 999,
    elevation: 20,
  },
}); 