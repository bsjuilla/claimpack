import { describe, expect, it } from "vitest";
import { trackerBody } from "../src/rules/engine";

const cite = { docId: "d1", quote: "x" };

describe("tracking sent to PayPal's order (Orders v2 add tracking)", () => {
  it("maps a listed carrier and strips spaces from the number", () => {
    expect(trackerBody("9FR10076AF236761F", { id: "f1", kind: "tracking", carrier: "usps", trackingNumber: "9405 5112 0620 4511 9930 21", cite }))
      .toEqual({ capture_id: "9FR10076AF236761F", tracking_number: "9405511206204511993021", carrier: "USPS", notify_payer: false });
  });
  it("sends an unlisted carrier as OTHER with its name", () => {
    expect(trackerBody("CAP1234567890", { id: "f1", kind: "tracking", carrier: "Mauritius Post", trackingNumber: "RR123456789MU", cite }))
      .toEqual({ capture_id: "CAP1234567890", tracking_number: "RR123456789MU", carrier: "OTHER", carrier_name_other: "Mauritius Post", notify_payer: false });
  });
});
