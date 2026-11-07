import { describe, expect, it } from "vitest";
import { resolveLooseDate } from "../src/rules/dates";
import { planPack } from "../src/rules/engine";

describe("dates written without a year", () => {
  it("reads day-first or month-first, whichever is nearest the payment, and keeps the time", () => {
    expect(resolveLooseDate("05/10 08:45 Link sent", "2026-10-05T08:00:00Z")).toBe("2026-10-05T08:45");
    expect(resolveLooseDate("10/5 9:30 downloaded", "2026-10-04T08:00:00Z")).toBe("2026-10-05T09:30");
  });
  it("uses the year when the record gives one, and crosses New Year correctly", () => {
    expect(resolveLooseDate("05.10.25", "2026-10-05T08:00:00Z")).toBe("2025-10-05");
    expect(resolveLooseDate("02/01 10:00", "2026-12-30T08:00:00Z")).toBe("2027-01-02T10:00");
  });
  it("refuses text that is not a date", () => {
    expect(resolveLooseDate("downloaded twice", "2026-10-05T08:00:00Z")).toBeUndefined();
    expect(resolveLooseDate("31/02", "2026-10-05T08:00:00Z")).toBeUndefined();
  });
  it("the engine uses the resolved date and tells the seller what it assumed", () => {
    const p = planPack({
      dispute: { id: "D", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", stage: "INQUIRY", status: "WAITING_FOR_SELLER_RESPONSE", amount: { value: "70.00", currency: "USD" },
        createTime: "2026-10-20T08:00:00Z", sellerResponseDue: "2026-11-09T08:00:00Z", actions: ["provide_evidence"],
        transaction: { id: "T", invoiceId: "INV-3114", createTime: "2026-10-05T08:00:00Z", amount: { value: "70.00", currency: "USD" }, buyerName: "Aarav Shah" } },
      docs: [{ id: "log", name: "log.pdf", mime: "application/pdf", bytes: 1, sha256: "" }], now: "2026-11-07T12:00:00Z",
      facts: [{ id: "f1", kind: "delivery", method: "digital", at: "", atText: "05/10 09:30  album-cover-INV-3114.zip downloaded", detail: "downloaded", orderRef: "INV-3114", cite: { docId: "log", quote: "05/10 09:30  album-cover-INV-3114.zip downloaded" } }],
    });
    expect(p.verdict).toBe("READY");
    expect(p.checks.find((c) => c.id === "date-f1")?.detail).toMatch(/2026-10-05/);
  });
});

describe("the reader keeps a delivery whose date has no year", async () => {
  const { toFacts } = await import("../src/ai/reader");
  it("keeps the line as written so the engine can resolve it, and still drops a delivery with no date at all", () => {
    const row = (quote: string) => ({ kind: "delivery" as const, quote, page: null, at: null, order_ref: "INV-3114", transaction_id: null, carrier: null, tracking_number: null,
      tracking_status: null, recipient: null, delivery_method: "digital" as const, detail: null, refund_id: null, amount_value: null, amount_currency: null, buyer: null, policy: null, from: null });
    const r = toFacts("log", { document_type: "delivery_log", addressed_to_reader: false, addressed_to_reader_quote: null, facts: [row("05/10 09:30  file downloaded"), row("file downloaded")] });
    expect(r.facts).toHaveLength(1);
    expect((r.facts[0] as any).atText).toMatch(/05\/10/);
    expect(r.dropped).toHaveLength(1);
  });
});
