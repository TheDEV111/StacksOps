import { describe, it, expect, beforeEach } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

const accounts  = simnet.getAccounts();
const deployer  = accounts.get("deployer")!;
const wallet1   = accounts.get("wallet_1")!;
const wallet2   = accounts.get("wallet_2")!;
const wallet3   = accounts.get("wallet_3")!;

const CONTRACT = "dispute-resolution";

// Dispute status constants (mirrored from contract)
const DISPUTE_OPEN                      = 1n;
const DISPUTE_VOTING                    = 2n;
const DISPUTE_RESOLVED_FAVOR_SUBMITTER  = 3n;
const DISPUTE_RESOLVED_FAVOR_RESPONDENT = 4n;

const EVIDENCE_HASH  = Cl.bufferFromHex("a".repeat(64));
const EVIDENCE_HASH2 = Cl.bufferFromHex("b".repeat(64));

// Helper: submit a dispute and return its ID as BigInt
function openDispute(
  submitter: string,
  respondent: string = wallet2,
  ticketId: bigint = 1n
): bigint {
  const r = simnet.callPublicFn(
    CONTRACT, "submit-dispute",
    [Cl.uint(ticketId), Cl.principal(respondent), EVIDENCE_HASH],
    submitter
  );
  // result is (ok uint)
  const cv = r.result as any;
  return cv.value.value as bigint;
}

// Helper: mine N blocks so the voting window expires
function mineBlocks(n: number) {
  simnet.mineEmptyBlocks(n);
}

describe("dispute-resolution", () => {

  describe("submit-dispute", () => {
    it("returns dispute-id 1 on first submission", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "submit-dispute",
        [Cl.uint(1), Cl.principal(wallet2), EVIDENCE_HASH],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1));
    });

    it("increments dispute-id on each submission", () => {
      openDispute(wallet1);
      const result = simnet.callPublicFn(
        CONTRACT, "submit-dispute",
        [Cl.uint(2), Cl.principal(wallet2), EVIDENCE_HASH],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(2));
    });

    it("dispute starts in OPEN status", () => {
      openDispute(wallet1);
      const dispute = simnet.callReadOnlyFn(
        CONTRACT, "get-dispute", [Cl.uint(1)], wallet1
      );
      expect(dispute.result).toHaveClarityType(ClarityType.OptionalSome);
    });

    it("get-dispute-count reflects all submitted disputes", () => {
      openDispute(wallet1);
      openDispute(wallet1, wallet2, 2n);
      const count = simnet.callReadOnlyFn(CONTRACT, "get-dispute-count", [], wallet1);
      expect(count.result).toBeUint(2);
    });
  });

  describe("add-evidence", () => {
    beforeEach(() => { openDispute(wallet1); });

    it("submitter can add evidence while dispute is OPEN", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "add-evidence", [Cl.uint(1), EVIDENCE_HASH2], wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1));
    });

    it("respondent can also add evidence", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "add-evidence", [Cl.uint(1), EVIDENCE_HASH2], wallet2
      );
      expect(result.result).toBeOk(Cl.uint(1));
    });

    it("third party cannot add evidence", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "add-evidence", [Cl.uint(1), EVIDENCE_HASH2], wallet3
      );
      expect(result.result).toBeErr(Cl.uint(401));
    });

    it("evidence count increases with each submission", () => {
      simnet.callPublicFn(CONTRACT, "add-evidence", [Cl.uint(1), EVIDENCE_HASH2], wallet1);
      simnet.callPublicFn(CONTRACT, "add-evidence", [Cl.uint(1), EVIDENCE_HASH ], wallet2);
      const count = simnet.callReadOnlyFn(
        CONTRACT, "get-evidence-count", [Cl.uint(1)], wallet1
      );
      expect(count.result).toBeUint(2);
    });

    it("evidence cannot be added to a non-existent dispute", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "add-evidence", [Cl.uint(99), EVIDENCE_HASH2], wallet1
      );
      expect(result.result).toBeErr(Cl.uint(404));
    });
  });

  describe("add-arbitrator / is-arbitrator", () => {
    it("deployer can register an arbitrator", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "add-arbitrator", [Cl.principal(wallet3)], deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));
      const check = simnet.callReadOnlyFn(
        CONTRACT, "is-arbitrator", [Cl.principal(wallet3)], deployer
      );
      expect(check.result).toBeBool(true);
    });

    it("non-deployer cannot register an arbitrator", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "add-arbitrator", [Cl.principal(wallet3)], wallet1
      );
      expect(result.result).toBeErr(Cl.uint(401));
    });

    it("deployer can remove an arbitrator", () => {
      simnet.callPublicFn(CONTRACT, "add-arbitrator", [Cl.principal(wallet3)], deployer);
      simnet.callPublicFn(CONTRACT, "remove-arbitrator", [Cl.principal(wallet3)], deployer);
      const check = simnet.callReadOnlyFn(
        CONTRACT, "is-arbitrator", [Cl.principal(wallet3)], deployer
      );
      expect(check.result).toBeBool(false);
    });
  });

  describe("start-voting", () => {
    beforeEach(() => {
      openDispute(wallet1);
      simnet.callPublicFn(CONTRACT, "add-arbitrator", [Cl.principal(wallet3)], deployer);
    });

    it("registered arbitrator can start voting", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "start-voting", [Cl.uint(1)], wallet3
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("deployer can start voting", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "start-voting", [Cl.uint(1)], deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("non-arbitrator cannot start voting", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "start-voting", [Cl.uint(1)], wallet2
      );
      expect(result.result).toBeErr(Cl.uint(401));
    });

    it("cannot start voting on a non-existent dispute", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "start-voting", [Cl.uint(99)], deployer
      );
      expect(result.result).toBeErr(Cl.uint(404));
    });
  });

  describe("vote-on-dispute", () => {
    beforeEach(() => {
      openDispute(wallet1);
      simnet.callPublicFn(CONTRACT, "add-arbitrator", [Cl.principal(wallet3)], deployer);
      simnet.callPublicFn(CONTRACT, "start-voting", [Cl.uint(1)], deployer);
    });

    it("deployer can vote in favour of submitter", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(true)], deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("registered arbitrator can vote", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(false)], wallet3
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("double-voting is rejected", () => {
      simnet.callPublicFn(CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(true)], deployer);
      const second = simnet.callPublicFn(
        CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(true)], deployer
      );
      expect(second.result).toBeErr(Cl.uint(409));
    });

    it("non-arbitrator cannot vote", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(true)], wallet1
      );
      expect(result.result).toBeErr(Cl.uint(401));
    });

    it("get-vote reflects cast ballot", () => {
      simnet.callPublicFn(
        CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(true)], deployer
      );
      const vote = simnet.callReadOnlyFn(
        CONTRACT, "get-vote", [Cl.uint(1), Cl.principal(deployer)], deployer
      );
      expect(vote.result).toHaveClarityType(ClarityType.OptionalSome);
    });
  });

  describe("finalize-ruling", () => {
    beforeEach(() => {
      openDispute(wallet1);
      simnet.callPublicFn(CONTRACT, "add-arbitrator", [Cl.principal(wallet3)], deployer);
      simnet.callPublicFn(CONTRACT, "start-voting", [Cl.uint(1)], deployer);
      // deployer votes for submitter, wallet3 votes for respondent → tie → respondent wins
    });

    it("cannot finalize while voting window is still open", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "finalize-ruling", [Cl.uint(1)], deployer
      );
      expect(result.result).toBeErr(Cl.uint(411));
    });

    it("after voting window: submitter wins with majority votes", () => {
      // deployer votes for submitter
      simnet.callPublicFn(CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(true)], deployer);
      // wallet3 also votes for submitter → submitter majority
      simnet.callPublicFn(CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(true)], wallet3);
      // Advance past voting window
      mineBlocks(1009);
      const result = simnet.callPublicFn(
        CONTRACT, "finalize-ruling", [Cl.uint(1)], deployer
      );
      expect(result.result).toBeOk(Cl.uint(DISPUTE_RESOLVED_FAVOR_SUBMITTER));
    });

    it("after voting window: respondent wins when they have majority", () => {
      // only wallet3 votes, for respondent
      simnet.callPublicFn(CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(false)], wallet3);
      mineBlocks(1009);
      const result = simnet.callPublicFn(
        CONTRACT, "finalize-ruling", [Cl.uint(1)], deployer
      );
      expect(result.result).toBeOk(Cl.uint(DISPUTE_RESOLVED_FAVOR_RESPONDENT));
    });

    it("ruling is stored in the dispute record", () => {
      simnet.callPublicFn(CONTRACT, "vote-on-dispute", [Cl.uint(1), Cl.bool(true)], deployer);
      mineBlocks(1009);
      simnet.callPublicFn(CONTRACT, "finalize-ruling", [Cl.uint(1)], deployer);
      const dispute = simnet.callReadOnlyFn(
        CONTRACT, "get-dispute", [Cl.uint(1)], wallet1
      );
      expect(dispute.result).toHaveClarityType(ClarityType.OptionalSome);
    });
  });

});
