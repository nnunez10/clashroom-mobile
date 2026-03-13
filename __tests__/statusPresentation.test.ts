/**
 * Matrix tests for getStatusPresentation.
 *
 * Terminology contract enforced here:
 *   "Contradicted" — fact-checker actively found the claim false (matched + contradicted stance).
 *   "Disputed"     — engine-level dispute signal (status=disputed, stance absent or supported).
 *   "Unconfirmed"  — source found but verdict ambiguous (matched or disputed + unclear stance).
 * Both "Contradicted" and "Disputed" share statusDisputed style (red-ish), different labels.
 *
 * Wire with jest + @types/jest + jest-expo when ready.
 * The module has zero React Native imports so it runs in plain Node/Jest.
 */
import { getStatusPresentation } from "@/lib/clashbot/statusPresentation";

describe("getStatusPresentation", () => {
  // ── fail-closed: contradicted stance outranks positive status ────────────
  describe("matched + contradicted fails closed", () => {
    it("matched + contradicted → Contradicted / statusDisputed", () => {
      expect(getStatusPresentation("matched", "contradicted")).toEqual({
        label: "Contradicted",
        styleKey: "statusDisputed",
      });
    });

    it("disputed + contradicted → Contradicted / statusDisputed", () => {
      expect(getStatusPresentation("disputed", "contradicted")).toEqual({
        label: "Contradicted",
        styleKey: "statusDisputed",
      });
    });
  });

  // ── unclear stance → Unconfirmed ─────────────────────────────────────────
  describe("unclear stance → Unconfirmed", () => {
    it("matched + unclear → Unconfirmed / statusUnconfirmed", () => {
      expect(getStatusPresentation("matched", "unclear")).toEqual({
        label: "Unconfirmed",
        styleKey: "statusUnconfirmed",
      });
    });

    it("disputed + unclear → Unconfirmed / statusUnconfirmed", () => {
      expect(getStatusPresentation("disputed", "unclear")).toEqual({
        label: "Unconfirmed",
        styleKey: "statusUnconfirmed",
      });
    });
  });

  // ── supported stance falls through to status label ───────────────────────
  describe("supported stance falls through", () => {
    it("matched + supported → Matched / statusMatched", () => {
      expect(getStatusPresentation("matched", "supported")).toEqual({
        label: "Matched",
        styleKey: "statusMatched",
      });
    });

    it("disputed + supported → Disputed / statusDisputed (pipeline status wins)", () => {
      expect(getStatusPresentation("disputed", "supported")).toEqual({
        label: "Disputed",
        styleKey: "statusDisputed",
      });
    });
  });

  // ── no stance: pure status pass-through ──────────────────────────────────
  describe("no stance", () => {
    it("matched + no stance → Matched / statusMatched", () => {
      expect(getStatusPresentation("matched")).toEqual({
        label: "Matched",
        styleKey: "statusMatched",
      });
    });

    it("disputed + no stance → Disputed / statusDisputed", () => {
      expect(getStatusPresentation("disputed")).toEqual({
        label: "Disputed",
        styleKey: "statusDisputed",
      });
    });
  });

  // ── transient states are stance-immune ───────────────────────────────────
  describe("transient states ignore stance", () => {
    it("checking + unclear → Checking (not Unconfirmed)", () => {
      expect(getStatusPresentation("checking", "unclear")).toEqual({
        label: "Checking",
        styleKey: "statusChecking",
      });
    });

    it("checking + contradicted → Checking (not Contradicted)", () => {
      expect(getStatusPresentation("checking", "contradicted")).toEqual({
        label: "Checking",
        styleKey: "statusChecking",
      });
    });

    it("queued + unclear → Queued (not Unconfirmed)", () => {
      expect(getStatusPresentation("queued", "unclear")).toEqual({
        label: "Queued",
        styleKey: "statusQueued",
      });
    });
  });

  // ── terminal non-match states are stance-immune ──────────────────────────
  describe("terminal non-match states ignore stance", () => {
    it("no_match + unclear → No Match (not Unconfirmed)", () => {
      expect(getStatusPresentation("no_match", "unclear")).toEqual({
        label: "No Match",
        styleKey: "statusNoMatch",
      });
    });

    it("no_match + contradicted → No Match (not Contradicted)", () => {
      expect(getStatusPresentation("no_match", "contradicted")).toEqual({
        label: "No Match",
        styleKey: "statusNoMatch",
      });
    });

    it("error + unclear → Error (not Unconfirmed)", () => {
      expect(getStatusPresentation("error", "unclear")).toEqual({
        label: "Error",
        styleKey: "statusError",
      });
    });
  });

  // ── defensive: undefined / unknown inputs ────────────────────────────────
  describe("defensive: undefined/unknown status", () => {
    it("undefined status → Unknown / statusQueued", () => {
      expect(getStatusPresentation(undefined)).toEqual({
        label: "Unknown",
        styleKey: "statusQueued",
      });
    });

    it("undefined status + unclear → Unknown (stance guard requires matched/disputed)", () => {
      expect(getStatusPresentation(undefined, "unclear")).toEqual({
        label: "Unknown",
        styleKey: "statusQueued",
      });
    });

    it("undefined status + contradicted → Unknown (not Contradicted)", () => {
      expect(getStatusPresentation(undefined, "contradicted")).toEqual({
        label: "Unknown",
        styleKey: "statusQueued",
      });
    });

    it("unknown status string cast as any → Unknown / statusQueued", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(getStatusPresentation("bogus_status" as any)).toEqual({
        label: "Unknown",
        styleKey: "statusQueued",
      });
    });
  });
});
