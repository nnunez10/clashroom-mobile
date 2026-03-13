import type { ClaimStatus, Stance } from "@/lib/claim/types";

export type { ClaimStatus, Stance };

export type StatusStyleKey =
  | "statusMatched"
  | "statusDisputed"
  | "statusUnconfirmed"
  | "statusChecking"
  | "statusNoMatch"
  | "statusError"
  | "statusQueued";

export type StatusPresentation = {
  label: string;
  styleKey: StatusStyleKey;
};

/**
 * Maps (status, stance) → { label, styleKey }.
 *
 * Stance outranks status for matched/disputed terminal states:
 *   - contradicted → fails closed  ("Contradicted" / statusDisputed)
 *   - unclear      → "Unconfirmed" / statusUnconfirmed
 *   - supported    → falls through to status label ("Matched" / "Disputed")
 *
 * Transient states (checking, queued) and no-result states (no_match, error)
 * are stance-immune — they represent pipeline position, not verdict.
 */
export function getStatusPresentation(
  status?: ClaimStatus,
  stance?: Stance,
): StatusPresentation {
  if (status === "matched" || status === "disputed") {
    if (stance === "contradicted") return { label: "Contradicted", styleKey: "statusDisputed" };
    if (stance === "unclear")      return { label: "Unconfirmed",  styleKey: "statusUnconfirmed" };
    // stance === "supported" or undefined: fall through to status label
  }

  switch (status) {
    case "checking": return { label: "Checking",  styleKey: "statusChecking" };
    case "matched":  return { label: "Matched",   styleKey: "statusMatched" };
    case "disputed": return { label: "Disputed",  styleKey: "statusDisputed" };
    case "no_match": return { label: "No Match",  styleKey: "statusNoMatch" };
    case "error":    return { label: "Error",     styleKey: "statusError" };
    case "queued":   return { label: "Queued",    styleKey: "statusQueued" };
    default:         return { label: "Unknown",   styleKey: "statusQueued" };
  }
}
