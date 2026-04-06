// lib/clashbot/providers/tavily.ts
//
// Tavily Search provider — semantic real-time web search optimised for news.
// Used for temporal/current-event claims where keyword-based providers
// (Bing, NewsAPI) may miss loosely phrased or rapidly evolving stories.
//
// API reference: https://docs.tavily.com/docs/tavily-api/rest_api
// topic: "news" restricts results to news sources and enables the `days` param.

import Constants from "expo-constants";
import type { FactCheckMatch, VerificationResult } from "../types";

function getApiKey(): string {
  const key = (Constants.expoConfig?.extra as any)?.TAVILY_API_KEY || "";
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

export async function tavilySearch(
  query: string,
  opts?: { days?: number; maxResults?: number }
): Promise<VerificationResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { status: "error", matches: [], message: "Missing TAVILY_API_KEY." };
  }

  const q = safeString(query).trim().slice(0, 400);
  if (!q) return { status: "no_match", matches: [] };

  const maxResults = Math.max(1, Math.min(opts?.maxResults ?? 5, 10));
  const days = opts?.days ?? 7;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: q,
        topic: "news",
        days,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "error",
        matches: [],
        message: `Tavily error (${res.status}): ${text || "Unknown error"}`,
      };
    }

    const data = await res.json().catch(() => null);
    const results: any[] = Array.isArray(data?.results) ? data.results : [];

    if (!results.length) {
      return { status: "no_match", matches: [], message: "No Tavily results found." };
    }

    const seenUrls = new Set<string>();

    const matches: FactCheckMatch[] = results
      .map((r: any) => {
        const url = safeString(r?.url);
        if (!url) return null;
        if (seenUrls.has(url)) return null;
        seenUrls.add(url);

        const title = safeString(r?.title) || undefined;
        // Tavily `content` is a snippet extracted from the page body.
        // Trim to 300 chars so the downstream UI stays manageable.
        const content = safeString(r?.content);
        const snippet = content ? content.slice(0, 300) : undefined;
        const publishedDate = toISODate(r?.published_date);
        // `source` is the site name when available; fall back to domain.
        const publisher = safeString(r?.source) || domainFromUrl(url);

        return {
          provider: "tavily",
          claim: q,
          claimDate: publishedDate,
          url,
          publisher: publisher || undefined,
          title,
          snippet,
          rating: { text: "Current coverage", raw: "Current coverage" },
        } as FactCheckMatch;
      })
      .filter(Boolean) as FactCheckMatch[];

    if (!matches.length) {
      return { status: "no_match", matches: [], message: "No usable Tavily results." };
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
