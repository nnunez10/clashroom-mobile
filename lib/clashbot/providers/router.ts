// lib/clashbot/providers/router.ts

import type { VerificationResult } from "../types";
import { bingNewsSearch } from "./bingnews";
import { googleFactCheckSearch } from "./googleFactCheck";
import { newsApiSearch } from "./newsapi";

function hasMatches(result: VerificationResult) {
  return Array.isArray(result.matches) && result.matches.length > 0;
}

function getMessage(result: VerificationResult) {
  return "message" in result ? result.message || "" : "";
}

export async function routeVerification(text: string): Promise<VerificationResult> {
  let google: VerificationResult = { status: "no_match", matches: [] };
  let bing: VerificationResult = { status: "no_match", matches: [] };
  let news: VerificationResult = { status: "no_match", matches: [] };

  // 1) Formal fact checks first
  try {
    google = await googleFactCheckSearch(text);

    if (google.status === "matched" && hasMatches(google)) {
      return {
        status: "matched",
        matches: google.matches,
        top: google.top ?? google.matches[0],
        mode: google.mode ?? "fact_check",
      };
    }
  } catch (err: any) {
    google = {
      status: "error",
      matches: [],
      message: err?.message || "Google Fact Check provider failure.",
    };
  }

  // 2) Fresh recent coverage from Bing
  try {
    bing = await bingNewsSearch(text, { maxResults: 5, freshnessDays: 7 });

    if (bing.status === "matched" && hasMatches(bing)) {
      return {
        status: "matched",
        matches: bing.matches,
        top: bing.top ?? bing.matches[0],
        mode: "recent_coverage",
      };
    }
  } catch (err: any) {
    bing = {
      status: "error",
      matches: [],
      message: err?.message || "Bing News provider failure.",
    };
  }

  // 3) Backup freshness provider
  try {
    news = await newsApiSearch(text);

    if (news.status === "matched" && hasMatches(news)) {
      return {
        status: "matched",
        matches: news.matches,
        top: news.top ?? news.matches[0],
        mode: "recent_coverage",
      };
    }
  } catch (err: any) {
    news = {
      status: "error",
      matches: [],
      message: err?.message || "NewsAPI provider failure.",
    };
  }

  const allErrored =
    google.status === "error" &&
    bing.status === "error" &&
    news.status === "error";

  if (allErrored) {
    return {
      status: "error",
      matches: [],
      message:
        getMessage(google) ||
        getMessage(bing) ||
        getMessage(news) ||
        "All verification providers failed.",
    };
  }

  const noMatchMessages = [
    google.status === "no_match" ? getMessage(google) : "",
    bing.status === "no_match" ? getMessage(bing) : "",
    news.status === "no_match" ? getMessage(news) : "",
  ].filter(Boolean);

  return {
    status: "no_match",
    matches: [],
    message: noMatchMessages[0] || "No matching fact check or recent coverage found.",
  };
}