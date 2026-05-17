// lib/clashbot/normalizeClaim.ts
//
// Thin re-export shim so callers can import normalizeClaimText and
// getClaimFingerprint from a dedicated module without duplicating logic.
// The canonical implementations live in claimDna.ts.

export { normalizeClaimText, getClaimFingerprint } from "./claimDna";
