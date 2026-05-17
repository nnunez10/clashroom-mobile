// lib/clashbot/providers/serpapi.ts
//
// SerpAPI Google Search provider — returns real-time Google Search results.
// Used for high-recency temporal claims where Tavily hasn't returned usable
// matches, giving ClashBot access to the same results users see on Google.
//
// API reference: https://serpapi.com/search-api
// Engine: google  |  endpoint: https://serpapi.com/search.json

import Constants from "expo-constants";
import type { FactCheckMatch, VerificationResult } from "../types";

function getApiKey(): string {
  const key = (Constants.expoConfig?.extra as any)?.SERPAPI_KEY || "";
  return String(key || "").trim();
}

function safeString(x: any): string {
  return typeof x === "string" ? x : "";
}

function toISODate(value?: string): string | undefined {
  const v = safeString(value);
  if (!v) return undefined;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString();
}

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

export async function serpApiSearch(
  query: string,
  opts?: { num?: number }
): Promise<VerificationResult> {
  const apiKey = getApiKey();
  console.log(`[SerpAPI] keyPresent=${!!apiKey} valuePrefix=${apiKey ? apiKey.slice(0, 6) + "..." : "none"}`); // [DEBUG]
  if (!apiKey) {
    return { status: "error", matches: [], message: "Missing SERPAPI_KEY." };
  }

  const q = safeString(query).trim().slice(0, 400);
  if (!q) return { status: "no_match", matches: [] };
  console.log(`[SerpAPI] query="${q}"`); // [DEBUG]

  const num = Math.max(1, Math.min(opts?.num ?? 5, 10));

  const params = new URLSearchParams({
    engine: "google",
    q,
    num: String(num),
    api_key: apiKey,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`,
      { signal: controller.signal }
    );

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "error",
        matches: [],
        message: `SerpAPI error (${res.status}): ${text || "Unknown error"}`,
      };
    }

    const data = await res.json().catch(() => null);

    // SerpAPI returns organic results in `organic_results`.
    const results: any[] = Array.isArray(data?.organic_results)
      ? data.organic_results
      : [];
    console.log(`[SerpAPI] resultCount=${results.length}`); // [DEBUG]

    if (!results.length) {
      return { status: "no_match", matches: [], message: "No SerpAPI results found." };
    }

    const seenUrls = new Set<string>();

    const matches: FactCheckMatch[] = results
      .map((r: any) => {
        const url = safeString(r?.link);
        if (!url) return null;
        if (seenUrls.has(url)) return null;
        seenUrls.add(url);

        const title = safeString(r?.title) || undefined;
        const snippet = safeString(r?.snippet)
          ? safeString(r.snippet).slice(0, 300)
          : undefined;

        // `date` is present on news-style results; `rich_snippet.top.detected_extensions.date`
        // appears on some structured results. Try both.
        const rawDate =
          safeString(r?.date) ||
          safeString(r?.rich_snippet?.top?.detected_extensions?.date);
        const claimDate = toISODate(rawDate);

        // `source` is available on news results; fall back to domain extraction.
        const publisher =
          safeString(r?.source) || domainFromUrl(url) || undefined;

        return {
          provider: "serpapi",
          claim: q,
          claimDate,
          url,
          publisher,
          title,
          snippet,
          rating: { text: "Current coverage", raw: "Current coverage" },
          // Store Google's organic position so scoreMatchForClaim can use it
          // as a relevance signal (position 1 = most relevant per Google).
          serpApiPosition: typeof r?.position === "number" ? r.position : undefined,
        } as FactCheckMatch;
      })
      .filter(Boolean) as FactCheckMatch[];

    if (!matches.length) {
      return { status: "no_match", matches: [], message: "No usable SerpAPI results." };
    }

    return {
      status: "matched",
      matches,
      top: matches[0],
      mode: "recent_coverage",
    };
  } catch (e: any) {
    clearTimeout(timer);
    const msg =
      e?.name === "AbortError" ? "Request timed out" : e?.message || "Network error";
    return { status: "error", matches: [], message: msg };
  }
}
