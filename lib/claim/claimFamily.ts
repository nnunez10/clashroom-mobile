// lib/claim/claimFamily.ts
//
// Extracted verbatim from ClashBotSheet.tsx.
// Minimal upgrade to improve claim family grouping.
// No UI changes. No architecture rewrites.
// Existing exports preserved.

// ---------------------------------------------------------------------------
// Local type aliases (mirror what ClashBotSheet declared inline)
// These will be unified with lib/claim/types.ts in a later phase.
// ---------------------------------------------------------------------------

export type ClaimFamilyStatus =
  | "checking"
  | "matched"
  | "disputed"
  | "mixed"
  | "no_match"
  | "error"
  | "queued";

// Minimal shape the family functions need from a claim object.
// Deliberately loose so it works with ClashBotSheet's ClaimItem today
// and with the canonical Claim type later.
export type FamilyClaimItem = {
  id: string;
  text: string;
  status?: "queued" | "checking" | "matched" | "no_match" | "error" | "disputed";
  checkingAt?: number;
  completedAt?: number;
  timeline?: {
    queuedAt?: number;
    checkingAt?: number;
    completedAt?: number;
  };
  familyId?: string;
  derivedFromClaimId?: string | null;
  evidence?: FamilyEvidenceRecord[];
  events?: FamilyClaimEvent[];
  claimDna?: {
    normalized?: string;
    fingerprint?: string;
    familyFingerprint?: string;
    familyId?: string;
    nodeId?: string;
    meaningfulTokens?: string[];
  };
};

export type FamilyEvidenceRecord = {
  url?: string;
  title?: string;
  publisher?: string;
  kind?: string;
  ratingText?: string;
  ratingRaw?: string;
};

export type FamilyClaimEvent = {
  type?: string;
  at?: number;
  message?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ClaimFamilyView<
  C extends FamilyClaimItem = FamilyClaimItem,
  E extends FamilyEvidenceRecord = FamilyEvidenceRecord,
  V extends FamilyClaimEvent = FamilyClaimEvent,
> = {
  familyId: string;
  leadClaimId: string;
  leadClaim: C;
  claims: C[];
  totalClaims: number;
  familyStatus: ClaimFamilyStatus;
  canonicalText: string;
  allEvidence: E[];
  allEvents: V[];
  rootClaims: C[];
  derivedClaims: C[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeTimeFromNumber(value?: number | null): number {
  if (!value || Number.isNaN(value)) return 0;
  return value;
}

function getClaimCreatedTime(claim: FamilyClaimItem): number {
  return (
    safeTimeFromNumber(claim.timeline?.queuedAt) ||
    safeTimeFromNumber(claim.checkingAt) ||
    safeTimeFromNumber(claim.completedAt) ||
    0
  );
}

function sortClaimsForFamily(a: FamilyClaimItem, b: FamilyClaimItem): number {
  const aRoot = !a.derivedFromClaimId;
  const bRoot = !b.derivedFromClaimId;

  if (aRoot && !bRoot) return -1;
  if (!aRoot && bRoot) return 1;

  return getClaimCreatedTime(a) - getClaimCreatedTime(b);
}

function pickLeadClaim<C extends FamilyClaimItem>(claims: C[]): C {
  const rootClaims = claims
    .filter((claim) => !claim.derivedFromClaimId)
    .sort(sortClaimsForFamily) as C[];

  if (rootClaims.length > 0) return rootClaims[0];

  return [...claims].sort(sortClaimsForFamily)[0] as C;
}

function evidenceKey(evidence: FamilyEvidenceRecord): string {
  return [
    evidence.url ?? "",
    evidence.title ?? "",
    evidence.publisher ?? "",
    evidence.kind ?? "",
    evidence.ratingText ?? "",
    evidence.ratingRaw ?? "",
  ].join("|");
}

function dedupeEvidence<E extends FamilyEvidenceRecord>(items: E[]): E[] {
  const map = new Map<string, E>();

  for (const item of items) {
    const key = evidenceKey(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

function eventKey(event: FamilyClaimEvent): string {
  return [
    event.type ?? "",
    event.at ?? "",
    event.message ?? "",
    JSON.stringify(event.meta ?? {}),
  ].join("|");
}

function dedupeEvents<V extends FamilyClaimEvent>(events: V[]): V[] {
  const map = new Map<string, V>();

  for (const event of events) {
    const key = eventKey(event);
    if (!map.has(key)) {
      map.set(key, event);
    }
  }

  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Minimal grouping fallback helpers
// ---------------------------------------------------------------------------

const FAMILY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "may",
  "might",
  "of",
  "on",
  "or",
  "should",
  "so",
  "that",
  "the",
  "their",
  "them",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

function normalizeClaimText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFamilyToken(token: string): string {
  let next = normalizeClaimText(token);

  if (!next) return "";

  if (next.endsWith("ation") && next.length > 7) {
    next = next.slice(0, -5);
  } else if (next.endsWith("tion") && next.length > 6) {
    next = next.slice(0, -4);
  } else if (next.endsWith("ing") && next.length > 5) {
    next = next.slice(0, -3);
  } else if (next.endsWith("ed") && next.length > 4) {
    next = next.slice(0, -2);
  } else if (next.endsWith("es") && next.length > 4) {
    next = next.slice(0, -2);
  } else if (next.endsWith("s") && next.length > 3) {
    next = next.slice(0, -1);
  }

  if (next.endsWith("e") && next.length > 5) {
    next = next.slice(0, -1);
  }

  return next.trim();
}

function getMeaningfulTokens(claim: FamilyClaimItem): string[] {
  const claimDnaTokens = Array.isArray(claim.claimDna?.meaningfulTokens)
    ? claim.claimDna?.meaningfulTokens ?? []
    : [];

  const rawTokens =
    claimDnaTokens.length > 0
      ? claimDnaTokens
      : normalizeClaimText(claim.claimDna?.normalized || claim.text || "").split(" ");

  const normalizedTokens = rawTokens
    .map((token) => normalizeFamilyToken(token))
    .filter((token) => !!token && !FAMILY_STOP_WORDS.has(token));

  return Array.from(new Set(normalizedTokens));
}

function buildFamilySignature(claim: FamilyClaimItem): string {
  return getMeaningfulTokens(claim).slice().sort().join("|");
}

function claimsLikelySameFamily(a: FamilyClaimItem, b: FamilyClaimItem): boolean {
  const aNormalized = normalizeClaimText(a.claimDna?.normalized || a.text || "");
  const bNormalized = normalizeClaimText(b.claimDna?.normalized || b.text || "");

  if (!aNormalized || !bNormalized) return false;
  if (aNormalized === bNormalized) return true;

  const aSignature = buildFamilySignature(a);
  const bSignature = buildFamilySignature(b);

  if (aSignature && aSignature === bSignature) return true;

  const aTokens = getMeaningfulTokens(a);
  const bTokens = getMeaningfulTokens(b);

  if (!aTokens.length || !bTokens.length) return false;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);

  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }

  const union = new Set([...aSet, ...bSet]).size;
  if (union === 0) return false;

  const overlap = intersection / union;
  const containment = intersection / Math.min(aSet.size, bSet.size);

  if (overlap >= 0.72) return true;
  if (intersection >= 2 && containment >= 0.8) return true;

  return false;
}

function getPreferredFamilyKey(claim: FamilyClaimItem): string {
  return (
    claim.familyId ||
    claim.claimDna?.familyId ||
    claim.claimDna?.familyFingerprint ||
    buildFamilySignature(claim) ||
    claim.id
  );
}

type ClaimFamilyBucket<C extends FamilyClaimItem> = {
  familyId: string;
  claims: C[];
  representative: C;
};

function findMatchingBucket<C extends FamilyClaimItem>(
  claim: C,
  buckets: ClaimFamilyBucket<C>[]
): ClaimFamilyBucket<C> | null {
  const preferredKey = getPreferredFamilyKey(claim);

  for (const bucket of buckets) {
    if (bucket.familyId === preferredKey) return bucket;
  }

  for (const bucket of buckets) {
    if (claimsLikelySameFamily(claim, bucket.representative)) return bucket;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Exported family functions
// ---------------------------------------------------------------------------

export function getFamilyStatus(claims: FamilyClaimItem[]): ClaimFamilyStatus {
  const statuses = claims.map((claim) => claim.status ?? "queued");

  if (statuses.some((status) => status === "checking")) return "checking";

  const hasMatched = statuses.some((status) => status === "matched");
  const hasDisputed = statuses.some((status) => status === "disputed");

  if (hasMatched && hasDisputed) return "mixed";
  if (hasDisputed) return "disputed";
  if (hasMatched) return "matched";
  if (statuses.some((status) => status === "error")) return "error";
  if (statuses.some((status) => status === "no_match")) return "no_match";

  return "queued";
}

export function familyPriority(status: ClaimFamilyStatus): number {
  switch (status) {
    case "checking":
      return 1;
    case "disputed":
      return 2;
    case "mixed":
      return 3;
    case "matched":
      return 4;
    case "no_match":
      return 5;
    case "error":
      return 6;
    case "queued":
    default:
      return 7;
  }
}

export function sortFamiliesForDisplay<C extends FamilyClaimItem>(
  a: ClaimFamilyView<C>,
  b: ClaimFamilyView<C>
): number {
  const priorityDiff = familyPriority(a.familyStatus) - familyPriority(b.familyStatus);

  if (priorityDiff !== 0) return priorityDiff;

  return getClaimCreatedTime(a.leadClaim) - getClaimCreatedTime(b.leadClaim);
}

export function buildClaimFamilyViews<C extends FamilyClaimItem>(
  claims: C[]
): ClaimFamilyView<C>[] {
  const buckets: ClaimFamilyBucket<C>[] = [];
  const sortedClaims = [...claims].sort(sortClaimsForFamily) as C[];

  for (const claim of sortedClaims) {
    const existingBucket = findMatchingBucket(claim, buckets);

    if (existingBucket) {
      existingBucket.claims.push(claim);
      existingBucket.representative = pickLeadClaim(existingBucket.claims);
      continue;
    }

    buckets.push({
      familyId: getPreferredFamilyKey(claim),
      claims: [claim],
      representative: claim,
    });
  }

  const families = buckets.map(({ familyId, claims: members }) => {
    const sortedMembers = [...members].sort(sortClaimsForFamily) as C[];
    const leadClaim = pickLeadClaim(sortedMembers);

    const allEvidence = dedupeEvidence(
      sortedMembers.flatMap((claim) => claim.evidence ?? [])
    );

    const allEvents = dedupeEvents(
      sortedMembers.flatMap((claim) => claim.events ?? [])
    ).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

    const rootClaims = sortedMembers.filter((claim) => !claim.derivedFromClaimId);
    const derivedClaims = sortedMembers.filter((claim) => !!claim.derivedFromClaimId);

    return {
      familyId,
      leadClaimId: leadClaim.id,
      leadClaim,
      claims: sortedMembers,
      totalClaims: sortedMembers.length,
      familyStatus: getFamilyStatus(sortedMembers),
      canonicalText: leadClaim.text,
      allEvidence,
      allEvents,
      rootClaims,
      derivedClaims,
    } satisfies ClaimFamilyView<C>;
  });

  return families.sort(sortFamiliesForDisplay);
}

export function getFamilyStatusLabel(status: ClaimFamilyStatus): string {
  switch (status) {
    case "checking":
      return "Checking";
    case "matched":
      return "Matched";
    case "disputed":
      return "Disputed";
    case "mixed":
      return "Mixed";
    case "no_match":
      return "No Match";
    case "error":
      return "Error";
    case "queued":
    default:
      return "Queued";
  }
}

export function getFamilySummaryLine(family: ClaimFamilyView): string {
  const claimsText =
    family.totalClaims === 1 ? "1 claim" : `${family.totalClaims} related claims`;

  const sourcesText =
    family.allEvidence.length === 1 ? "1 source" : `${family.allEvidence.length} sources`;

  const rootText =
    family.rootClaims.length === 1 ? "1 root" : `${family.rootClaims.length} roots`;

  const derivedText =
    family.derivedClaims.length === 1
      ? "1 derived"
      : `${family.derivedClaims.length} derived`;

  return `${claimsText} • ${sourcesText} • ${rootText} • ${derivedText}`;
}

export function getLatestFamilyEvent(
  family: ClaimFamilyView
): FamilyClaimEvent | null {
  if (!Array.isArray(family.allEvents) || family.allEvents.length === 0) return null;
  return family.allEvents[family.allEvents.length - 1];
}