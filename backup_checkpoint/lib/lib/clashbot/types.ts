// lib/clashbot/types.ts

export type FactCheckRating = {
  text?: string;
  raw?: string;
};

export type FactCheckMatch = {
  provider: "google_factcheck" | "bing_news" | string;

  claim: string;

  // For google_factcheck this may be claimDate.
  // For bing_news we store article published time here.
  claimDate?: string;

  url: string;

  publisher?: string;

  title?: string;

  rating?: FactCheckRating;

  snippet?: string;
};

export type VerificationResult =
  | {
      status: "matched";
      matches: FactCheckMatch[];
      top?: FactCheckMatch;
      mode?: "fact_check" | "recent_coverage";
    }
  | {
      status: "no_match";
      matches: FactCheckMatch[];
      message?: string;
    }
  | {
      status: "error";
      matches: FactCheckMatch[];
      message: string;
    };