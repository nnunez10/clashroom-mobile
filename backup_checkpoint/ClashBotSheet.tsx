import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

type ClaimStatus = "queued" | "checking" | "matched" | "no_match" | "error" | "disputed";

type Claim = {
  id: string;
  text: string;
  status: ClaimStatus;
  createdAt?: number;
  checkingAt?: number;
  completedAt?: number;
  verification?: any;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;

  transcript: string[];
  claims: Claim[];

  onSubmitClaim: (text: string) => void;

  mode?: "dashboard" | "quick_verify";
  initialDraft?: string;
};

const BRAND_A = "#24E6B8";
const BRAND_B = "#26C6FF";

// Android glyph clipping guard
const INPUT_FONT_SIZE = 15;
const INPUT_LINE_HEIGHT = 18;

function statusPill(status: ClaimStatus) {
  switch (status) {
    case "queued":
      return { label: "Queued", bg: "rgba(0,0,0,0.06)", border: "rgba(0,0,0,0.10)", text: "#111827" };
    case "checking":
      return { label: "Checking", bg: "rgba(245,166,35,0.16)", border: "rgba(245,166,35,0.28)", text: "#7C4A00" };
    case "matched":
      return { label: "Matched", bg: "rgba(36,230,184,0.18)", border: "rgba(36,230,184,0.32)", text: "#065F46" };
    case "no_match":
      return { label: "No match", bg: "rgba(38,198,255,0.14)", border: "rgba(38,198,255,0.26)", text: "#0B4A6F" };
    case "disputed":
      return { label: "Disputed", bg: "rgba(255,77,77,0.12)", border: "rgba(255,77,77,0.22)", text: "#7A1111" };
    case "error":
    default:
      return { label: "Error", bg: "rgba(255,77,77,0.12)", border: "rgba(255,77,77,0.22)", text: "#7A1111" };
  }
}

function topMatch(v: any) {
  return v?.top || v?.matches?.[0] || null;
}

export default function ClashBotSheet({
  isOpen,
  onClose,
  transcript,
  claims,
  onSubmitClaim,
  mode = "dashboard",
  initialDraft = "",
}: Props) {
  // Default = LIGHT every open
  const [isDark, setIsDark] = useState(false);
  const [draft, setDraft] = useState("");

  // Animated lift so we don't fight Modal layout
  const translateY = useRef(new Animated.Value(0)).current;
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (e: any) => {
      const winH = Dimensions.get("window").height;

      const screenY = e?.endCoordinates?.screenY;
      const computed = typeof screenY === "number" ? Math.max(0, winH - screenY) : 0;

      const h = Math.max(e?.endCoordinates?.height ?? 0, computed);
      setKbHeight(h);

      const lift = Math.max(0, h - 14);

      Animated.timing(translateY, {
        toValue: -lift,
        duration: Platform.OS === "ios" ? 220 : 180,
        useNativeDriver: true,
      }).start();
    };

    const onHide = () => {
      setKbHeight(0);
      Animated.timing(translateY, {
        toValue: 0,
        duration: Platform.OS === "ios" ? 220 : 160,
        useNativeDriver: true,
      }).start();
    };

    const s1 = Keyboard.addListener(showEvt, onShow);
    const s2 = Keyboard.addListener(hideEvt, onHide);

    return () => {
      s1.remove();
      s2.remove();
    };
  }, [translateY]);

  useEffect(() => {
    if (!isOpen) return;
    setIsDark(false);
    setDraft(initialDraft || "");

    translateY.setValue(0);
    setKbHeight(0);
  }, [isOpen, initialDraft, translateY]);

  const theme = useMemo(() => {
    if (!isDark) {
      return {
        sheetBg: "#FFFFFF",
        sheetBorder: "rgba(36,230,184,0.22)",
        title: "#0B1220",
        sub: "rgba(11,18,32,0.70)",
        cardBg: "#FFFFFF",
        cardBorder: "rgba(0,0,0,0.08)",
        inputBg: "rgba(36,230,184,0.08)",
        inputBorder: "rgba(36,230,184,0.30)",
        inputText: "#0B1220",
        placeholder: "rgba(11,18,32,0.35)",
        dim: "rgba(0,0,0,0.35)",
        divider: "rgba(0,0,0,0.06)",
        btnBg: "rgba(0,0,0,0.05)",
        btnBorder: "rgba(0,0,0,0.10)",
        btnText: "#0B1220",
        hint: "rgba(11,18,32,0.55)",
      };
    }
    return {
      sheetBg: "#0E141B",
      sheetBorder: "rgba(36,230,184,0.22)",
      title: "#FFFFFF",
      sub: "rgba(255,255,255,0.70)",
      cardBg: "rgba(255,255,255,0.04)",
      cardBorder: "rgba(255,255,255,0.10)",
      inputBg: "rgba(255,255,255,0.06)",
      inputBorder: "rgba(36,230,184,0.30)",
      inputText: "#FFFFFF",
      placeholder: "rgba(255,255,255,0.35)",
      dim: "rgba(0,0,0,0.55)",
      divider: "rgba(255,255,255,0.08)",
      btnBg: "rgba(255,255,255,0.06)",
      btnBorder: "rgba(255,255,255,0.10)",
      btnText: "#FFFFFF",
      hint: "rgba(255,255,255,0.55)",
    };
  }, [isDark]);

  function submit() {
    const t = (draft || "").trim();
    if (!t) return;
    onSubmitClaim(t);
    setDraft("");
  }

  const headerToggleLabel = isDark ? "Dark" : "Light";

  // Latest completed verdict (so user sees something immediately)
  const latestVerdict = useMemo(() => {
    // scan from newest -> oldest
    for (let i = (claims?.length || 0) - 1; i >= 0; i--) {
      const c = claims[i];
      if (!c) continue;
      if (c.status === "matched" || c.status === "no_match" || c.status === "disputed" || c.status === "error") {
        return c;
      }
    }
    return null;
  }, [claims]);

  const latestPill = latestVerdict ? statusPill(latestVerdict.status) : null;
  const latestMatch = latestVerdict ? topMatch(latestVerdict.verification) : null;

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.dim }]} onPress={onClose} />

      <View style={styles.modalRoot}>
        <Animated.View style={[styles.sheetWrap, { transform: [{ translateY }] }]}>
          <SafeAreaView style={[styles.sheet, { backgroundColor: theme.sheetBg, borderColor: theme.sheetBorder }]}>
            <LinearGradient
              colors={["rgba(36,230,184,0.22)", "rgba(38,198,255,0.14)", "rgba(0,0,0,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.topGlow}
              pointerEvents="none"
            />

            <View style={styles.grabberWrap}>
              <View style={[styles.grabber, { backgroundColor: theme.divider }]} />
            </View>

            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: theme.title }]}>ClashBot</Text>
                <Text style={[styles.sub, { color: theme.sub }]}>ClashBot verifies claims in real time.</Text>
              </View>

              <View style={styles.toggleWrap}>
                <Text style={[styles.toggleLabel, { color: theme.sub }]}>Theme</Text>
                <Text style={[styles.toggleValue, { color: theme.title }]}>{headerToggleLabel}</Text>
                <Switch
                  value={isDark}
                  onValueChange={setIsDark}
                  thumbColor={"#FFFFFF"}
                  trackColor={{
                    false: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)",
                    true: "rgba(36,230,184,0.30)",
                  }}
                />
              </View>

              <Pressable style={[styles.closeBtn, { backgroundColor: theme.btnBg, borderColor: theme.btnBorder }]} onPress={onClose}>
                <Text style={[styles.closeText, { color: theme.btnText }]}>Close</Text>
              </Pressable>
            </View>

            <View style={styles.inputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder='Type a claim like: "The Earth is flat."'
                placeholderTextColor={theme.placeholder}
                returnKeyType="done"
                onSubmitEditing={submit}
                textAlignVertical="center"
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.inputBorder,
                    color: theme.inputText,
                  },
                  Platform.OS === "android"
                    ? { includeFontPadding: false, paddingVertical: 0, paddingLeft: 14 }
                    : { paddingVertical: 12 },
                ]}
              />

              <Pressable onPress={submit} style={styles.verifyBtn} hitSlop={10}>
                <LinearGradient colors={[BRAND_A, BRAND_B]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.verifyBtnInner}>
                  <Text style={styles.verifyBtnText}>Verify</Text>
                </LinearGradient>
              </Pressable>
            </View>

            <Text style={[styles.hint, { color: theme.hint }]}>Type or say a claim, then tap Verify for receipts.</Text>

            {/* Always-visible latest verdict */}
            <View style={[styles.latestWrap, { borderColor: theme.divider }]}>
              <Text style={[styles.latestLabel, { color: theme.sub }]}>Latest verdict</Text>

              {!latestVerdict ? (
                <Text style={[styles.latestEmpty, { color: theme.sub }]}>No results yet.</Text>
              ) : (
                <View style={styles.latestRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.latestText, { color: theme.title }]} numberOfLines={1}>
                      {latestVerdict.text}
                    </Text>
                    {latestMatch?.publisher || latestMatch?.title ? (
                      <Text style={[styles.latestMeta, { color: theme.sub }]} numberOfLines={1}>
                        {latestMatch?.publisher ? latestMatch.publisher : "Source"}
                        {latestMatch?.title ? ` • ${latestMatch.title}` : ""}
                      </Text>
                    ) : (
                      <Text style={[styles.latestMeta, { color: theme.sub }]} numberOfLines={1}>
                        No source match returned.
                      </Text>
                    )}
                  </View>

                  {latestPill ? (
                    <View style={[styles.pill, { backgroundColor: latestPill.bg, borderColor: latestPill.border }]}>
                      <Text style={[styles.pillText, { color: latestPill.text }]}>{latestPill.label}</Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: theme.title }]}>Live Transcript</Text>
                <Text style={[styles.cardText, { color: theme.sub }]}>
                  {transcript?.length ? transcript[0] : mode === "dashboard" ? "Waiting…" : "Listening…"}
                </Text>
              </View>

              <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: theme.title }]}>Claims Queue ({claims?.length || 0})</Text>

                {!claims?.length ? (
                  <Text style={[styles.cardText, { color: theme.sub }]}>No claims yet.</Text>
                ) : (
                  <View style={{ marginTop: 10, gap: 10 }}>
                    {/* Show newest first so results appear immediately */}
                    {claims
                      .slice()
                      .reverse()
                      .slice(0, 8)
                      .map((c) => {
                        const pill = statusPill(c.status);
                        const m = topMatch(c.verification);

                        return (
                          <View key={c.id} style={[styles.claimRow, { borderColor: theme.divider }]}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.claimText, { color: theme.title }]} numberOfLines={2}>
                                {c.text}
                              </Text>

                              {m?.publisher || m?.title ? (
                                <Text style={[styles.claimMeta, { color: theme.sub }]} numberOfLines={2}>
                                  {m?.publisher ? `Match: ${m.publisher}` : "Match"}
                                  {m?.title ? ` • ${m.title}` : ""}
                                </Text>
                              ) : null}

                              {c.status === "disputed" ? (
                                <Text style={[styles.claimMeta, { color: "rgba(255,77,77,0.85)" }]} numberOfLines={2}>
                                  Low relevance match. Treat as disputed.
                                </Text>
                              ) : null}
                            </View>

                            <View style={[styles.pill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
                              <Text style={[styles.pillText, { color: pill.text }]}>{pill.label}</Text>
                            </View>
                          </View>
                        );
                      })}
                  </View>
                )}
              </View>

              {/* KEY: this gives you scroll room above the keyboard so “verdicts” aren’t hidden */}
              <View style={{ height: kbHeight ? kbHeight + 40 : 24 }} />
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  sheetWrap: { width: "100%" },

  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingBottom: 10,
    maxHeight: "96%",
    minHeight: 420,
    overflow: "hidden",
  },

  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 26 },

  grabberWrap: { alignItems: "center", paddingTop: 10, paddingBottom: 6 },
  grabber: { width: 56, height: 5, borderRadius: 999 },

  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  title: { fontSize: 20, fontWeight: "900" },
  sub: { marginTop: 4, fontWeight: "700" },

  toggleWrap: { alignItems: "center", justifyContent: "center" },
  toggleLabel: { fontSize: 12, fontWeight: "900", marginBottom: 2 },
  toggleValue: { fontSize: 12, fontWeight: "900", marginBottom: 6 },

  closeBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontWeight: "900" },

  inputRow: {
    paddingHorizontal: 16,
    marginTop: 2,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },

  input: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontWeight: "700",
    fontSize: INPUT_FONT_SIZE,
    lineHeight: INPUT_LINE_HEIGHT,
  },

  verifyBtn: { width: 100 },
  verifyBtnInner: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  verifyBtnText: { fontWeight: "900", color: "#071017" },

  hint: { paddingHorizontal: 16, marginTop: 8, fontSize: 12, fontWeight: "700" },

  latestWrap: {
    marginTop: 10,
    marginHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  latestLabel: { fontSize: 11, fontWeight: "900", marginBottom: 6 },
  latestEmpty: { fontWeight: "800" },
  latestRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  latestText: { fontWeight: "900" },
  latestMeta: { marginTop: 4, fontWeight: "700", fontSize: 12 },

  card: {
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
  },
  cardTitle: { fontSize: 14, fontWeight: "900" },
  cardText: { marginTop: 8, lineHeight: 20, fontWeight: "700" },

  claimRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    borderTopWidth: 1,
    paddingTop: 10,
  },
  claimText: { fontWeight: "900", fontSize: 13, lineHeight: 18 },
  claimMeta: { marginTop: 6, fontWeight: "700", fontSize: 12, lineHeight: 16 },

  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontWeight: "900", fontSize: 12 },
});