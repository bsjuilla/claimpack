// Thin client for the local ClaimPack API. Errors carry the server's own words.
import type { Check, DisputeCase, Fact, PackPlan } from "../../src/types";

export class ApiError extends Error {
  constructor(message: string, public body: any) { super(message); }
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  const r = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body.error ?? `Request failed (${r.status}).`, body);
  return body as T;
}

export const get = <T>(path: string) => call<T>(path);
export const post = <T>(path: string, json?: unknown) => call<T>(path, { method: "POST", json: json ?? {} });
export const upload = (txId: string, files: FileList | File[]) => {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append("file", f);
  return call<{ added: { id: string; name: string }[] }>(`/api/payments/${txId}/docs`, { method: "POST", body: fd });
};
export const remove = (docId: string) => call(`/api/docs/${docId}`, { method: "DELETE" });

export interface DisputeRow {
  id: string; reason: DisputeCase["reason"]; status: string; stage: string; amount: string; currency: string;
  created: string; due: string | null; buyer: string | null; txId: string; docs: number; canFile: boolean;
}

export interface DocView {
  id: string; name: string; mime: string; bytes: number; sha256: string; quarantined?: boolean;
  originalName: string; originalMime: string; addedAt: string;
  read: { facts: Fact[]; dropped: string[]; docType: string; quarantineQuote?: string; costUsd: number; readAt: string } | null;
}

export interface CaseView {
  dispute: DisputeCase;
  context: { items: { name: string; quantity?: string }[]; sellerProtectionEligible: boolean | null; sellerProtectionType: string | null;
    buyerRequested: { value: string; currency: string } | null; sellerEvidenceFiled: { type: string; date: string; notes: string; documents: string[] }[] };
  payment: { txId: string; invoiceId?: string; armedAt?: string } | null;
  docs: DocView[];
  unread: number;
  facts: Fact[];
  plan: PackPlan;
  planHash: string;
  held: { amount: string; currency: string } | null;
  filings: { id: number; approved_by: string; at: string; status: number; files: { name: string; bytes: number; sha256: string }[]; request: any; response: any }[];
  settlements: { action: string; approved_by: string; request: any; status: number; at: string }[];
}

export interface StatementCheck { ok: boolean; problems: { sentence: string; problem: string }[]; notes: string }
export interface Draft { statement: string; check: StatementCheck; attempts: number; costUsd: number; planHash: string; replayed?: boolean }
export interface PaymentRow { txId: string; orderId?: string; invoiceId?: string; amount?: string; currency?: string; payer?: string; capturedAt?: string; armedAt: string; docs: number; disputeId: string | null }

export type { Check, Fact };

/** Re-runs `fn` whenever the server says something changed (new dispute, new document, PayPal webhook). */
export function onServerChange(fn: (msg: { what: string; id?: string }) => void): () => void {
  const es = new EventSource("/api/stream");
  es.onmessage = (e) => { try { fn(JSON.parse(e.data)); } catch { /* ignore */ } };
  return () => es.close();
}
