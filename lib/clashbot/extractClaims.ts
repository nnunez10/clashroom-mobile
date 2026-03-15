// lib/clashbot/extractClaims.ts

import { getClaimFingerprint } from "./claimDna";
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

  const parts = raw
    .split(/[\n\r]+|(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return [raw];
  return parts;
}

// Leading discourse markers stripped from transcript sentences before scoring
// and before writing claim.text. Ordered longest-first so multi-word phrases
// match before their single-word prefixes.
const FILLER_PREFIXES = [
  "right so ",
  "i mean ",
  "you know ",
  "trust me ",
  "believe me ",
  "the thing is ",
  "here's the thing ",
  "apparently ",
  "reportedly ",
  "supposedly ",
  "allegedly ",
  "actually ",
  "basically ",
  "literally ",
  "frankly ",
  "look ",
  "listen ",
];

function stripFillerPrefix(s: string): string {
  const lower = s.toLowerCase();
  for (const prefix of FILLER_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const rest = s.slice(prefix.length).trimStart();
      // Restore sentence-initial capitalisation.
      return rest.length > 0 ? rest[0].toUpperCase() + rest.slice(1) : rest;
    }
  }
  return s;
}

function isJunkSentence(s: string) {
  const t = normalize(s);

  if (t.length < 15) return true;

  if (s.includes("?")) return true;

  const junkStarts = [
    "hey", "yo", "okay", "ok", "well", "so", "like",
    "you know", "i mean", "right so", "trust me", "believe me",
    // Gen-Z / internet-discourse starters
    "nah", "fr", "no cap", "lowkey", "ngl", "tbh", "bruh", "bro", "imo",
  ];
  if (junkStarts.some((w) => t.startsWith(w + " "))) return true;

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
    "i mean",
  ];
  if (junkPhrases.some((p) => t.includes(p))) return true;

  return false;
}

function scoreSentence(s: string) {
  const t = normalize(s);

  let score = 0;

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
    // accusation / state verbs — common in live debate claims
    " lies ",
    " misleads ",
    " manipulates ",
    " cheats ",
    " exploits ",
    " violates ",
    " breaks ",
  ];
  if (verbs.some((v) => t.includes(v))) score += 2;

  const absolutes = [" always ", " never ", " everyone ", " no one ", " cannot ", " can't "];
  if (absolutes.some((a) => t.includes(a))) score += 1;

  if (/\b\d+([.,]\d+)?\b/.test(s)) score += 2;

  const comps = [" highest ", " lowest ", " record ", " most ", " least ", " bigger ", " smaller "];
  if (comps.some((c) => t.includes(c))) score += 1;

  if (t.includes("according to") || t.includes("data shows") || t.includes("report says")) {
    score += 2;
  }

  if (t.length > 180) score -= 1;

  // Strong causal/evidential verbs are an extra signal on top of the generic
  // verb bucket above — a sentence whose core verb is directly causal or
  // evidential is more likely to be a verifiable claim.
  const strongVerbs = [" cause ", " causes ", " caused ", " proves ", " prove ", " disproves ", " disprove "];
  if (strongVerbs.some((v) => t.includes(v))) score += 1;

  // Words that name a contestable factual assertion regardless of sentence length.
  const claimWords = new Set(["fake", "hoax", "debunked", "disproven", "lied", "fabricated"]);
  if (t.split(/\s+/).some((w) => claimWords.has(w))) score += 1;

  // Targeted +1 for specific negation constructions that signal a testable
  // factual claim ("vaccines are not safe", "this does not cause cancer").
  // Includes both written-out forms and normalized contractions (apostrophe
  // stripped to space by normalize()). Generic " not " alone is not included.
  const negationPatterns = [
    " is not ", " are not ", " was not ", " were not ",
    " do not ", " does not ", " did not ",
    " isn t ",  // isn't
    " aren t ", // aren't
    " wasn t ", // wasn't
    " weren t ", // weren't
    " don t ",  // don't
    " doesn t ", // doesn't
    " didn t ", // didn't
    " can t ",  // can't
  ];
  if (negationPatterns.some((n) => t.includes(n))) score += 1;

  return score;
}

function looksLikeClaim(sentence: string) {
  if (isJunkSentence(sentence)) return false;
  const t = normalize(sentence);
  const score = scoreSentence(sentence);
  // Short sentences (15–21 chars) need a stronger signal to be admitted —
  // they bypass the length gate in isJunkSentence but can still be weak filler.
  if (t.length < 22) return score >= 3;
  return score >= 2;
}

export function claimFingerprint(text: string) {
  return getClaimFingerprint(text);
}

export function extractClaimsFromLine(text: string, ts: number): Claim[] {
  const sentences = splitSentences(text);

  const candidates = sentences
    .map((s) => {
      const stripped = stripFillerPrefix(s);
      return { s: stripped, score: scoreSentence(stripped) };
    })
    .filter((x) => looksLikeClaim(x.s))
    .sort((a, b) => b.score - a.score);

  const top = candidates.slice(0, 2);

  return top.map(({ s }) => ({
    id: `${ts}-${Math.random().toString(16).slice(2)}`,
    text: s.trim(),
    ts,
    status: "queued",
  }));
}