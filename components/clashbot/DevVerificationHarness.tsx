// components/clashbot/DevVerificationHarness.tsx
//
// DEV-ONLY manual review harness for the ClashBot verification pipeline.
// Renders a list of editable claim inputs; each "Run" button fires the full
// pipeline and displays the 10 diagnostic fields side-by-side.
//
// Guard: returns null in production builds.  Also gate the import site with
// {__DEV__ && <DevVerificationHarness />} to keep the bundle clean.

import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { clusterEvidence } from "@/lib/clashbot/evidenceClustering";
import { findKnownFactOverride } from "@/lib/clashbot/knownFacts";
import { verifyClaimText } from "@/lib/clashbot/verify";
import {
  assessRelevance,
  buildCandidateText,
  buildOverrideVerification,
  classifyClaimStance,
  computeConfidence,
  deriveReasonCode,
} from "@/lib/clashbot/verificationService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HarnessResult = {
  status: string;
  mode: string;
  stance: string;
  reasonCode: string;
  confidenceScore: number;
  confidenceTier: string;
  relevanceReason: string;
  rawMatchCount: number;
  clusteredMatchCount: number;
  topTitle: string;
  topProvider: string;
  topUrl: string;
  message: string;
  ms: number;
};

type Entry = {
  id: string;
  text: string;
  running: boolean;
  result: HarnessResult | null;
  error: string | null;
};

// ---------------------------------------------------------------------------
// Default fixture claims
// ---------------------------------------------------------------------------

const DEFAULT_CLAIMS = [
  "Vaccines cause autism in children",
  "The Earth is flat",
  "NASA faked the moon landing in 1969",
  "COVID-19 vaccines contain microchips that track people",
  "Regular aspirin use prevents heart attacks",
  "The Federal Reserve raised interest rates in 2023",
  "Exercise regularly reduces the risk of cardiovascular disease",
  "Solar energy is now cheaper than coal",
  "Drinking bleach cures COVID-19",
  "Scientists discovered liquid water on Mars",
];

function makeEntry(text: string, idx: number): Entry {
  return { id: `h_${idx}`, text, running: false, result: null, error: null };
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

async function runPipeline(claimText: string): Promise<HarnessResult> {
  const t0 = Date.now();

  // Mirror the engine's override path so known-fact claims work without API keys.
  const override = findKnownFactOverride(claimText);
  if (override) {
    const ov: any = buildOverrideVerification(override);
    const ms = Date.now() - t0;
    const matches: any[] = Array.isArray(ov?.matches) ? ov.matches : [];
    const top = ov?.top ?? matches[0] ?? null;
    return {
      status: "matched",
      mode: "fact_check",
      stance: ov?.stance ?? "unclear",
      reasonCode: ov?.reasonCode ?? "authoritative_contradiction",
      confidenceScore: ov?.confidenceScore ?? 0,
      confidenceTier: ov?.confidenceTier ?? "none",
      relevanceReason: "Known fact override matched this claim family.",
      rawMatchCount: matches.length,
      clusteredMatchCount: matches.length,
      topTitle: top?.title ?? top?.claim ?? "Known fact override",
      topProvider: "known_fact_override",
      topUrl: top?.url ?? "—",
      message: ov?.message ?? override.reason,
      ms,
    };
  }

  const rawResult: any = await verifyClaimText(claimText);
  const ms = Date.now() - t0;

  const result = rawResult || {};
  const top: any = result?.top || result?.matches?.[0] || null;
  const mode: "fact_check" | "recent_coverage" | undefined = result?.mode;
  const candidateText = buildCandidateText(result, top);

  const assessment =
    result?.status !== "matched"
      ? { relevant: true, reason: "(not matched — skipping relevance gate)" }
      : assessRelevance(claimText, candidateText, mode);

  const stance =
    result?.status === "matched" && !assessment.relevant
      ? "unclear"
      : classifyClaimStance(claimText, candidateText, result);

  const { confidenceScore, confidenceTier } = computeConfidence(
    stance as any,
    result?.status,
    result,
    assessment
  );

  const reasonCode = deriveReasonCode(
    stance as any,
    result?.status,
    result,
    assessment
  );

  const matches: any[] = Array.isArray(result?.matches) ? result.matches : [];
  const { representativeCount } = clusterEvidence(matches);

  return {
    status: result?.status ?? "unknown",
    mode: mode ?? "—",
    stance,
    reasonCode,
    confidenceScore,
    confidenceTier,
    relevanceReason: assessment.reason,
    rawMatchCount: matches.length,
    clusteredMatchCount: representativeCount,
    topTitle: top?.title ?? top?.claimReviewed ?? top?.claim ?? "—",
    topProvider: top?.provider ?? "—",
    topUrl: top?.url ?? "—",
    message: String(result?.message ?? ""),
    ms,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function HarnessCard({ entry, onChangeText, onRun }: {
  entry: Entry;
  onChangeText: (id: string, text: string) => void;
  onRun: (id: string) => void;
}) {
  const r = entry.result;

  const tierColor =
    r?.confidenceTier === "high"   ? "#22D3EE" :
    r?.confidenceTier === "medium" ? "#F5A623" :
    r?.confidenceTier === "low"    ? "#FF6B6B" :
    "rgba(255,255,255,0.45)";

  const stanceColor =
    r?.stance === "contradicted" ? "#FF6B6B" :
    r?.stance === "supported"    ? "#24E6B8" :
    "rgba(255,255,255,0.55)";

  return (
    <View style={styles.card}>
      {/* Input row */}
      <View style={styles.inputRow}>
        <TextInput
          value={entry.text}
          onChangeText={(t) => onChangeText(entry.id, t)}
          style={styles.claimInput}
          placeholderTextColor="rgba(255,255,255,0.35)"
          placeholder="Enter a claim…"
          multiline
        />
        <Pressable
          onPress={() => onRun(entry.id)}
          disabled={entry.running}
          style={[styles.runBtn, entry.running && styles.runBtnBusy]}
        >
          {entry.running ? (
            <ActivityIndicator size="small" color="#031016" />
          ) : (
            <Text style={styles.runBtnText}>Run</Text>
          )}
        </Pressable>
      </View>

      {/* Error */}
      {entry.error && (
        <Text style={styles.errorText}>{entry.error}</Text>
      )}

      {/* Result */}
      {r && (
        <View style={styles.resultBlock}>
          {/* Summary badges */}
          <View style={styles.badgeRow}>
            <Text style={[styles.badge, { borderColor: stanceColor, color: stanceColor }]}>
              {r.stance}
            </Text>
            <Text style={[styles.badge, { borderColor: tierColor, color: tierColor }]}>
              {r.confidenceTier} · {r.confidenceScore}
            </Text>
            <Text style={styles.badgeMuted}>{r.status}</Text>
            <Text style={styles.badgeMuted}>{r.ms}ms</Text>
          </View>

          <ResultRow label="reasonCode"      value={r.reasonCode} />
          <ResultRow label="mode"            value={r.mode} />
          <ResultRow label="relevance"       value={r.relevanceReason} />
          <ResultRow label="matches"         value={`${r.rawMatchCount} raw → ${r.clusteredMatchCount} clustered`} />
          <ResultRow label="top provider"    value={r.topProvider} />
          <ResultRow label="top title"       value={r.topTitle} />
          <ResultRow label="top url"         value={r.topUrl} />
          {r.message ? <ResultRow label="message" value={r.message} /> : null}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DevVerificationHarness() {
  if (!__DEV__) return null;

  const [entries, setEntries] = useState<Entry[]>(() =>
    DEFAULT_CLAIMS.map(makeEntry)
  );

  function handleChangeText(id: string, text: string) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, text, result: null, error: null } : e))
    );
  }

  function handleRun(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry || entry.running || !entry.text.trim()) return;

    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, running: true, result: null, error: null } : e))
    );

    runPipeline(entry.text.trim()).then((result) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, running: false, result } : e))
      );
    }).catch((err) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, running: false, error: String(err?.message || err) } : e))
      );
    });
  }

  function handleRunAll() {
    for (const e of entries) handleRun(e.id);
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>DEV · Verification Harness</Text>
        <Pressable onPress={handleRunAll} style={styles.runAllBtn}>
          <Text style={styles.runAllBtnText}>Run All</Text>
        </Pressable>
      </View>

      {entries.map((entry) => (
        <HarnessCard
          key={entry.id}
          entry={entry}
          onChangeText={handleChangeText}
          onRun={handleRun}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const C = {
  bg: "#0B0F14",
  border: "rgba(34,211,238,0.18)",
  accent: "#22D3EE",
  text: "rgba(255,255,255,0.95)",
  text2: "rgba(255,255,255,0.72)",
  text3: "rgba(255,255,255,0.45)",
  inputBg: "rgba(0,0,0,0.25)",
};

const styles = StyleSheet.create({
  root: {
    marginTop: 20,
    paddingBottom: 40,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    color: C.accent,
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  runAllBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(34,211,238,0.14)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.32)",
  },
  runAllBtnText: { color: C.accent, fontWeight: "900", fontSize: 12 },

  card: {
    marginBottom: 10,
    borderRadius: 14,
    padding: 12,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
  },

  inputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  claimInput: {
    flex: 1,
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
    backgroundColor: C.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 40,
  },
  runBtn: {
    width: 52,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.90)",
  },
  runBtnBusy: { backgroundColor: "rgba(34,211,238,0.40)" },
  runBtnText: { color: "#031016", fontWeight: "900", fontSize: 13 },

  errorText: { color: "#FF6B6B", fontSize: 12, marginTop: 6 },

  resultBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.10)",
  },

  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  badge: {
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeMuted: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  resultRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 3,
  },
  resultLabel: {
    color: C.text3,
    fontSize: 11,
    fontWeight: "900",
    width: 80,
    flexShrink: 0,
  },
  resultValue: {
    flex: 1,
    color: C.text2,
    fontSize: 11,
    fontWeight: "700",
  },
});
