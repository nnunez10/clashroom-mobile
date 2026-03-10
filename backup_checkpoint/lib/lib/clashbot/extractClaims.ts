// lib/clashbot/extractClaims.ts

import type { VerificationResult } from "./types";

export type ClaimStatus =
  | "queued"
  | "checking"
  | "matched"
  | "no_match"
  | "error"
  | "disputed";

export type Claim = {
  id: string;
  text: string;
  ts: number;
  status: ClaimStatus;

  checkingAt?: number;
  completedAt?: number;
  verification?: VerificationResult;
};

function normalize(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  const raw = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return [];

  // Split on sentence endings and hard line breaks
  const parts = raw
    .split(/[\n\r]+|(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  // If the line has no punctuation, treat as one sentence
  if (parts.length === 0) return [raw];
  return parts;
}

function isJunkSentence(s: string) {
  const t = normalize(s);

  if (t.length < 22) return true;

  // Questions are usually prompts, not claims (for MVP signal quality)
  if (s.includes("?")) return true;

  // Greetings / filler
  const junkStarts = ["hey", "yo", "okay", "ok", "well", "so", "like"];
  if (junkStarts.some((w) => t.startsWith(w + " "))) return true;

  // Pure feelings / vague statements
  const junkPhrases = [
    "i feel",
    "i think",
    "i believe",
    "in my opinion",
    "to be honest",
    "honestly",
    "today is",
    "its nice",
    "it is nice",
    "thats crazy",
    "that is crazy",
  ];
  if (junkPhrases.some((p) => t.includes(p))) return true;

  return false;
}

function scoreSentence(s: string) {
  const t = normalize(s);

  let score = 0;

  // "claim-ish" verbs
  const verbs = [
    " is ",
    " are ",
    " was ",
    " were ",
    " causes ",
    " cause ",
    " increases ",
    " decrease ",
    " decreased ",
    " increased ",
    " leads to ",
    " results in ",
    " shows ",
    " proves ",
    " confirmed ",
    " says ",
    " said ",
  ];
  if (verbs.some((v) => t.includes(v))) score += 2;

  // absolute language tends to be claim-y
  const absolutes = [" always ", " never ", " everyone ", " no one ", " cannot ", " can't "];
  if (absolutes.some((a) => t.includes(a))) score += 1;

  // numbers, dates, quantities
  if (/\b\d+([.,]\d+)?\b/.test(s)) score += 2;

  // comparative / superlatives
  const comps = [" highest ", " lowest ", " record ", " most ", " least ", " bigger ", " smaller "];
  if (comps.some((c) => t.includes(c))) score += 1;

  // "according to" style
  if (t.includes("according to") || t.includes("data shows") || t.includes("report says")) {
    score += 2;
  }

  // discourage ultra-long run-ons for MVP
  if (t.length > 180) score -= 1;

  return score;
}

function looksLikeClaim(sentence: string) {
  if (isJunkSentence(sentence)) return false;
  return scoreSentence(sentence) >= 2;
}

export function claimFingerprint(text: string) {
  return normalize(text);
}

export function extractClaimsFromLine(text: string, ts: number): Claim[] {
  const sentences = splitSentences(text);

  const candidates = sentences
    .map((s) => ({ s, score: scoreSentence(s) }))
    .filter((x) => looksLikeClaim(x.s))
    .sort((a, b) => b.score - a.score);

  // cap to avoid spam per tick
  const top = candidates.slice(0, 2);

  return top.map(({ s }) => ({
    id: `${ts}-${Math.random().toString(16).slice(2)}`,
    text: s.trim(),
    ts,
    status: "queued",
  }));
}