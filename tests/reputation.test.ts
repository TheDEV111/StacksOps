import { describe, it, expect } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

const accounts   = simnet.getAccounts();
const deployer   = accounts.get("deployer")!;
const wallet1    = accounts.get("wallet_1")!;
const wallet2    = accounts.get("wallet_2")!;

const CONTRACT = "reputation";

// Action constants (mirrored from the contract)
const ACTION_TICKET_RESOLVED = Cl.uint(1);
const ACTION_DISPUTE_WON     = Cl.uint(2);
const ACTION_DISPUTE_LOST    = Cl.uint(3);
const ACTION_DAO_VOTE        = Cl.uint(4);
const ACTION_SPAM_PENALTY    = Cl.uint(5);

// Tier constants
const TIER_BRONZE   = Cl.uint(1);
const TIER_SILVER   = Cl.uint(2);
const TIER_GOLD     = Cl.uint(3);
const TIER_PLATINUM = Cl.uint(4);

describe("reputation", () => {

  describe("initial state", () => {
    it("score defaults to 0 for unknown wallet", () => {
      const score = simnet.callReadOnlyFn(CONTRACT, "get-score", [Cl.principal(wallet1)], wallet1);
      expect(score.result).toBeUint(0);
    });

    it("tier defaults to BRONZE for unknown wallet", () => {
      const tier = simnet.callReadOnlyFn(CONTRACT, "get-tier", [Cl.principal(wallet1)], wallet1);
      expect(tier.result).toBeUint(1);
    });
  });

  describe("update-reputation – authorization", () => {
    it("deployer can update reputation", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_TICKET_RESOLVED, Cl.uint(10)],
        deployer
      );
      expect(result.result).toBeOk(Cl.uint(10));
    });

    it("unauthorized wallet cannot update reputation", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "update-reputation",
        [Cl.principal(wallet2), ACTION_TICKET_RESOLVED, Cl.uint(10)],
        wallet1   // wallet1 is not authorized
      );
      expect(result.result).toBeErr(Cl.uint(401));
    });
  });

  describe("authorize-contract / revoke-contract", () => {
    it("deployer can authorize a contract principal", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "authorize-contract",
        [Cl.principal(wallet2)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));
      const check = simnet.callReadOnlyFn(
        CONTRACT, "is-authorized-contract", [Cl.principal(wallet2)], deployer
      );
      expect(check.result).toBeBool(true);
    });

    it("authorized contract can update reputation", () => {
      simnet.callPublicFn(CONTRACT, "authorize-contract", [Cl.principal(wallet2)], deployer);
      const result = simnet.callPublicFn(
        CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_TICKET_RESOLVED, Cl.uint(10)],
        wallet2
      );
      expect(result.result).toBeOk(Cl.uint(10));
    });

    it("deployer can revoke an authorized contract", () => {
      simnet.callPublicFn(CONTRACT, "authorize-contract", [Cl.principal(wallet2)], deployer);
      simnet.callPublicFn(CONTRACT, "revoke-contract", [Cl.principal(wallet2)], deployer);
      const check = simnet.callReadOnlyFn(
        CONTRACT, "is-authorized-contract", [Cl.principal(wallet2)], deployer
      );
      expect(check.result).toBeBool(false);
    });

    it("non-deployer cannot authorize a contract", () => {
      const result = simnet.callPublicFn(
        CONTRACT, "authorize-contract", [Cl.principal(wallet2)], wallet1
      );
      expect(result.result).toBeErr(Cl.uint(401));
    });
  });

  describe("score accumulation and tier transitions", () => {
    it("accumulates score across multiple actions", () => {
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_TICKET_RESOLVED, Cl.uint(10)], deployer);
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DAO_VOTE, Cl.uint(5)], deployer);
      const score = simnet.callReadOnlyFn(CONTRACT, "get-score", [Cl.principal(wallet1)], wallet1);
      expect(score.result).toBeUint(15);
    });

    it("reaches SILVER tier at 100 points", () => {
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DISPUTE_WON, Cl.uint(100)], deployer);
      const tier = simnet.callReadOnlyFn(CONTRACT, "get-tier", [Cl.principal(wallet1)], wallet1);
      expect(tier.result).toStrictEqual(TIER_SILVER);
    });

    it("reaches GOLD tier at 500 points", () => {
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DISPUTE_WON, Cl.uint(500)], deployer);
      const tier = simnet.callReadOnlyFn(CONTRACT, "get-tier", [Cl.principal(wallet1)], wallet1);
      expect(tier.result).toStrictEqual(TIER_GOLD);
    });

    it("reaches PLATINUM tier at 1000 points", () => {
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DISPUTE_WON, Cl.uint(1000)], deployer);
      const tier = simnet.callReadOnlyFn(CONTRACT, "get-tier", [Cl.principal(wallet1)], wallet1);
      expect(tier.result).toStrictEqual(TIER_PLATINUM);
    });
  });

  describe("score deductions", () => {
    it("ACTION_DISPUTE_LOST reduces score", () => {
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DISPUTE_WON, Cl.uint(50)], deployer);
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DISPUTE_LOST, Cl.uint(15)], deployer);
      const score = simnet.callReadOnlyFn(CONTRACT, "get-score", [Cl.principal(wallet1)], wallet1);
      expect(score.result).toBeUint(35);
    });

    it("score never goes below 0 (saturating subtraction)", () => {
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DISPUTE_LOST, Cl.uint(100)], deployer);
      const score = simnet.callReadOnlyFn(CONTRACT, "get-score", [Cl.principal(wallet1)], wallet1);
      expect(score.result).toBeUint(0);
    });

    it("ACTION_SPAM_PENALTY reduces score", () => {
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DISPUTE_WON, Cl.uint(30)], deployer);
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_SPAM_PENALTY, Cl.uint(20)], deployer);
      const score = simnet.callReadOnlyFn(CONTRACT, "get-score", [Cl.principal(wallet1)], wallet1);
      expect(score.result).toBeUint(10);
    });
  });

  describe("dispute outcome counters", () => {
    it("increments disputes-won on ACTION_DISPUTE_WON", () => {
      simnet.callPublicFn(CONTRACT, "update-reputation",
        [Cl.principal(wallet1), ACTION_DISPUTE_WON, Cl.uint(25)], deployer);
      const rep = simnet.callReadOnlyFn(CONTRACT, "get-reputation", [Cl.principal(wallet1)], wallet1);
      expect(rep.result).toHaveClarityType(ClarityType.OptionalSome);
    });
  });

});
