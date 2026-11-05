import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { disputeContext, toDisputeCase } from "../src/paypal/normalize";

const raw = JSON.parse(readFileSync(new URL("./fixtures/dispute-sandbox.json", import.meta.url), "utf8"));

describe("PayPal dispute -> DisputeCase (real sandbox dispute)", () => {
  const d = toDisputeCase(raw);
  it("reads the reason, stage, amount and the payment behind it", () => {
    expect(d.id).toBe("PP-R-ZDG-10196662");
    expect(d.reason).toBe("MERCHANDISE_OR_SERVICE_NOT_RECEIVED");
    expect(d.stage).toBe("INQUIRY");
    expect(d.amount).toEqual({ value: "120.00", currency: "USD" });
    expect(d.transaction.id).toBe("4JJ59706F4419253F");
    expect(d.transaction.amount).toEqual({ value: "120.00", currency: "USD" });
    expect(d.transaction.buyerEmail).toMatch(/@personal\.example\.com$/);
  });
  it("takes allowed actions from PayPal's links, not from guesses", () => {
    expect(d.actions).toContain("self");
    expect(d.actions).not.toContain("provide_evidence"); // evidence was already filed in the spike
  });
  it("keeps the buyer's own words", () => {
    expect(d.buyerStatement).toMatch(/never delivered/);
  });
  it("shows the evidence the seller already filed", () => {
    expect(disputeContext(raw).sellerEvidenceFiled[0].type).toBe("PROOF_OF_FULFILLMENT");
  });
});
