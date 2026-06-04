// lib/clashbot/challengeEngine.ts
//
// Pure helpers for user-targeted challenge lifecycle.
// No React. No rewards/losses — those stay in behaviorEngine.ts.

type ChallengeTarget = {
  authorId?: string;
  pendingResponse?: boolean;
  responseDeadline?: number;
  challengedBy?: {
    userId: string;
    userName: string;
    at: number;
    message?: string;
  } | null;
};

type Challenger = {
  userId: string;
  userName: string;
  message?: string;
};

export function canChallengeClaim(claim: ChallengeTarget, challenger: Challenger): boolean {
  if (claim.pendingResponse) return false;
  if (claim.authorId && claim.authorId === challenger.userId) return false;
  return true;
}

export function issueChallengeOnClaim<T extends ChallengeTarget>(
  claim: T,
  challenger: Challenger,
  responseWindowMs: number,
  now = Date.now()
): T {
  return {
    ...claim,
    pendingResponse: true,
    responseDeadline: now + responseWindowMs,
    challengedBy: {
      userId: challenger.userId,
      userName: challenger.userName,
      at: now,
      ...(challenger.message !== undefined ? { message: challenger.message } : {}),
    },
  };
}

export function resolveChallengeDefense<T extends ChallengeTarget>(claim: T): T {
  return {
    ...claim,
    pendingResponse: false,
    responseDeadline: undefined,
  };
}

export type ChallengeStatus =
  | "unchallenged"
  | "challenged"
  | "defended"
  | "expired";

export function getChallengeStatus(claim: ChallengeTarget, now = Date.now()): ChallengeStatus {
  if (!claim.challengedBy) return "unchallenged";

  if (claim.responseDeadline !== undefined && now > claim.responseDeadline) return "expired";

  if (!claim.pendingResponse) return "defended";

  return "challenged";
}
