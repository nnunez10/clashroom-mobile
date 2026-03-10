// lib/clashbot/providers/bingNews.ts

import Constants from "expo-constants";
import type { FactCheckMatch, VerificationResult } from "../types";

function getBingKey() {
  const key = (Constants.expoConfig?.extra as any)?.BING_NEWS_API_KEY || "";
  return String(key || "").trim();
}

function safeString(x: any) {
  return typeof x === "string" ? x : "";
}

function clampQuery(q: string) {
  const s = safeString(q).trim();
  if (s.length <= 180) return s;
  return s.slice(0, 180);
}

function toISODate(value?: string) {
  const v = safeString(value);
  if (!v) return "";
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toISOString();
}

// Tight whitelist so users do not get lost in junk results.
const ALLOWED_HOSTS = [
  "reuters.com",
  "apnews.com",
  "bbc.co.uk",
  "bbc.com",
  "theguardian.com",
  "nytimes.com",
  "washingtonpost.com",
  "wsj.com",
  "npr.org",
  "cbsnews.com",
  "nbcnews.com",
  "abcnews.go.com",
  "cnn.com",
  "foxnews.com",
  "usatoday.com",
  "time.com",
  "economist.com",
  "ft.com",
  "bloomberg.com",
];

function hostFromUrl(url: string) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isAllowedHost(url: string) {
  const host = hostFromUrl(url);
  if (!host) return false;
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export async function bingNewsSearch(
  query: string,
  opts?: { maxResults?: number; freshnessDays?: number }
): Promise<VerificationResult> {
  const key = getBingKey();
  if (!key) {
    return { status: "error", matches: [], message: "Missing BING_NEWS_API_KEY." };
  }

  const q = clampQuery(query);
  if (!q) return { status: "no_match", matches: [] };

  const maxResults = Math.max(1, Math.min(opts?.maxResults ?? 8, 10));

  const endpoint = new URL("https://api.bing.microsoft.com/v7.0/news/search");
  endpoint.searchParams.set("q", q);
  endpoint.searchParams.set("count", String(maxResults));
  endpoint.searchParams.set("mkt", "en-US");
  endpoint.searchParams.set("safeSearch", "Moderate");
  endpoint.searchParams.set("sortBy", "Date");

  const freshnessDays = opts?.freshnessDays ?? 14;
  const freshness = freshnessDays <= 1 ? "Day" : freshnessDays <= 7 ? "Week" : "Month";
  endpoint.searchParams.set("freshness", freshness);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(endpoint.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: { "Ocp-Apim-Subscription-Key": key },
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "error",
        matches: [],
        message: `Bing error (${res.status}): ${text || "Unknown error"}`,
      };
    }

    const data = await res.json().catch(() => null);
    const items = Array.isArray((data as any)?.value) ? (data as any).value : [];

    const matches: FactCheckMatch[] = [];

    for (const it of items) {
      const url = safeString(it?.url);
      if (!url) continue;
      if (!isAllowedHost(url)) continue;

      const title = safeString(it?.name) || undefined;
      const snippet = safeString(it?.description) || undefined;
      const datePublished = safeString(it?.datePublished);

      const publisher =
        safeString(it?.provider?.[0]?.name) || hostFromUrl(url) || undefined;

      matches.push({
        provider: "bing_news",
        claim: q,
        url,
        publisher,
        title,
        snippet,
        claimDate: toISODate(datePublished) || undefined,
      });
    }

    if (!matches.length) return { status: "no_match", matches: [] };

    const top = matches.slice(0, 3);

    return {
      status: "matched",
      matches: top,
      top: top[0],
      mode: "recent_coverage",
    };
  } catch (e: any) {
    clearTimeout(timer);
    const msg =
      e?.name === "AbortError" ? "Request timed out" : e?.message || "Network error";
    return { status: "error", matches: [], message: msg };
  }
}