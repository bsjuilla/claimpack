// PayPal REST client (sandbox by default). Never logs credentials or tokens.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerifiedRefund } from "../rules/engine";

export function loadEnv(root = join(import.meta.dirname, "..", "..")) {
  const p = join(root, ".env");
  if (!existsSync(p)) return;
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

export class PayPalError extends Error {
  constructor(public status: number, public body: any, public debugId: string | null, what: string) {
    super(`${what}: PayPal ${status} ${body?.name ?? ""} ${body?.details?.map((d: any) => d.issue).join(", ") ?? body?.message ?? body?.error_description ?? ""}`.trim());
  }
}

export class PayPal {
  private token?: { value: string; until: number };
  constructor(
    private clientId = process.env.PAYPAL_CLIENT_ID ?? "",
    private secret = process.env.PAYPAL_CLIENT_SECRET ?? "",
    readonly base = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com",
  ) {
    if (!clientId || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are missing. Copy .env.example to .env and add your sandbox app's keys.");
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value;
    const r = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new PayPalError(r.status, j, r.headers.get("paypal-debug-id"), "token");
    this.token = { value: j.access_token, until: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async call<T = any>(what: string, path: string, init: { method?: string; json?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}`, ...init.headers };
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(`${this.base}${path}`, {
      method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
      headers,
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    });
    const text = await r.text();
    let body: any = text;
    try { body = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    if (!r.ok) throw new PayPalError(r.status, body, r.headers.get("paypal-debug-id"), what);
    return body as T;
  }

  listDisputes(pageSize = 50) { return this.call<{ items?: any[] }>("list disputes", `/v1/customer/disputes?page_size=${pageSize}`); }
  getDispute(id: string) { return this.call("show dispute", `/v1/customer/disputes/${encodeURIComponent(id)}`); }
  getCapture(id: string) { return this.call("show capture", `/v2/payments/captures/${encodeURIComponent(id)}`); }
  getOrder(id: string) { return this.call("show order", `/v2/checkout/orders/${encodeURIComponent(id)}`); }
  provideEvidence(id: string, form: FormData) { return this.call("provide evidence", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { form }); }
  acceptClaim(id: string, note: string) { return this.call("accept claim", `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, { json: { note } }); }

  /** Refunds PayPal itself records against a capture (via its order). Documents never supply these. */
  async refundsForCapture(captureId: string): Promise<VerifiedRefund[]> {
    const cap: any = await this.getCapture(captureId);
    const orderId = cap?.supplementary_data?.related_ids?.order_id;
    if (!orderId) return [];
    const order: any = await this.getOrder(orderId);
    // A refund belongs to this capture only if PayPal says so: its "up" link names the capture, or, without that link,
    // it sits in a purchase unit whose only capture is this one. Otherwise it is not counted (review A01).
    return (order.purchase_units ?? []).flatMap((u: any) => {
      const captures: string[] = (u.payments?.captures ?? []).map((c: any) => c.id);
      return (u.payments?.refunds ?? []).filter((r: any) => {
        const up = (r.links ?? []).find((l: any) => l.rel === "up")?.href?.match(/captures\/([A-Z0-9]+)/i)?.[1];
        return up ? up === captureId : captures.length === 1 && captures[0] === captureId;
      });
    }).map((r: any) => ({ id: r.id, captureId, amount: { value: r.amount?.value, currency: r.amount?.currency_code }, status: r.status }));
  }

  /** Asks PayPal whether a webhook delivery really came from PayPal. */
  async verifyWebhook(headers: Record<string, string | undefined>, event: unknown, webhookId = process.env.PAYPAL_WEBHOOK_ID ?? ""): Promise<boolean> {
    if (!webhookId) return false;
    const h = (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? "";
    const r = await this.call<{ verification_status: string }>("verify webhook", "/v1/notifications/verify-webhook-signature", {
      json: {
        auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"), webhook_id: webhookId, webhook_event: event,
      },
    });
    return r.verification_status === "SUCCESS";
  }
}
