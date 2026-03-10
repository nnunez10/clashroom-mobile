import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
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

  // optional, but your index.tsx is passing these
  mode?: "dashboard" | "quick_verify";
  initialDraft?: string;
};

const BRAND_A = "#24E6B8";
const BRAND_B = "#26C6FF";

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
  // Default LIGHT every time you open
  const [isDark, setIsDark] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setIsDark(false); // always open light by default
    setDraft(initialDraft || "");
  }, [isOpen, initialDraft]);

  const theme = useMemo(() => {
    if (!isDark) {
      return {
        sheetBg: "#FFFFFF",
        sheetBorder: "rgba(0,0,0,0.08)",
        title: "#0B1220",
        sub: "rgba(11,18,32,0.70)",
        cardBg: "#FFFFFF",
        cardBorder: "rgba(0,0,0,0.08)",
        inputBg: "rgba(0,0,0,0.04)",
        inputBorder: "rgba(0,0,0,0.10)",
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
      sheetBorder: "rgba(255,255,255,0.10)",
      title: "#FFFFFF",
      sub: "rgba(255,255,255,0.70)",
      cardBg: "rgba(255,255,255,0.04)",
      cardBorder: "rgba(255,255,255,0.10)",
      inputBg: "rgba(255,255,255,0.06)",
      inputBorder: "rgba(255,255,255,0.10)",
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

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.dim }]} onPress={onClose} />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.kb}>
        <SafeAreaView
          style={[
            styles.sheet,
            {
              backgroundColor: theme.sheetBg,
              borderColor: theme.sheetBorder,
            },
          ]}
        >
          {/* Grabber */}
          <View style={styles.grabberWrap}>
            <View style={[styles.grabber, { backgroundColor: theme.divider }]} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.title }]}>ClashBot</Text>
              <Text style={[styles.sub, { color: theme.sub }]}>ClashBot verifies claims in real time.</Text>
            </View>

            <View style={styles.toggleWrap}>
              <Text style={[styles.toggleLabel, { color: theme.sub }]}>{headerToggleLabel}</Text>
              <Switch
                value={isDark}
                onValueChange={setIsDark}
                thumbColor={"#FFFFFF"}
                trackColor={{ false: "rgba(0,0,0,0.18)", true: "rgba(36,230,184,0.30)" }}
              />
            </View>

            <Pressable style={[styles.closeBtn, { backgroundColor: theme.btnBg, borderColor: theme.btnBorder }]} onPress={onClose}>
              <Text style={[styles.closeText, { color: theme.btnText }]}>Close</Text>
            </Pressable>
          </View>

          {/* Input Row */}
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder='Type a claim like: "The Earth is flat."'
              placeholderTextColor={theme.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: theme.inputBg,
                  borderColor: theme.inputBorder,
                  color: theme.inputText,
                },
              ]}
              returnKeyType="done"
              onSubmitEditing={submit}
            />

            <Pressable onPress={submit} style={styles.verifyBtn}>
              <View style={[styles.verifyBtnInner, { borderColor: "rgba(36,230,184,0.30)" }]}>
                <Text style={[styles.verifyBtnText, { color: isDark ? "#FFFFFF" : "#0B1220" }]}>Verify</Text>
              </View>
            </Pressable>
          </View>

          <Text style={[styles.hint, { color: theme.hint }]}>
            Type or say a claim, then tap Verify for receipts.
          </Text>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 18 }} showsVerticalScrollIndicator={false}>
            {/* Transcript */}
            <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <Text style={[styles.cardTitle, { color: theme.title }]}>Live Transcript</Text>
              <Text style={[styles.cardText, { color: theme.sub }]}>
                {transcript?.length ? transcript[0] : mode === "dashboard" ? "Waiting…" : "Listening…"}
              </Text>
            </View>

            {/* Claims */}
            <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <Text style={[styles.cardTitle, { color: theme.title }]}>
                Claims Queue ({claims?.length || 0})
              </Text>

              {!claims?.length ? (
                <Text style={[styles.cardText, { color: theme.sub }]}>No claims yet.</Text>
              ) : (
                <View style={{ marginTop: 10, gap: 10 }}>
                  {claims.slice(0, 8).map((c) => {
                    const pill = statusPill(c.status);
                    const v = c.verification;
                    const m = topMatch(v);

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

                        <View
                          style={[
                            styles.pill,
                            {
                              backgroundColor: pill.bg,
                              borderColor: pill.border,
                            },
                          ]}
                        >
                          <Text style={[styles.pillText, { color: pill.text }]}>{pill.label}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kb: { flex: 1, justifyContent: "flex-end" },

  backdrop: { ...StyleSheet.absoluteFillObject },

  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingBottom: 10,
    maxHeight: "86%",
    overflow: "hidden",
  },

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
  toggleLabel: { fontSize: 12, fontWeight: "900", marginBottom: 4 },

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
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontWeight: "700",
  },

  verifyBtn: { width: 92 },
  verifyBtnInner: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    backgroundColor: "rgba(36,230,184,0.14)",
  },
  verifyBtnText: { fontWeight: "900" },

  hint: { paddingHorizontal: 16, marginTop: 8, fontSize: 12, fontWeight: "700" },

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