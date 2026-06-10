import { createClaimGraph } from "../claimGraph";
import type { SavedClaimCard } from "../savedCard";

function makeCard(overrides: {
  claimId: string;
  familyId?: string;
  derivedFromClaimId?: string | null;
  text?: string;
  savedAt?: number;
  stance?: SavedClaimCard["stance"];
  status?: SavedClaimCard["status"];
}): SavedClaimCard {
  return {
    schemaVersion: 1,
    id: overrides.claimId,
    claimId: overrides.claimId,
    text: overrides.text ?? "default claim text",
    savedAt: overrides.savedAt ?? 1000,
    status: overrides.status ?? "matched",
    familyId: overrides.familyId,
    derivedFromClaimId: overrides.derivedFromClaimId,
    stance: overrides.stance,
  };
}

describe("createClaimGraph", () => {
  // ─── hydrate ──────────────────────────────────────────────────────────────

  describe("hydrate", () => {
    it("builds family index from cards that have familyId", () => {
      const g = createClaimGraph();
      g.hydrate([
        makeCard({ claimId: "c1", familyId: "f1" }),
        makeCard({ claimId: "c2", familyId: "f1" }),
        makeCard({ claimId: "c3", familyId: "f2" }),
      ]);
      expect(g.getFamily("f1")).toHaveLength(2);
      expect(g.knowsFamily("f1")).toBe(true);
      expect(g.knowsFamily("f2")).toBe(true);
    });

    it("ignores cards without familyId", () => {
      const g = createClaimGraph();
      g.hydrate([
        makeCard({ claimId: "c1" }),
        makeCard({ claimId: "c2", familyId: undefined }),
      ]);
      expect(g.getAllFamilyIds()).toHaveLength(0);
      expect(g.hasNode("c1")).toBe(false);
      expect(g.hasNode("c2")).toBe(false);
    });

    it("replaces all existing state on re-hydrate", () => {
      const g = createClaimGraph();
      g.hydrate([makeCard({ claimId: "c1", familyId: "f1" })]);
      g.hydrate([makeCard({ claimId: "c2", familyId: "f2" })]);
      expect(g.hasNode("c1")).toBe(false);
      expect(g.hasNode("c2")).toBe(true);
      expect(g.getAllFamilyIds()).toEqual(["f2"]);
    });
  });

  // ─── getRoot ──────────────────────────────────────────────────────────────

  describe("getRoot", () => {
    it("returns the node with derivedFromClaimId null", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1", derivedFromClaimId: null }),
        makeCard({ claimId: "c2", familyId: "f1", derivedFromClaimId: "c1" }),
      ]);
      const root = g.getRoot("f1");
      expect(root?.claimId).toBe("c1");
      expect(root?.derivedFromClaimId).toBeNull();
    });

    it("returns null when all nodes are derived", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1", derivedFromClaimId: "ghost" }),
        makeCard({ claimId: "c2", familyId: "f1", derivedFromClaimId: "ghost" }),
      ]);
      expect(g.getRoot("f1")).toBeNull();
    });

    it("returns null for an unknown family", () => {
      expect(createClaimGraph().getRoot("nonexistent")).toBeNull();
    });
  });

  // ─── getFamilyRepresentativeText ──────────────────────────────────────────

  describe("getFamilyRepresentativeText", () => {
    it("returns root text when a root exists", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1", derivedFromClaimId: null, text: "root claim" }),
        makeCard({ claimId: "c2", familyId: "f1", derivedFromClaimId: "c1", text: "child claim" }),
      ]);
      expect(g.getFamilyRepresentativeText("f1")).toBe("root claim");
    });

    it("falls back to the earliest member by savedAt when no root exists", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1", derivedFromClaimId: "ghost", savedAt: 2000, text: "newer" }),
        makeCard({ claimId: "c2", familyId: "f1", derivedFromClaimId: "ghost", savedAt: 1000, text: "oldest" }),
      ]);
      expect(g.getRoot("f1")).toBeNull();
      expect(g.getFamilyRepresentativeText("f1")).toBe("oldest");
    });

    it("returns null for an unknown family", () => {
      expect(createClaimGraph().getFamilyRepresentativeText("nonexistent")).toBeNull();
    });
  });

  // ─── addNode ──────────────────────────────────────────────────────────────

  describe("addNode", () => {
    it("inserts a new node into the graph", () => {
      const g = createClaimGraph();
      g.addNode(makeCard({ claimId: "c1", familyId: "f1" }));
      expect(g.hasNode("c1")).toBe(true);
      expect(g.getFamily("f1")).toHaveLength(1);
    });

    it("updates an existing node without duplicating in the family index", () => {
      const g = createClaimGraph();
      g.addNode(makeCard({ claimId: "c1", familyId: "f1", text: "original" }));
      g.addNode(makeCard({ claimId: "c1", familyId: "f1", text: "updated" }));
      const family = g.getFamily("f1");
      expect(family).toHaveLength(1);
      expect(family[0].text).toBe("updated");
    });

    it("ignores cards without familyId", () => {
      const g = createClaimGraph();
      g.addNode(makeCard({ claimId: "c1" }));
      expect(g.hasNode("c1")).toBe(false);
    });
  });

  // ─── removeNode ───────────────────────────────────────────────────────────

  describe("removeNode", () => {
    it("removes a node from nodeById and the family index", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1" }),
        makeCard({ claimId: "c2", familyId: "f1" }),
      ]);
      g.removeNode("c1");
      expect(g.hasNode("c1")).toBe(false);
      expect(g.getFamily("f1")).toHaveLength(1);
      expect(g.knowsFamily("f1")).toBe(true);
    });

    it("removes the familyId entry when the last node in a family is removed", () => {
      const g = createClaimGraph([makeCard({ claimId: "c1", familyId: "f1" })]);
      g.removeNode("c1");
      expect(g.knowsFamily("f1")).toBe(false);
    });

    it("clears the childrenIndex entry so former children are not returned", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1" }),
        makeCard({ claimId: "c2", familyId: "f1", derivedFromClaimId: "c1" }),
      ]);
      g.removeNode("c1");
      expect(g.getChildren("c1")).toHaveLength(0);
    });

    it("is a no-op for an unknown claimId", () => {
      const g = createClaimGraph([makeCard({ claimId: "c1", familyId: "f1" })]);
      expect(() => g.removeNode("nonexistent")).not.toThrow();
      expect(g.hasNode("c1")).toBe(true);
    });
  });

  // ─── getChildren ──────────────────────────────────────────────────────────

  describe("getChildren", () => {
    it("returns direct children of a node", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1" }),
        makeCard({ claimId: "c2", familyId: "f1", derivedFromClaimId: "c1" }),
        makeCard({ claimId: "c3", familyId: "f1", derivedFromClaimId: "c1" }),
      ]);
      const children = g.getChildren("c1");
      expect(children).toHaveLength(2);
      expect(children.map((n) => n.claimId).sort()).toEqual(["c2", "c3"]);
    });

    it("returns [] for a leaf node", () => {
      const g = createClaimGraph([makeCard({ claimId: "c1", familyId: "f1" })]);
      expect(g.getChildren("c1")).toHaveLength(0);
    });

    it("returns [] for an unknown claimId", () => {
      expect(createClaimGraph().getChildren("nonexistent")).toHaveLength(0);
    });
  });

  // ─── getClashPairs ────────────────────────────────────────────────────────

  describe("getClashPairs", () => {
    it("returns [supported, contradicted] pairs", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1", stance: "supported" }),
        makeCard({ claimId: "c2", familyId: "f1", stance: "contradicted" }),
        makeCard({ claimId: "c3", familyId: "f1", stance: "unclear" }),
      ]);
      const pairs = g.getClashPairs("f1");
      expect(pairs).toHaveLength(1);
      expect(pairs[0][0].claimId).toBe("c1");
      expect(pairs[0][1].claimId).toBe("c2");
    });

    it("cross-products multiple supported × contradicted", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "s1", familyId: "f1", stance: "supported" }),
        makeCard({ claimId: "s2", familyId: "f1", stance: "supported" }),
        makeCard({ claimId: "c1", familyId: "f1", stance: "contradicted" }),
      ]);
      expect(g.getClashPairs("f1")).toHaveLength(2);
    });

    it("returns [] when family has only supported cards", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1", stance: "supported" }),
        makeCard({ claimId: "c2", familyId: "f1", stance: "supported" }),
      ]);
      expect(g.getClashPairs("f1")).toEqual([]);
    });

    it("returns [] when family has only contradicted cards", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1", stance: "contradicted" }),
        makeCard({ claimId: "c2", familyId: "f1", stance: "contradicted" }),
      ]);
      expect(g.getClashPairs("f1")).toEqual([]);
    });

    it("returns [] when family has no stance signal (all unclear)", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1", stance: "unclear" }),
        makeCard({ claimId: "c2", familyId: "f1", stance: "unclear" }),
      ]);
      expect(g.getClashPairs("f1")).toEqual([]);
    });

    it("returns [] for an unknown family", () => {
      expect(createClaimGraph().getClashPairs("nonexistent")).toEqual([]);
    });
  });

  // ─── getAllFamilyIds + hasNode ─────────────────────────────────────────────

  describe("getAllFamilyIds and hasNode", () => {
    it("getAllFamilyIds returns all known family IDs", () => {
      const g = createClaimGraph([
        makeCard({ claimId: "c1", familyId: "f1" }),
        makeCard({ claimId: "c2", familyId: "f2" }),
        makeCard({ claimId: "c3", familyId: "f2" }),
      ]);
      expect(g.getAllFamilyIds().sort()).toEqual(["f1", "f2"]);
    });

    it("getAllFamilyIds returns [] when the graph is empty", () => {
      expect(createClaimGraph().getAllFamilyIds()).toEqual([]);
    });

    it("hasNode returns true for a known claimId", () => {
      const g = createClaimGraph([makeCard({ claimId: "c1", familyId: "f1" })]);
      expect(g.hasNode("c1")).toBe(true);
    });

    it("hasNode returns false for an unknown claimId", () => {
      const g = createClaimGraph([makeCard({ claimId: "c1", familyId: "f1" })]);
      expect(g.hasNode("unknown")).toBe(false);
    });
  });
});
