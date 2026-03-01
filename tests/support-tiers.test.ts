import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1  = accounts.get("wallet_1")!;
const wallet2  = accounts.get("wallet_2")!;

const CONTRACT = "support-tiers";

// Priority constants (mirrored from contract)
const PRIORITY_LOW      = 1n;
const PRIORITY_NORMAL   = 2n;
const PRIORITY_HIGH     = 3n;
const PRIORITY_CRITICAL = 4n;

// Stake thresholds
const STAKE_PREMIUM    = 1_000_000n;   // 1 STX in uSTX
const STAKE_ENTERPRISE = 10_000_000n;  // 10 STX in uSTX

describe("support-tiers", () => {

  describe("stake-for-priority", () => {
    it("staking STAKE_PREMIUM gives HIGH priority", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "stake-for-priority",
        [Cl.uint(1), Cl.uint(STAKE_PREMIUM)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(PRIORITY_HIGH));
    });

    it("staking STAKE_ENTERPRISE gives CRITICAL priority", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "stake-for-priority",
        [Cl.uint(2), Cl.uint(STAKE_ENTERPRISE)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(PRIORITY_CRITICAL));
    });

    it("staking below minimum returns ERR-INSUFFICIENT-STAKE", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "stake-for-priority",
        [Cl.uint(3), Cl.uint(500_000n)],   // below 1 STX
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(402));
    });

    it("double-staking the same ticket returns ERR-ALREADY-STAKED", () => {
      simnet.callPublicFn(CONTRACT, "stake-for-priority",
        [Cl.uint(4), Cl.uint(STAKE_PREMIUM)], wallet1);
      const second = simnet.callPublicFn(CONTRACT, "stake-for-priority",
        [Cl.uint(4), Cl.uint(STAKE_PREMIUM)], wallet2);
      expect(second.result).toBeErr(Cl.uint(409));
    });
  });

  describe("get-ticket-priority", () => {
    it("returns LOW priority for unstaked ticket", () => {
      const priority = simnet.callReadOnlyFn(
        CONTRACT, "get-ticket-priority", [Cl.uint(99)], wallet1
      );
      expect(priority.result).toBeUint(PRIORITY_LOW);
    });

    it("returns HIGH after staking STAKE_PREMIUM", () => {
      simnet.callPublicFn(CONTRACT, "stake-for-priority",
        [Cl.uint(5), Cl.uint(STAKE_PREMIUM)], wallet1);
      const priority = simnet.callReadOnlyFn(
        CONTRACT, "get-ticket-priority", [Cl.uint(5)], wallet1
      );
      expect(priority.result).toBeUint(PRIORITY_HIGH);
    });
  });

  describe("refund-stake", () => {
    beforeEach(() => {
      simnet.callPublicFn(CONTRACT, "stake-for-priority",
        [Cl.uint(10), Cl.uint(STAKE_PREMIUM)], wallet1);
    });

    it("staker can reclaim their stake", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "refund-stake", [Cl.uint(10)], wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("contract owner can also trigger refund", () => {
      // Use a different ticket staked by wallet2
      simnet.callPublicFn(CONTRACT, "stake-for-priority",
        [Cl.uint(11), Cl.uint(STAKE_PREMIUM)], wallet2);
      const result = simnet.callPublicFn(
        CONTRACT, "refund-stake", [Cl.uint(11)], deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("third party cannot claim someone else's stake", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "refund-stake", [Cl.uint(10)], wallet2
      );
      expect(result.result).toBeErr(Cl.uint(401));
    });

    it("after refund ticket reverts to LOW priority", () => {
      simnet.callPublicFn(CONTRACT, "refund-stake", [Cl.uint(10)], wallet1);
      const priority = simnet.callReadOnlyFn(
        CONTRACT, "get-ticket-priority", [Cl.uint(10)], wallet1
      );
      expect(priority.result).toBeUint(PRIORITY_LOW);
    });

    it("refunding a non-existent stake returns ERR-TICKET-NOT-FOUND", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "refund-stake", [Cl.uint(999)], wallet1
      );
      expect(result.result).toBeErr(Cl.uint(404));
    });
  });

});
