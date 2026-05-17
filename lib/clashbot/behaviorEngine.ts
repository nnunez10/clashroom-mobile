// lib/clashbot/behaviorEngine.ts
//
// Pure helper functions for ClashCred, streak, and recovery logic.
// No React — safe to test in isolation.

export function applyLoss(prevCred: number): number {
  return Math.max(prevCred - 4, 0);
}

export function applyRecovery(prevCred: number): number {
  return Math.min(prevCred + 2, 100);
}

export function shouldIncrementStreak({
  pendingResponse,
  clashLost,
  alreadyHandled,
}: {
  pendingResponse: boolean;
  clashLost: boolean;
  alreadyHandled: boolean;
}): boolean {
  return pendingResponse && !clashLost && !alreadyHandled;
}

export function shouldApplyRecovery({
  recoveryMode,
  pendingResponse,
  clashLost,
}: {
  recoveryMode: boolean;
  pendingResponse: boolean;
  clashLost: boolean;
}): boolean {
  return recoveryMode && pendingResponse && !clashLost;
}
