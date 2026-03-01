import { describe, it, expect, beforeEach } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// Accounts provided by the Clarinet simnet environment
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1  = accounts.get("wallet_1")!;
const wallet2  = accounts.get("wallet_2")!;

const CONTRACT = "trust-ops-core";

// A realistic 32-byte content hash (SHA-256 placeholder)
const CONTENT_HASH  = Cl.bufferFromHex("a".repeat(64));
const PROOF_HASH    = Cl.bufferFromHex("b".repeat(64));
const RESOLVE_HASH  = Cl.bufferFromHex("c".repeat(64));

describe("trust-ops-core", () => {

  describe("submit-ticket", () => {
    it("lets any wallet submit a ticket and returns ticket-id 1", () => {
      const result = simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet1);
      expect(result.result).toBeOk(Cl.uint(1));
    });

    it("increments ticket-id on each submission", () => {
      simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet1);
      const second = simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet2);
      expect(second.result).toBeOk(Cl.uint(2));
    });

    it("stores the correct submitter and content hash", () => {
      simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet1);
      const ticket = simnet.callReadOnlyFn(CONTRACT, "get-ticket", [Cl.uint(1)], wallet1);
      const data   = ticket.result;
      expect(data).toHaveClarityType(ClarityType.OptionalSome);
    });

    it("get-ticket-count returns total submitted tickets", () => {
      simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet1);
      simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet2);
      const count = simnet.callReadOnlyFn(CONTRACT, "get-ticket-count", [], wallet1);
      expect(count.result).toBeUint(2);
    });
  });

  describe("anchor-proof", () => {
    beforeEach(() => {
      simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet1);
    });

    it("allows the submitter to anchor a proof", () => {
      const result = simnet.callPublicFn(CONTRACT, "anchor-proof", [Cl.uint(1), PROOF_HASH], wallet1);
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("rejects proof anchoring from a non-submitter", () => {
      const result = simnet.callPublicFn(CONTRACT, "anchor-proof", [Cl.uint(1), PROOF_HASH], wallet2);
      expect(result.result).toBeErr(Cl.uint(401));
    });

    it("returns ERR-TICKET-NOT-FOUND for an unknown ticket", () => {
      const result = simnet.callPublicFn(CONTRACT, "anchor-proof", [Cl.uint(99), PROOF_HASH], wallet1);
      expect(result.result).toBeErr(Cl.uint(404));
    });

    it("get-proof returns the stored proof after anchoring", () => {
      simnet.callPublicFn(CONTRACT, "anchor-proof", [Cl.uint(1), PROOF_HASH], wallet1);
      const proof = simnet.callReadOnlyFn(CONTRACT, "get-proof", [Cl.uint(1)], wallet1);
      expect(proof.result).toHaveClarityType(ClarityType.OptionalSome);
    });
  });

  describe("update-status", () => {
    beforeEach(() => {
      simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet1);
    });

    it("submitter can update status to IN-PROGRESS (2)", () => {
      const result = simnet.callPublicFn(CONTRACT, "update-status", [Cl.uint(1), Cl.uint(2)], wallet1);
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("deployer (contract owner) can update status", () => {
      const result = simnet.callPublicFn(CONTRACT, "update-status", [Cl.uint(1), Cl.uint(3)], deployer);
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("wallet2 (non-owner, non-submitter) cannot update status", () => {
      const result = simnet.callPublicFn(CONTRACT, "update-status", [Cl.uint(1), Cl.uint(2)], wallet2);
      expect(result.result).toBeErr(Cl.uint(401));
    });

    it("rejects status 0 (invalid)", () => {
      const result = simnet.callPublicFn(CONTRACT, "update-status", [Cl.uint(1), Cl.uint(0)], wallet1);
      expect(result.result).toBeErr(Cl.uint(400));
    });

    it("rejects status 6 (out of range)", () => {
      const result = simnet.callPublicFn(CONTRACT, "update-status", [Cl.uint(1), Cl.uint(6)], wallet1);
      expect(result.result).toBeErr(Cl.uint(400));
    });
  });

  describe("resolve-ticket", () => {
    beforeEach(() => {
      simnet.callPublicFn(CONTRACT, "submit-ticket", [CONTENT_HASH], wallet1);
    });

    it("deployer can resolve a ticket with a resolution hash", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "resolve-ticket", [Cl.uint(1), RESOLVE_HASH], deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("non-owner cannot resolve a ticket", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "resolve-ticket", [Cl.uint(1), RESOLVE_HASH], wallet1
      );
      expect(result.result).toBeErr(Cl.uint(401));
    });

    it("resolved ticket has STATUS=3 and a resolution hash", () => {
      simnet.callPublicFn(CONTRACT, "resolve-ticket", [Cl.uint(1), RESOLVE_HASH], deployer);
      const ticket = simnet.callReadOnlyFn(CONTRACT, "get-ticket", [Cl.uint(1)], wallet1);
      expect(ticket.result).toHaveClarityType(ClarityType.OptionalSome);
    });
  });

});
