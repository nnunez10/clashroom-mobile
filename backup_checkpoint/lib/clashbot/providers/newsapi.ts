// lib/clashbot/providers/newsapi.ts

import Constants from "expo-constants";
import type { FactCheckMatch, VerificationResult } from "../types";

function getNewsApiKey() {
  const key = (Constants.expoConfig?.extra as any)?.NEWS_API_KEY || "";
  return String(key || "").trim();
}

function safeString(x: any) {
  return typeof x === "string" ? x : "";
}

function normalizeQuery(q: string) {
  return safeString(q).trim().slice(0, 200);
}

/**
 * NewsAPI fallback:
 * - Returns "matched" when it finds articles
 * - These are NOT verdict-style fact checks, but "current coverage"
 * - We map articles into FactCheckMatch objects to reuse your UI
 */
export async function newsApiSearch(query: string): Promise<VerificationResult> {
  const apiKey = getNewsApiKey();

  if (!apiKey) {
    return {
      status: "error",
      matches: [],
      message: "Missing NEWS_API_KEY.",
    };
  }

  const q = normalizeQuery(query);
  if (!q) return { status: "no_match", matches: [] };

  // "everything" is usually better for current coverage than "top-headlines"
  // We'll sort by publishedAt for recency.
  const endpoint = new URL("https://newsapi.org/v2/everything");
  endpoint.searchParams.set("q", q);
  endpoint.searchParams.set("sortBy", "publishedAt");
  endpoint.searchParams.set("pageSize", "5");
  endpoint.searchParams.set("language", "en");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
      },
      signal: controller.signal,
    });

    clearTimeout(t);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "error",
        matches: [],
        message: `NewsAPI error (${res.status}): ${text || "Unknown error"}`,
      };
    }

    const data = await res.json().catch(() => null);

    const articles = Array.isArray((data as any)?.articles) ? (data as any).articles : [];
    if (!articles.length) return { status: "no_match", matches: [] };

    const matches: FactCheckMatch[] = articles
      .map((a: any) => {
        const url = safeString(a?.url);
        if (!url) return null;

        const sourceName = safeString(a?.source?.name) || "News";
        const title = safeString(a?.title) || undefined;
        const publishedAt = safeString(a?.publishedAt) || undefined;

        return {
          provider: "newsapi",
          claim: q,
          claimDate: publishedAt,
          url,
          publisher: sourceName,
          title,
          // No verdict from NewsAPI, but we can show a "recency" label in rating
          rating: { text: "Current coverage", raw: "Current coverage" },
        } as FactCheckMatch;
      })
      .filter(Boolean) as FactCheckMatch[];

    if (!matches.length) return { status: "no_match", matches: [] };

    return { status: "matched", matches, top: matches[0] };
  } catch (e: any) {
    clearTimeout(t);

    const msg =
      e?.name === "AbortError"
        ? "Request timed out"
        : e?.message || "Network error";

    return {
      status: "error",
      matches: [],
      message: msg,
    };
  }
}