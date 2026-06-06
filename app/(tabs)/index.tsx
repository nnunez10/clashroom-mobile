// app/(tabs)/index.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import ClashBotSheet from "../../components/clashbot/ClashBotSheet";
import ClashBotWidget from "../../components/clashbot/ClashBotWidget";
import { isSubjectiveClaim } from "../../lib/clashbot/subjectiveClash";
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
  const [pendingQuickClaim, setPendingQuickClaim] = useState("");
  const [pendingResponse, setPendingResponse] = useState(false);
  const [isListeningForClaim, setIsListeningForClaim] = useState(false);
  const [voiceHint, setVoiceHint] = useState("PRESS + HOLD TO TALK");
  const userSubmittedTextsRef = useRef<Set<string>>(new Set());
  const speechTextRef = useRef("");
  const speechActiveRef = useRef(false);
  const speechSessionRef = useRef(0);
  const speechEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickInputRef = useRef<TextInput | null>(null);
  const lastSubmitAtRef = useRef(0);
  const isListeningShared = useSharedValue(false);

  const {
    transcript,
    claims,
    activeClaimsCount,
    bubbleIsChecking,
    submitDirectClaim,
    challengeClaim,
    defendClaim,
  } = useMockClashBotEngine();

  // Detect when a user-submitted claim becomes a timed defense.
  useEffect(() => {
    const hasPendingChallenge = claims.some(
      (c: any) =>
        c.pendingResponse &&
        (userSubmittedTextsRef.current.has(c.text) ||
          c.challengedBy ||
          c.verification?.displayVerdict?.clashMechanic === "factual_clash")
    );
    setPendingResponse(hasPendingChallenge);
  }, [claims]);

  function handleDirectSubmit(text: string) {
    userSubmittedTextsRef.current.add(text.trim());
    submitDirectClaim(text);
  }

  function handlePendingResolved() {
    // Remove responded claim texts so they don't re-trigger
    claims
      .filter((c: any) => c.pendingResponse && userSubmittedTextsRef.current.has(c.text))
      .forEach((c: any) => userSubmittedTextsRef.current.delete(c.text));
    setPendingResponse(false);
  }

  function handleChallengeClaim(claimId: string) {
    challengeClaim(claimId);
  }

  function clearSpeechEndTimer() {
    if (!speechEndTimerRef.current) return;
    clearTimeout(speechEndTimerRef.current);
    speechEndTimerRef.current = null;
  }

  function speechErrorMessage(code: string) {
    const lower = code.toLowerCase();
    if (lower.includes("permission") || lower.includes("not-allowed") || lower.includes("denied")) {
      return "Mic permission denied. Enable it in settings.";
    }
    if (lower.includes("no-speech") || lower.includes("audio-capture")) {
      return "Didn't catch that. Hold and try again.";
    }
    return "Could not transcribe that. Try again.";
  }

  function commitSpeechDraft() {
    clearSpeechEndTimer();
    speechActiveRef.current = false;
    setIsListeningForClaim(false);

    const next = speechTextRef.current.trim();
    if (!next || next.length < 15 || next.split(/\s+/).length < 3) {
      setVoiceHint("Didn't catch that. Hold and try again.");
      return;
    }
    if (userSubmittedTextsRef.current.has(next)) return;
    const now = Date.now();
    if (now - lastSubmitAtRef.current < 2000) return;
    lastSubmitAtRef.current = now;

    if (isSubjectiveClaim(next)) {
      console.log(`[commitSpeechDraft] subjective claim detected, opening dashboard: "${next.slice(0, 80)}"`);
      handleDirectSubmit(next);
      openDashboard();
      setVoiceHint("Subjective — showing as clash.");
      return;
    }

    setVoiceHint("Verifying...");
    handleDirectSubmit(next);
    openQuickVerify(next);
  }

  function startPushToClaim() {
    if (speechActiveRef.current) return;
    console.log("[PushToClaim] mic press start");
    speechSessionRef.current += 1;
    clearSpeechEndTimer();
    speechTextRef.current = "";
    speechActiveRef.current = true;
    setIsListeningForClaim(true);
    setVoiceHint("Listening... release to draft.");
    ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: true });
  }

  function stopPushToClaim() {
    if (!speechActiveRef.current) return;
    speechActiveRef.current = false;
    console.log("[PushToClaim] mic release");
    setVoiceHint("Drafting claim...");
    clearSpeechEndTimer();
    speechEndTimerRef.current = setTimeout(commitSpeechDraft, 1200);
    ExpoSpeechRecognitionModule.stop();
  }

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results?.[0]?.transcript?.trim();
    console.log("[PushToClaim] result", text, "final:", event.isFinal);
    if (text) speechTextRef.current = text;
    if (event.isFinal && speechActiveRef.current) commitSpeechDraft();
  });

  useSpeechRecognitionEvent("end", () => {
    console.log("[PushToClaim] end");
    if (!speechActiveRef.current) return;
    clearSpeechEndTimer();
    speechEndTimerRef.current = setTimeout(commitSpeechDraft, 450);
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.log("[PushToClaim] error", event.error);
    if (!speechActiveRef.current) return;
    clearSpeechEndTimer();
    speechActiveRef.current = false;
    setIsListeningForClaim(false);
    if (speechTextRef.current.trim()) { commitSpeechDraft(); return; }
    setVoiceHint(speechErrorMessage(event.error));
  });

  // Refs hold the latest function versions but are never passed into worklets.
  const startPushToClaimRef = useRef(startPushToClaim);
  startPushToClaimRef.current = startPushToClaim;
  const stopPushToClaimRef = useRef(stopPushToClaim);
  stopPushToClaimRef.current = stopPushToClaim;

  // Stable JS-thread callbacks delegating through refs. These are the values
  // passed to runOnJS — a plain function reference, not the ref object itself.
  const callStart = useCallback(() => { startPushToClaimRef.current(); }, []);
  const callStop = useCallback(() => { stopPushToClaimRef.current(); }, []);

  const micBtnAnimStyle = useAnimatedStyle(() => ({
    backgroundColor: isListeningShared.value
      ? "rgba(255,77,77,0.16)"
      : "rgba(34,211,238,0.10)",
    borderColor: isListeningShared.value
      ? "rgba(255,77,77,0.42)"
      : "rgba(34,211,238,0.30)",
  }));
  const micBtnTextAnimStyle = useAnimatedStyle(() => ({
    color: isListeningShared.value ? "#ffb4b4" : "rgba(34,211,238,0.95)",
  }));

  const micGesture = useMemo(() =>
    Gesture.LongPress()
      .minDuration(0)
      .maxDistance(999)
      .onStart(() => {
        "worklet";
        isListeningShared.value = true;
        runOnJS(callStart)();
      })
      .onFinalize(() => {
        "worklet";
        isListeningShared.value = false;
        runOnJS(callStop)();
      }),
    [callStart, callStop, isListeningShared]
  );

  useEffect(() => {
    return () => {
      clearSpeechEndTimer();
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  const checkingClaim = useMemo(
    () => claims.find((c) => c.status === "checking") || null,
    [claims]
  );
  const queuedClaim = useMemo(
    () => claims.find((c) => c.status === "queued") || null,
    [claims]
  );
  const lastResolved = useMemo(() => getLatestResolvedClaim(claims), [claims]);

  const widgetTone = useMemo<WidgetTone>(() => {
    if (claims.some((c) => c.status === "checking")) return "checking";
    if (lastResolved?.status === "matched") return "verified";
    if (lastResolved?.status === "disputed" || lastResolved?.status === "error") {
      return "disputed";
    }
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
    if (lastResolved?.status === "matched") {
      return "Receipts found for the latest claim.";
    }
    if (lastResolved?.status === "disputed") {
      return "Latest claim appears contradicted.";
    }
    if (lastResolved?.status === "error") return "Latest check hit an error.";
    if (lastResolved?.status === "no_match") {
      return "No direct source found for the latest claim.";
    }
    return "ClashBot verifies claims in real time.";
  }, [checkingClaim, queuedClaim, lastResolved]);

  const heroLiveLine = useMemo(() => {
    if (checkingClaim?.text) return `Checking: "${checkingClaim.text}"`;
    if (queuedClaim?.text) return `Queued: "${queuedClaim.text}"`;

    if (lastResolved?.text) {
      if (lastResolved.status === "matched") {
        return `Latest verified: "${lastResolved.text}"`;
      }
      if (lastResolved.status === "disputed") {
        return `Latest disputed: "${lastResolved.text}"`;
      }
      if (lastResolved.status === "no_match") {
        return `Latest no-match: "${lastResolved.text}"`;
      }
      if (lastResolved.status === "error") {
        return `Latest error: "${lastResolved.text}"`;
      }
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

  function openQuickVerify(seedText?: string) {
    Keyboard.dismiss();
    if (seedText) {
      setPendingQuickClaim(seedText);
    }
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

    setPendingQuickClaim(t);
    handleDirectSubmit(t);
    setQuickDraft("");
    quickInputRef.current?.blur();
    openQuickVerify(t);
  }

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.ambientWrap}>
        <View style={styles.glowTL} />
        <View style={styles.glowTR} />
        <View style={styles.vignetteTop} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
            Tap ClashBot when someone says “you sure about that?” Then it pulls
            receipts, not vibes.
          </Text>

          <View style={styles.clashBubbleShell}>
            <View style={styles.clashBubbleHead}>
              <View>
                <Text style={styles.clashBubbleKicker}>ClashBubble</Text>
                <Text style={styles.clashBubbleTitle}>Verify Anything</Text>
                <Text style={styles.clashBubbleSub}>
                  Drop a claim. Get a ClaimCard.
                </Text>
              </View>
              <Text style={styles.clashBubbleStatus}>TEXT LIVE</Text>
            </View>

            <View style={styles.verifyModeRow}>
              <View style={[styles.verifyModeChip, styles.verifyModeChipActive]}>
                <Text style={[styles.verifyModeText, styles.verifyModeTextActive]}>Text</Text>
              </View>
              <View style={[styles.verifyModeChip, styles.verifyModeChipDisabled]}>
                <Text style={styles.verifyModeText}>Link soon</Text>
              </View>
              <View style={[styles.verifyModeChip, styles.verifyModeChipDisabled]}>
                <Text style={styles.verifyModeText}>Screenshot soon</Text>
              </View>
            </View>

            <View style={styles.quickRow}>
              <TextInput
                ref={quickInputRef}
                value={quickDraft}
                onChangeText={setQuickDraft}
                placeholder='Drop a claim: "Gas prices are the highest ever"'
                placeholderTextColor="rgba(255,255,255,0.40)"
                style={styles.quickInput}
                returnKeyType="done"
                onSubmitEditing={submitQuickVerify}
              />

              <GestureDetector gesture={micGesture}>
                <Animated.View
                  style={[styles.micBtn, micBtnAnimStyle]}
                  accessibilityRole="button"
                  accessibilityLabel="Press and hold to speak a claim"
                >
                  <Animated.Text style={[styles.micBtnText, micBtnTextAnimStyle]}>
                    {isListeningForClaim ? "Release" : "Mic"}
                  </Animated.Text>
                </Animated.View>
              </GestureDetector>

              <Pressable onPress={submitQuickVerify} style={styles.verifyBtn} hitSlop={10}>
                <Text style={styles.verifyBtnText}>Verify</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.voiceHintLine}>{voiceHint}</Text>
          <Text style={styles.privacyLine}>
            Privacy: mic only runs while you hold it.
          </Text>

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

          <Pressable onPress={openDashboard} style={styles.secondaryCta}>
            <Text style={styles.secondaryCtaText}>Verify a claim</Text>
          </Pressable>

          <Text style={styles.heroHint}>
            Tip: Type or say a claim. ClashBot returns receipts.
          </Text>
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

            <Pressable onPress={openDashboard} style={styles.secondaryCta}>
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
            onPress={openDashboard}
          />
          <ClipCard
            tag="Sports"
            title="“This is the best QB season ever”"
            caption="Stats vs narratives. Verified numbers, not vibes."
            onPress={openDashboard}
          />
          <ClipCard
            tag="Pop Culture"
            title="“That clip is edited”"
            caption="Show context sources and flag uncertainty clearly."
            onPress={openDashboard}
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
          onSubmitClaim={handleDirectSubmit}
          onDashboardSubmit={(text) => {
            const t = text.trim();
            if (!t) return;
            setPendingQuickClaim(t);
            handleDirectSubmit(t);
            if (!isSubjectiveClaim(t) && !pendingResponse) {
              setSheetMode("quick_verify");
            }
          }}
          mode={sheetMode}
          initialDraft={sheetMode === "quick_verify" ? pendingQuickClaim : ""}
          quickVerifyTarget={sheetMode === "quick_verify" ? pendingQuickClaim : undefined}
          pendingResponse={pendingResponse}
          onPendingResolved={handlePendingResolved}
          onStartPending={() => setPendingResponse(true)}
          onDefendClaim={openDashboard}
          onDefendSubmit={(claimId, text) => defendClaim(claimId, text)}
          onChallengeClaim={handleChallengeClaim}
        />

        {!sheetOpen && (
          <ClashBotWidget
            tone={widgetTone}
            subtitle={widgetSubtitle}
            activeCount={activeClaimsCount}
            onPress={openDashboard}
            onHoldStart={callStart}
            onHoldEnd={callStop}
            listening={isListeningForClaim}
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

  clashBubbleShell: {
    marginTop: 14,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.20)",
    borderWidth: 1,
    borderColor: "rgba(36,230,184,0.28)",
  },
  clashBubbleHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  clashBubbleKicker: {
    color: "rgba(36,230,184,0.92)",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  clashBubbleTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
  },
  clashBubbleSub: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
    marginTop: 4,
  },
  clashBubbleStatus: {
    color: "#06141A",
    backgroundColor: "rgba(36,230,184,0.92)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 10,
    fontWeight: "900",
  },
  verifyModeRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  verifyModeChip: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
  },
  verifyModeChipActive: {
    backgroundColor: "rgba(34,211,238,0.16)",
    borderColor: "rgba(34,211,238,0.44)",
  },
  verifyModeChipDisabled: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.10)",
  },
  verifyModeText: {
    color: "rgba(255,255,255,0.50)",
    fontSize: 12,
    fontWeight: "900",
  },
  verifyModeTextActive: { color: "rgba(34,211,238,0.96)" },

  quickRow: { marginTop: 12, flexDirection: "row", gap: 10, alignItems: "center" },
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
  micBtnActive: {
    backgroundColor: "rgba(255,77,77,0.16)",
    borderColor: "rgba(255,77,77,0.42)",
  },
  micBtnText: { color: "rgba(34,211,238,0.95)", fontWeight: "900" },
  micBtnTextActive: { color: "#ffb4b4" },
  verifyBtn: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.92)",
  },
  verifyBtnText: { color: "#031016", fontWeight: "900" },

  voiceHintLine: {
    marginTop: 10,
    color: "rgba(34,211,238,0.95)",
    fontSize: 12,
    fontWeight: "900",
  },
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
