import { type SavedClaimCard } from "./savedCard";

export type ClaimNode = {
  claimId: string;
  familyId: string;
  derivedFromClaimId: string | null;
  text: string;
  stance: "supported" | "contradicted" | "unclear" | null;
  savedAt: number;
};

export type ClaimGraph = {
  hydrate(cards: SavedClaimCard[]): void;
  addNode(card: SavedClaimCard): void;
  removeNode(claimId: string): void;
  getFamily(familyId: string): ClaimNode[];
  getRoot(familyId: string): ClaimNode | null;
  getChildren(claimId: string): ClaimNode[];
  getClashPairs(familyId: string): Array<[ClaimNode, ClaimNode]>;
  getAllFamilyIds(): string[];
  hasNode(claimId: string): boolean;
  knowsFamily(familyId: string): boolean;
  getFamilyRepresentativeText(familyId: string): string | null;
};

function toNode(card: SavedClaimCard): ClaimNode | null {
  if (!card.familyId) return null;
  return {
    claimId: card.claimId,
    familyId: card.familyId,
    derivedFromClaimId: card.derivedFromClaimId ?? null,
    text: card.text,
    stance: card.stance ?? null,
    savedAt: card.savedAt,
  };
}

function rootFirstThenSavedAt(a: ClaimNode, b: ClaimNode): number {
  const aIsRoot = a.derivedFromClaimId ? 1 : 0;
  const bIsRoot = b.derivedFromClaimId ? 1 : 0;
  if (aIsRoot !== bIsRoot) return aIsRoot - bIsRoot;
  return a.savedAt - b.savedAt;
}

export function createClaimGraph(initialCards: SavedClaimCard[] = []): ClaimGraph {
  const nodeById      = new Map<string, ClaimNode>(); // claimId       → node
  const familyIndex   = new Map<string, string[]>();  // familyId      → claimId[]
  const childrenIndex = new Map<string, string[]>();  // parentClaimId → claimId[]

  function insertNode(node: ClaimNode): void {
    nodeById.set(node.claimId, node);

    const family = familyIndex.get(node.familyId) ?? [];
    if (!family.includes(node.claimId)) {
      family.push(node.claimId);
      familyIndex.set(node.familyId, family);
    }

    if (node.derivedFromClaimId) {
      const siblings = childrenIndex.get(node.derivedFromClaimId) ?? [];
      if (!siblings.includes(node.claimId)) {
        siblings.push(node.claimId);
        childrenIndex.set(node.derivedFromClaimId, siblings);
      }
    }
  }

  function deleteNode(claimId: string): void {
    const node = nodeById.get(claimId);
    if (!node) return;

    nodeById.delete(claimId);

    const family = familyIndex.get(node.familyId);
    if (family) {
      const next = family.filter((id) => id !== claimId);
      if (next.length === 0) familyIndex.delete(node.familyId);
      else familyIndex.set(node.familyId, next);
    }

    if (node.derivedFromClaimId) {
      const siblings = childrenIndex.get(node.derivedFromClaimId);
      if (siblings) {
        const next = siblings.filter((id) => id !== claimId);
        if (next.length === 0) childrenIndex.delete(node.derivedFromClaimId);
        else childrenIndex.set(node.derivedFromClaimId, next);
      }
    }

    // Remove this node's children-index entry so its children don't dangle.
    childrenIndex.delete(claimId);
  }

  for (const card of initialCards) {
    const node = toNode(card);
    if (node) insertNode(node);
  }

  function hydrate(cards: SavedClaimCard[]): void {
    nodeById.clear();
    familyIndex.clear();
    childrenIndex.clear();
    for (const card of cards) {
      const node = toNode(card);
      if (node) insertNode(node);
    }
  }

  function addNode(card: SavedClaimCard): void {
    const node = toNode(card);
    if (!node) return;
    deleteNode(node.claimId);
    insertNode(node);
  }

  function removeNode(claimId: string): void {
    deleteNode(claimId);
  }

  function getFamily(familyId: string): ClaimNode[] {
    const ids = familyIndex.get(familyId) ?? [];
    return ids
      .map((id) => nodeById.get(id))
      .filter((n): n is ClaimNode => n !== undefined)
      .sort(rootFirstThenSavedAt);
  }

  function getRoot(familyId: string): ClaimNode | null {
    return getFamily(familyId).find((n) => !n.derivedFromClaimId) ?? null;
  }

  function getChildren(claimId: string): ClaimNode[] {
    const ids = childrenIndex.get(claimId) ?? [];
    return ids
      .map((id) => nodeById.get(id))
      .filter((n): n is ClaimNode => n !== undefined);
  }

  function getClashPairs(familyId: string): Array<[ClaimNode, ClaimNode]> {
    const members      = getFamily(familyId);
    const supported    = members.filter((n) => n.stance === "supported");
    const contradicted = members.filter((n) => n.stance === "contradicted");
    if (!supported.length || !contradicted.length) return [];
    const pairs: Array<[ClaimNode, ClaimNode]> = [];
    for (const s of supported) {
      for (const c of contradicted) {
        pairs.push([s, c]);
      }
    }
    return pairs;
  }

  function getAllFamilyIds(): string[] {
    return Array.from(familyIndex.keys());
  }

  function hasNode(claimId: string): boolean {
    return nodeById.has(claimId);
  }

  function knowsFamily(familyId: string): boolean {
    return familyIndex.has(familyId);
  }

  function getFamilyRepresentativeText(familyId: string): string | null {
    return getRoot(familyId)?.text ?? getFamily(familyId)[0]?.text ?? null;
  }

  return {
    hydrate,
    addNode,
    removeNode,
    getFamily,
    getRoot,
    getChildren,
    getClashPairs,
    getAllFamilyIds,
    hasNode,
    knowsFamily,
    getFamilyRepresentativeText,
  };
}
