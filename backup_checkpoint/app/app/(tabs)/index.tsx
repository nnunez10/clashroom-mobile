import { LinearGradient } from "expo-linear-gradient";
import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import ClashBotSheet from "../../components/ClashBotSheet";
import ClashBotWidget from "../../components/ClashBotWidget";
import { useMockClashBotEngine } from "../../lib/clashbot/useMockClashBotEngine";

type SheetMode = "dashboard" | "quick_verify";

const BRAND_A = "#24E6B8";
const BRAND_B = "#26C6FF";
const BG = "#0B0F14";

// Android glyph clipping guard
const INPUT_FONT_SIZE = 15;
const INPUT_LINE_HEIGHT = 18;

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

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "green" | "blue" | "mix";
}) {
  const ring =
    accent === "green"
      ? styles.ringGreen
      : accent === "blue"
      ? styles.ringBlue
      : styles.ringMix;

  const num =
    accent === "green"
      ? styles.statNumGreen
      : accent === "blue"
      ? styles.statNumBlue
      : styles.statNumMix;

  return (
    <View style={[styles.statTile, ring]}>
      <Text style={styles.statTileLabel}>{label}</Text>
      <Text style={[styles.statTileValue, num]}>{value}</Text>
      <Text style={styles.statTileSub}>{sub}</Text>
    </View>
  );
}

export default function HomeScreen() {
  // Default OFF (no demo transcript spam)
  const [demoMode, setDemoMode] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("dashboard");
  const [quickDraft, setQuickDraft] = useState("");

  const { transcript, claims, activeClaimsCount, bubbleIsChecking, pushTranscriptLine } =
    useMockClashBotEngine({ demoMode });

  const tone = useMemo(
    () => (bubbleIsChecking ? "checking" : "unverified"),
    [bubbleIsChecking]
  );

  const subtitle = useMemo(() => {
    if (claims.some((c) => c.status === "checking")) return "Checking sources…";
    return "ClashBot verifies claims in real time.";
  }, [claims]);

  const lastResult = useMemo(() => {
    const done = claims.find(
      (c) => c.status === "matched" || c.status === "no_match" || c.status === "disputed"
    );
    return done || null;
  }, [claims]);

  const liveBadge = useMemo(() => {
    if (claims.some((c) => c.status === "checking")) return "LIVE: Checking";
    if (lastResult?.status === "matched") return "LIVE: Matched";
    if (lastResult?.status === "no_match") return "LIVE: No match";
    if (lastResult?.status === "disputed") return "LIVE: Disputed";
    return "LIVE: Ready";
  }, [claims, lastResult]);

  const liveBadgeStyle = useMemo(() => {
    if (claims.some((c) => c.status === "checking")) return styles.badgeLiveChecking;
    if (lastResult?.status === "matched") return styles.badgeLiveMatched;
    if (lastResult?.status === "no_match") return styles.badgeLiveNoMatch;
    if (lastResult?.status === "disputed") return styles.badgeLiveDisputed;
    return styles.badgeLiveReady;
  }, [claims, lastResult]);

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
      {/* Ambient speech bubble glows */}
      <View pointerEvents="none" style={styles.ambientWrap}>
        <View style={styles.speechWrapLeft}>
          <View style={styles.speechBubbleLeft} />
          <View style={styles.speechTailLeft} />
        </View>

        <View style={styles.speechWrapRight}>
          <View style={styles.speechBubbleRight} />
          <View style={styles.speechTailRight} />
        </View>

        <LinearGradient
          pointerEvents="none"
          colors={[
            "rgba(36,230,184,0.10)",
            "rgba(38,198,255,0.06)",
            "rgba(11,15,20,0.92)",
          ]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.gradientWash}
        />

        <View style={styles.vignetteTop} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Top header row */}
        <View style={styles.topRow}>
          <View style={styles.badgeRow}>
            <Text style={styles.heroBadge}>ClashRoom</Text>

            <View style={styles.demoPill}>
              <Text style={styles.demoPillText}>Demo Mode: {demoMode ? "ON" : "OFF"}</Text>
              <Switch
                value={demoMode}
                onValueChange={setDemoMode}
                thumbColor={"#FFFFFF"}
                trackColor={{
                  false: "rgba(255,255,255,0.18)",
                  true: "rgba(36,230,184,0.30)",
                }}
              />
            </View>
          </View>

          <View style={[styles.liveBadge, liveBadgeStyle]}>
            <Text style={styles.liveBadgeText}>{liveBadge}</Text>
          </View>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Debate. Verify. Settle it.</Text>
          <Text style={styles.heroSub}>
            {demoMode
              ? 'Tap ClashBot when someone says "you sure about that?" Then it pulls receipts, not vibes.'
              : "Type or say a claim. ClashBot checks it and shows receipts. No filler. No vibes."}
          </Text>

          {/* Quick Verify bar */}
          <View style={styles.quickRow}>
            <TextInput
              value={quickDraft}
              onChangeText={setQuickDraft}
              placeholder='Quick Verify: "Gas prices are the highest ever"'
              placeholderTextColor="rgba(255,255,255,0.35)"
              returnKeyType="done"
              onSubmitEditing={submitQuickVerify}
              textAlignVertical="center"
              style={[
                styles.quickInput,
                Platform.OS === "android"
                  ? {
                      includeFontPadding: false,
                      paddingVertical: 0,
                      paddingLeft: 14,
                    }
                  : null,
              ]}
            />

            <Pressable onPress={openQuickVerify} style={styles.micBtn} hitSlop={10}>
              <Text style={styles.micBtnText}>Mic</Text>
            </Pressable>

            <Pressable onPress={submitQuickVerify} hitSlop={10}>
              <LinearGradient
                colors={[BRAND_A, BRAND_B]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.verifyBtn}
              >
                <Text style={styles.verifyBtnText}>Verify</Text>
              </LinearGradient>
            </Pressable>
          </View>

          <Text style={styles.privacyLine}>Privacy: not listening unless you tap Mic.</Text>

          {/* Status strip */}
          <View style={styles.heroStrip}>
            <View style={styles.stripItem}>
              <Text style={styles.stripLabel}>Status</Text>
              <Text style={styles.stripValue}>
                {claims.some((c) => c.status === "checking") ? "Checking…" : "Ready"}
              </Text>
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
                {lastResult
                  ? lastResult.status === "matched"
                    ? "Matched"
                    : lastResult.status === "no_match"
                    ? "No match"
                    : "Disputed"
                  : "—"}
              </Text>
            </View>
          </View>

          {/* Open ClashBot */}
          <Pressable onPress={openDashboard} style={styles.primaryCta}>
            <LinearGradient
              colors={[BRAND_A, BRAND_B]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryCtaInner}
            >
              <Text style={styles.primaryCtaText}>Open ClashBot</Text>
            </LinearGradient>
          </Pressable>

          {/* Verify a claim */}
          <Pressable onPress={openQuickVerify} style={styles.secondaryCta}>
            <Text style={styles.secondaryCtaText}>Verify a claim</Text>
          </Pressable>

          <Text style={styles.heroHint}>Tip: Type or say a claim. ClashBot returns receipts.</Text>
        </View>

        {/* Stats tiles */}
        <View style={styles.statsRow}>
          <StatTile label="Verified today" value="18" sub="Across public sources" accent="green" />
          <StatTile label="Receipts opened" value="46" sub="Tap a match to view" accent="mix" />
          <StatTile label="Streak" value="3d" sub="Truth flex" accent="blue" />
        </View>

        {/* Why section */}
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

        {/* ClashClips Preview */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>ClashClips</Text>
            <Text style={styles.sectionPill}>Feed Preview</Text>
          </View>

          <ClipCard
            tag="Hot Take"
            title='“Inflation is down” vs “Prices are still up”'
            caption="ClashBot separates measurable data from interpretation."
            onPress={openQuickVerify}
          />
          <ClipCard
            tag="Sports"
            title='“This is the best QB season ever”'
            caption="Stats vs narratives. Verified numbers, not vibes."
            onPress={openQuickVerify}
          />
          <ClipCard
            tag="Pop Culture"
            title='“That clip is edited”'
            caption="Show context sources and flag uncertainty clearly."
            onPress={openQuickVerify}
          />
        </View>

        {/* Live Verification Preview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Verification</Text>
          <View style={styles.liveBox}>
            <Text style={styles.liveTitle}>How it’s meant to be used</Text>
            <Text style={styles.liveText}>
              In person: someone says something. Someone else says “nah, bro.” Tap ClashBot.
              Verify. Keep the vibe.
            </Text>

            <View style={styles.liveRow}>
              <View
                style={[
                  styles.liveDot,
                  claims.some((c) => c.status === "checking")
                    ? styles.dotChecking
                    : styles.dotReady,
                ]}
              />
              <Text style={styles.liveRowText}>
                {claims.some((c) => c.status === "checking")
                  ? "Verifying now…"
                  : demoMode
                  ? "Demo stream is running."
                  : "Standing by for your claim."}
              </Text>
            </View>

            <Pressable onPress={openQuickVerify} style={styles.secondaryCta}>
              <Text style={styles.secondaryCtaText}>Verify a claim</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ height: 140 }} />
      </ScrollView>

      {/* Sheet */}
      <ClashBotSheet
        isOpen={sheetOpen}
        onClose={closeSheet}
        transcript={transcript}
        claims={claims}
        onSubmitClaim={(text) => pushTranscriptLine(text)}
        mode={sheetMode}
        initialDraft={sheetMode === "quick_verify" ? quickDraft : ""}
      />

      {/* Bubble */}
      {!sheetOpen && (
        <ClashBotWidget
          tone={tone as any}
          subtitle={subtitle}
          onPress={openQuickVerify}
          initialSide="right"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scrollContent: { padding: 16, paddingTop: 52 },

  // Ambient layer
  ambientWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 420,
    overflow: "hidden",
  },
  speechWrapLeft: { position: "absolute", top: -150, left: -120, width: 380, height: 300 },
  speechBubbleLeft: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 380,
    height: 250,
    borderRadius: 190,
    backgroundColor: "rgba(36,230,184,0.16)",
  },
  speechTailLeft: {
    position: "absolute",
    bottom: 8,
    left: 86,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(36,230,184,0.16)",
  },

  speechWrapRight: { position: "absolute", top: -170, right: -140, width: 420, height: 320 },
  speechBubbleRight: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 420,
    height: 270,
    borderRadius: 210,
    backgroundColor: "rgba(38,198,255,0.12)",
  },
  speechTailRight: {
    position: "absolute",
    bottom: 14,
    right: 100,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(38,198,255,0.12)",
  },

  gradientWash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 420,
  },

  vignetteTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 280,
    backgroundColor: "rgba(11,15,20,0.55)",
  },

  // Top row
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  badgeRow: { flexDirection: "row", gap: 10, alignItems: "center" },

  heroBadge: {
    color: "white",
    fontWeight: "900",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(36,230,184,0.14)",
    borderWidth: 1,
    borderColor: "rgba(36,230,184,0.30)",
  },

  demoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  demoPillText: { color: "rgba(255,255,255,0.75)", fontWeight: "900", fontSize: 12 },

  liveBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  liveBadgeText: { color: "white", fontWeight: "900", fontSize: 12 },
  badgeLiveReady: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" },
  badgeLiveChecking: { backgroundColor: "rgba(245,166,35,0.12)", borderColor: "rgba(245,166,35,0.28)" },
  badgeLiveMatched: { backgroundColor: "rgba(36,230,184,0.14)", borderColor: "rgba(36,230,184,0.30)" },
  badgeLiveNoMatch: { backgroundColor: "rgba(38,198,255,0.10)", borderColor: "rgba(38,198,255,0.22)" },
  badgeLiveDisputed: { backgroundColor: "rgba(255,77,77,0.10)", borderColor: "rgba(255,77,77,0.22)" },

  // Hero card
  hero: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  heroTitle: { color: "white", fontSize: 28, fontWeight: "900", marginTop: 2 },
  heroSub: { color: "rgba(255,255,255,0.78)", marginTop: 10, lineHeight: 20 },

  quickRow: { marginTop: 14, flexDirection: "row", gap: 10, alignItems: "center" },
  quickInput: {
    flex: 1,
    height: 52,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    color: "white",
    fontSize: INPUT_FONT_SIZE,
    lineHeight: INPUT_LINE_HEIGHT,
    fontWeight: "700",
  },

  micBtn: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(36,230,184,0.10)",
    borderWidth: 1,
    borderColor: "rgba(36,230,184,0.35)",
  },
  micBtnText: { color: BRAND_A, fontWeight: "900" },

  verifyBtn: {
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  verifyBtnText: { color: "#071017", fontWeight: "900" },

  privacyLine: { marginTop: 10, color: "rgba(255,255,255,0.55)", fontSize: 12 },

  heroStrip: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  stripItem: { flex: 1 },
  stripLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "800" },
  stripValue: { color: "white", fontSize: 13, fontWeight: "900", marginTop: 5 },
  stripDivider: { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.10)", marginHorizontal: 10 },

  primaryCta: { marginTop: 14 },
  primaryCtaInner: {
    height: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryCtaText: { color: "#071017", fontWeight: "900", fontSize: 14 },

  secondaryCta: {
    marginTop: 12,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(36,230,184,0.35)",
  },
  secondaryCtaText: { color: "white", fontWeight: "900" },

  heroHint: { color: "rgba(255,255,255,0.55)", marginTop: 10, fontSize: 12 },

  // Stats tiles
  statsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  statTile: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  ringGreen: { borderColor: "rgba(36,230,184,0.20)" },
  ringBlue: { borderColor: "rgba(38,198,255,0.18)" },
  ringMix: { borderColor: "rgba(36,230,184,0.12)" },

  statTileLabel: { color: "rgba(255,255,255,0.60)", fontSize: 12, fontWeight: "900" },
  statTileValue: { fontSize: 22, fontWeight: "900", marginTop: 6 },
  statNumGreen: { color: BRAND_A },
  statNumBlue: { color: BRAND_B },
  statNumMix: { color: "rgba(36,230,184,0.95)" },
  statTileSub: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 6 },

  // Sections
  section: { marginTop: 16 },
  sectionHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: "white", fontSize: 16, fontWeight: "900" },
  sectionPill: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "900",
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  whyCard: {
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  whyRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 10 },
  whyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "rgba(36,230,184,0.95)", marginTop: 5 },
  whyText: { flex: 1, color: "rgba(255,255,255,0.78)", lineHeight: 20, fontWeight: "700" },

  clipCard: {
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  clipTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  clipTag: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(38,198,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(38,198,255,0.28)",
  },
  clipPill: {
    color: "rgba(255,255,255,0.65)",
    fontWeight: "900",
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  clipTitle: { color: "white", fontWeight: "900", fontSize: 16, marginTop: 12 },
  clipCaption: { color: "rgba(255,255,255,0.72)", marginTop: 8, lineHeight: 20 },
  clipBottomRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  miniStat: {
    flex: 1,
    borderRadius: 14,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  miniStatLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "900" },
  miniStatValue: { color: "white", marginTop: 4, fontWeight: "900" },

  liveBox: {
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  liveTitle: { color: "white", fontWeight: "900", fontSize: 14 },
  liveText: { color: "rgba(255,255,255,0.72)", marginTop: 8, lineHeight: 20 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  dotReady: { backgroundColor: "rgba(36,230,184,0.95)" },
  dotChecking: { backgroundColor: "rgba(245,166,35,0.95)" },
  liveRowText: { color: "rgba(255,255,255,0.78)", fontWeight: "900" },
});