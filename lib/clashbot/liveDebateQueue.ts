// lib/clashbot/liveDebateQueue.ts

import type { Claim } from "./extractClaims";

type QueueableClaim = Claim & {
  createdAt?: number;
  status?: string;
  isClash?: boolean;
};

function hasNumbers(text: string) {
  return /\d/.test(text);
}

function hasNamedEntities(text: string) {
  const words = String(text || "").split(/\s+/);
  return words.slice(1).some((w) => /^[A-Z][a-z]+/.test(w));
}

function isWeakLanguage(text: string) {
  const weakPatterns = [
    "i think",
    "maybe",
    "probably",
    "i feel",
    "in my opinion",
  ];

  const lower = String(text || "").toLowerCase();
  return weakPatterns.some((p) => lower.includes(p));
}

function scoreClaim(claim: QueueableClaim): number {
  let score = 0;

  const text = claim.text || "";

  // Recency
  const age = Date.now() - (claim.createdAt || claim.ts || Date.now());
  const recencyScore = Math.max(0, 5000 - age) / 1000;
  score += recencyScore;

  // Specificity
  if (hasNumbers(text)) score += 2;
  if (hasNamedEntities(text)) score += 1.5;

  // Structured claim bonus
  if (text.length > 40) score += 1;

  // Weak language penalty
  if (isWeakLanguage(text)) score -= 2;

  // Clash escalation: keep active conflicts near the top
  if (claim.isClash) score += 4;

  return score;
}

export function getNextPriorityClaim<T extends QueueableClaim>(
  claims: T[]
): T | undefined {
  const queued = claims.filter((c) => c.status === "queued");

  if (!queued.length) return undefined;

  const scored = queued.map((c) => ({
    claim: c,
    score: scoreClaim(c),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.claim;
}
