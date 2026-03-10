// lib/clashbot/providers/googleFactCheck.ts

import Constants from "expo-constants";
import type { FactCheckMatch, VerificationResult } from "../types";

function getApiKey() {
  const key = (Constants.expoConfig?.extra as any)?.FACTCHECK_GOOGLE_API_KEY || "";
  return String(key || "").trim();
}

function safeString(x: any) {
  return typeof x === "string" ? x : "";
}

export async function googleFactCheckSearch(query: string): Promise<VerificationResult> {
  const apiKey = getApiKey();

  if (!apiKey) {
    return { status: "error", matches: [], message: "Missing FACTCHECK_GOOGLE_API_KEY." };
  }

  const q = safeString(query).trim();
  if (!q) return { status: "no_match", matches: [] };

  const endpoint = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
  endpoint.searchParams.set("query", q);
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("pageSize", "5");
  endpoint.searchParams.set("languageCode", "en-US");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(endpoint.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "error",
        matches: [],
        message: `API error (${res.status}): ${text || "Unknown error"}`,
      };
    }

    const data = await res.json().catch(() => null);
    const matches: FactCheckMatch[] = [];
    const claims = Array.isArray((data as any)?.claims) ? (data as any).claims : [];

    for (const c of claims) {
      const claimText = safeString(c?.text) || q;
      const claimDate = safeString(c?.claimDate) || undefined;
      const reviews = Array.isArray(c?.claimReview) ? c.claimReview : [];

      for (const r of reviews) {
        const url = safeString(r?.url);
        if (!url) continue;

        const publisher = safeString(r?.publisher?.name) || undefined;
        const title = safeString(r?.title) || undefined;
        const textualRating = safeString(r?.textualRating) || "";

        matches.push({
          provider: "google_factcheck",
          claim: claimText,
          claimDate,
          url,
          publisher,
          title,
          rating: textualRating ? { text: textualRating, raw: textualRating } : undefined,
        });
      }
    }

    if (!matches.length) return { status: "no_match", matches: [] };

    return { status: "matched", matches, top: matches[0], mode: "fact_check" };
  } catch (e: any) {
    clearTimeout(timer);
    const msg =
      e?.name === "AbortError" ? "Request timed out" : e?.message || "Network error";
    return { status: "error", matches: [], message: msg };
  }
}