// lib/clashbot/verify.ts

import { googleFactCheckSearch } from "./providers/googleFactCheck";
import { newsApiSearch } from "./providers/newsapi";
import type { VerificationResult } from "./types";

function isMatched(result: VerificationResult) {
  return result.status === "matched" && Array.isArray(result.matches) && result.matches.length > 0;
}

export async function verifyClaimText(claimText: string): Promise<VerificationResult> {
  // 1) First: Google Fact Check Tools (structured fact-checks)
  const fc = await googleFactCheckSearch(claimText);
  if (isMatched(fc)) return fc;

  // 2) Fallback: NewsAPI (more current coverage, even if not "fact-check verdicts")
  const news = await newsApiSearch(claimText);
  if (isMatched(news)) return news;

  // If neither matched, return the best "no_match" result
  if (fc.status === "error") return fc;
  if (news.status === "error") return news;

  return { status: "no_match", matches: [] };
}