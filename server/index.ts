// ClaimPack server: local API + web app + PayPal webhook. Listens on 127.0.0.1 only.
import { bytesMatchExtension } from "../src/sniff";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { buildCase, engineDoc, pdfName } from "../src/case";
import { aliasUsed, draftStatement } from "../src/ai/drafter";
import { makeClient, readDocument } from "../src/ai/reader";
import { evidenceForm, evidenceInput, type EvidenceFile } from "../src/paypal/evidence";
import { loadEnv, PayPal, PayPalError } from "../src/paypal/client";
import { summaryPdf, textToPdf } from "../src/pdf/pdfs";
import { checkStatement } from "../src/rules/statement";
import { DATA, Store } from "../src/store";

const ROOT = join(import.meta.dirname, "..");
process.chdir(ROOT); // static files and data resolve from the repo, whoever starts the server
loadEnv(ROOT);
const PORT = Number(process.env.PORT || 8790);
const HOST = "127.0.0.1";
const store = new Store();
const pp = new PayPal();
const TX_ID = /^[A-Z0-9]{10,25}$/;
const DISPUTE_ID = /^PP-[A-Z0-9-]{4,40}$/;
const TEXT_EXT = new Set([".txt", ".csv", ".log", ".eml", ".md"]);
const MIME: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MAX_UPLOAD = 10 * 1024 * 1024;

const app = new Hono();

// ---- live updates to the browser (server-sent events) ----
const listeners = new Set<(msg: string) => void>();
const broadcast = (what: string, id?: string) => { for (const l of listeners) l(JSON.stringify({ what, id, at: new Date().toISOString() })); };

// ---- protection: the API answers only this machine's own pages (DNS rebinding, cross-site requests) ----
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
app.use("/api/*", async (c, next) => {
  if (!LOCAL_HOSTS.has(c.req.header("host") ?? "")) return c.json({ error: "ClaimPack's API only answers on this computer." }, 403);
  if (c.req.method !== "GET") {
    const origin = c.req.header("origin");
    if (origin && !LOCAL_HOSTS.has(origin.replace(/^https?:\/\//, ""))) return c.json({ error: "Cross-site request refused." }, 403);
    if (!origin && c.req.header("sec-fetch-site") && c.req.header("sec-fetch-site") !== "same-origin") return c.json({ error: "Cross-site request refused." }, 403);
  }
  await next();
});

const fail = (c: Context, e: unknown) => {
  if (e instanceof PayPalError) return c.json({ error: e.message, paypal: e.body, debugId: e.debugId }, 502);
  return c.json({ error: (e as Error).message }, 400);
};

// ---- disputes ----
async function syncDispute(id: string) {
  const raw = await pp.getDispute(id);
  store.upsertDispute(raw);
  const tx = raw.disputed_transactions?.[0];
  if (tx?.seller_transaction_id) store.armPayment({ txId: tx.seller_transaction_id, amount: tx.gross_amount?.value, currency: tx.gross_amount?.currency_code, payer: tx.buyer?.email, capturedAt: tx.create_time });
  return raw;
}

app.post("/api/sync", async (c) => {
  try {
    const list = await pp.listDisputes();
    for (const d of list.items ?? []) await syncDispute(d.dispute_id);
    broadcast("disputes");
    return c.json({ synced: (list.items ?? []).length });
  } catch (e) { return fail(c, e); }
});

app.get("/api/disputes", (c) => {
  const rows = store.disputes().map((raw) => {
    const tx = raw.disputed_transactions?.[0] ?? {};
    return {
      id: raw.dispute_id, reason: raw.reason, status: raw.status, stage: raw.dispute_life_cycle_stage, amount: raw.dispute_amount?.value, currency: raw.dispute_amount?.currency_code,
      created: raw.create_time, due: raw.seller_response_due_date ?? null, buyer: tx.buyer?.name ?? tx.buyer?.email ?? null, txId: tx.seller_transaction_id,
      docs: tx.seller_transaction_id ? store.docs(tx.seller_transaction_id).length : 0, canFile: (raw.links ?? []).some((l: any) => l.rel === "provide_evidence"),
    };
  });
  return c.json(rows);
});

app.get("/api/disputes/:id", async (c) => {
  const id = c.req.param("id");
  if (!DISPUTE_ID.test(id)) return c.json({ error: "Bad dispute id." }, 400);
  try { return c.json(await buildCase(store, pp, id)); } catch (e) { return fail(c, e); }
});

app.post("/api/disputes/:id/refresh", async (c) => {
  const id = c.req.param("id");
  if (!DISPUTE_ID.test(id)) return c.json({ error: "Bad dispute id." }, 400);
  try { await syncDispute(id); broadcast("dispute", id); return c.json(await buildCase(store, pp, id, { fresh: true })); } catch (e) { return fail(c, e); }
});

// ---- the evidence locker (per payment) ----
app.get("/api/payments", (c) => {
  const disputeOf = new Map(store.disputes().map((d) => [d.disputed_transactions?.[0]?.seller_transaction_id, d.dispute_id]));
  return c.json(store.payments().map((p) => ({ ...p, docs: store.docs(p.txId).length, disputeId: disputeOf.get(p.txId) ?? null })));
});

app.get("/api/payments/:txId", (c) => {
  const txId = c.req.param("txId");
  if (!TX_ID.test(txId)) return c.json({ error: "Bad transaction id." }, 400);
  const disputeId = store.disputes().find((d) => d.disputed_transactions?.[0]?.seller_transaction_id === txId)?.dispute_id ?? null;
  return c.json({ payment: store.payment(txId) ?? { txId }, disputeId,
    docs: store.docs(txId).map((d) => ({ ...engineDoc(d), originalName: d.name, originalMime: d.mime, addedAt: d.addedAt, read: store.read(d.id) ?? null })) });
});

// Reading can also happen before any dispute exists ("pre-armed" locker).
app.post("/api/payments/:txId/read", async (c) => {
  const txId = c.req.param("txId");
  if (!TX_ID.test(txId)) return c.json({ error: "Bad transaction id." }, 400);
  try {
    const { client, model } = makeClient();
    let cost = 0;
    for (const d of store.docs(txId)) {
      if (store.read(d.id)) continue;
      const r = await readDocument(client, model, d.id, d.path);
      store.saveRead({ docId: d.id, facts: r.facts, dropped: r.dropped, docType: r.output.document_type, quarantineQuote: r.output.addressed_to_reader ? (r.output.addressed_to_reader_quote ?? "(text addressed to an AI)") : undefined, costUsd: r.costUsd, readAt: new Date().toISOString() });
      cost += r.costUsd;
    }
    broadcast("docs", txId);
    return c.json({ costUsd: cost });
  } catch (e) { return fail(c, e); }
});

app.post("/api/payments/:txId/docs", async (c) => {
  const txId = c.req.param("txId");
  if (!TX_ID.test(txId)) return c.json({ error: "Bad transaction id." }, 400);
  if (!store.payment(txId)) store.armPayment({ txId });
  const body = await c.req.parseBody({ all: true });
  const files = ([] as unknown[]).concat(body["file"] ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return c.json({ error: "No file uploaded." }, 400);
  const added = [];
  for (const f of files) {
    const ext = extname(f.name).toLowerCase();
    if (!MIME[ext] && !TEXT_EXT.has(ext)) return c.json({ error: `${f.name}: use PDF, PNG, JPG, GIF, WEBP, or a text file (.txt .csv .log .eml .md).` }, 400);
    if (f.size > MAX_UPLOAD) return c.json({ error: `${f.name} is over 10 MB (PayPal's limit per file).` }, 400);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!bytesMatchExtension(ext, bytes, TEXT_EXT)) return c.json({ error: `${f.name}: the file inside is not a ${ext.slice(1).toUpperCase()} file. Upload the original document.` }, 400);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (store.docs(txId).some((d) => d.sha256 === sha256)) continue; // same file twice
    const id = `d${sha256.slice(0, 8)}${randomBytes(2).toString("hex")}`;
    const name = basename(f.name).replace(/[^\w.\- ()]/g, "_").slice(0, 80) || `document${ext}`;
    const dir = join(DATA, "files", txId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}${ext}`);
    writeFileSync(path, bytes);
    let pdfPath: string | undefined, pdfBytes: number | undefined;
    if (TEXT_EXT.has(ext)) {
      const pdf = await textToPdf(name, new TextDecoder().decode(bytes), sha256);
      pdfPath = join(dir, `${id}.pdf`);
      writeFileSync(pdfPath, pdf);
      pdfBytes = pdf.length;
    }
    store.addDoc({ id, txId, name, mime: MIME[ext] ?? "text/plain", bytes: bytes.length, sha256, path, pdfPath, pdfBytes, addedAt: new Date().toISOString() });
    added.push({ id, name });
  }
  broadcast("docs", txId);
  return c.json({ added });
});

app.delete("/api/docs/:docId", (c) => { store.removeDoc(c.req.param("docId")); broadcast("docs"); return c.json({ ok: true }); });

app.get("/api/docs/:docId/file", (c) => {
  const id = c.req.param("docId");
  const doc = store.db.prepare("SELECT tx_id FROM docs WHERE id = ?").get(id) as { tx_id: string } | undefined;
  const d = doc && store.docs(doc.tx_id).find((x) => x.id === id);
  if (!d) return c.json({ error: "Not found." }, 404);
  const path = d.pdfPath ?? d.path;
  return new Response(readFileSync(path), { headers: { "Content-Type": d.pdfPath ? "application/pdf" : d.mime, "Content-Disposition": `inline; filename="${(d.pdfPath ? pdfName(d.name) : d.name).replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff" } });
});

// ---- AI steps (each costs a little Meta API credit) ----
app.post("/api/disputes/:id/read", async (c) => {
  const id = c.req.param("id");
  try {
    const kase = await buildCase(store, pp, id);
    const { client, model } = makeClient();
    let cost = 0;
    const results = [];
    for (const d of store.docs(kase.dispute.transaction.id)) {
      if (store.read(d.id)) continue;
      const r = await readDocument(client, model, d.id, d.path);
      store.saveRead({ docId: d.id, facts: r.facts, dropped: r.dropped, docType: r.output.document_type, quarantineQuote: r.output.addressed_to_reader ? (r.output.addressed_to_reader_quote ?? "(text addressed to an AI)") : undefined, costUsd: r.costUsd, readAt: new Date().toISOString() });
      cost += r.costUsd;
      results.push({ doc: d.name, facts: r.facts.length, quarantined: r.output.addressed_to_reader });
    }
    broadcast("dispute", id);
    return c.json({ results, costUsd: cost, case: await buildCase(store, pp, id) });
  } catch (e) { return fail(c, e); }
});

app.post("/api/disputes/:id/draft", async (c) => {
  const id = c.req.param("id");
  try {
    const kase = await buildCase(store, pp, id);
    if (kase.plan.verdict !== "READY") return c.json({ error: `The pack is ${kase.plan.verdict}; there is nothing to draft until it is READY.` }, 409);
    const { client, model } = makeClient();
    const engineDocs = store.docs(kase.dispute.transaction.id).map(engineDoc);
    const draft = await draftStatement(client, model, kase.dispute, kase.plan, kase.facts, engineDocs);
    return c.json({ ...draft, planHash: kase.planHash });
  } catch (e) { return fail(c, e); }
});

// ---- filing: re-checked from scratch, refused unless READY, filable, approved and unchanged ----
app.post("/api/disputes/:id/file", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json<{ statement: string; approvedBy: string; planHash: string }>();
    if (!body.approvedBy?.trim()) return c.json({ error: "Type your name to approve." }, 400);
    const kase = await buildCase(store, pp, id, { fresh: true });
    if (body.planHash !== kase.planHash) return c.json({ error: "The evidence changed since you reviewed it. Review it again before filing." }, 409);
    if (kase.plan.verdict !== "READY") return c.json({ error: `The pack is ${kase.plan.verdict}; ClaimPack only files READY packs.` }, 409);
    if (!kase.plan.canFileNow) return c.json({ error: "PayPal is not accepting evidence on this dispute right now." }, 409);
    const stored = store.docs(kase.dispute.transaction.id);
    const engineDocs = stored.map(engineDoc);
    // The statement cites the short ids the drafter showed the model (same function, same order).
    const aliasFacts = aliasUsed(kase.facts, kase.plan);
    const check = checkStatement(body.statement, aliasFacts, aliasFacts.map((f) => f.id), kase.dispute, engineDocs);
    if (!check.ok) return c.json({ error: "The statement did not pass the checks.", problems: check.problems }, 422);

    const files: EvidenceFile[] = [];
    const summary = await summaryPdf(kase.dispute, kase.plan, kase.facts, engineDocs, check.notes);
    files.push({ name: "evidence-summary.pdf", mime: "application/pdf", data: summary });
    for (const docId of kase.plan.documentIds) {
      const d = stored.find((x) => x.id === docId)!;
      const ed = engineDoc(d);
      files.push({ name: ed.name, mime: ed.mime, data: new Uint8Array(readFileSync(d.pdfPath ?? d.path)) as Uint8Array<ArrayBuffer> });
    }
    const input = evidenceInput(kase.plan, check.notes, files);
    let status = 0, response: unknown;
    try { response = await pp.provideEvidence(id, evidenceForm(input, files)); status = 200; }
    catch (e) { if (e instanceof PayPalError) { status = e.status; response = e.body; } else throw e; }
    store.addFiling({ disputeId: id, approvedBy: body.approvedBy.trim().slice(0, 80), request: input,
      files: files.map((f) => ({ name: f.name, bytes: f.data.length, sha256: createHash("sha256").update(f.data).digest("hex") })), response, status });
    if (status !== 200) return c.json({ error: "PayPal refused the filing.", status, paypal: response }, 502);
    await syncDispute(id);
    broadcast("dispute", id);
    return c.json({ ok: true, case: await buildCase(store, pp, id) });
  } catch (e) { return fail(c, e); }
});

// The guard on its own (no AI call): lets the seller edit the statement and see at once whether it would pass.
app.post("/api/disputes/:id/check-statement", async (c) => {
  try {
    const { statement } = await c.req.json<{ statement: string }>();
    const kase = await buildCase(store, pp, c.req.param("id"));
    const aliasFacts = aliasUsed(kase.facts, kase.plan);
    return c.json(checkStatement(statement ?? "", aliasFacts, aliasFacts.map((f) => f.id), kase.dispute, store.docs(kase.dispute.transaction.id).map(engineDoc)));
  } catch (e) { return fail(c, e); }
});

app.get("/api/disputes/:id/summary.pdf", async (c) => {
  try {
    const kase = await buildCase(store, pp, c.req.param("id"));
    const engineDocs = store.docs(kase.dispute.transaction.id).map(engineDoc);
    const pdf = await summaryPdf(kase.dispute, kase.plan, kase.facts, engineDocs, c.req.query("notes") ?? "(statement not drafted yet)");
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=evidence-summary.pdf" } });
  } catch (e) { return fail(c, e); }
});

// ---- demo shop: a sandbox sale with the seller's own invoice number, so evidence can be matched to it ----
app.post("/api/demo/order", async (c) => {
  try {
    const b = await c.req.json<{ item: string; amount: string; invoiceId: string }>();
    if (!/^\d{1,5}(\.\d{2})?$/.test(b.amount) || !b.item?.trim() || !/^[\w-]{3,30}$/.test(b.invoiceId ?? "")) return c.json({ error: "Give an item, an amount like 120.00 and an invoice number like INV-1043." }, 400);
    const order = await pp.call("create order", "/v2/checkout/orders", { json: {
      intent: "CAPTURE",
      purchase_units: [{ invoice_id: b.invoiceId, description: b.item.slice(0, 120), amount: { currency_code: "USD", value: Number(b.amount).toFixed(2) } }],
      payment_source: { paypal: { experience_context: { user_action: "PAY_NOW", return_url: `http://127.0.0.1:${PORT}/api/demo/return`, cancel_url: `http://127.0.0.1:${PORT}/` } } },
    }, headers: { "PayPal-Request-Id": `claimpack-${b.invoiceId}-${Date.now()}` } });
    return c.json({ orderId: order.id, approveUrl: order.links.find((l: any) => l.rel === "payer-action" || l.rel === "approve")?.href });
  } catch (e) { return fail(c, e); }
});

app.get("/api/demo/return", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!/^[A-Z0-9]{10,25}$/.test(token)) return c.text("Bad token.", 400);
  try {
    const cap = await pp.call("capture order", `/v2/checkout/orders/${token}/capture`, { method: "POST", json: {} });
    const capture = cap.purchase_units?.[0]?.payments?.captures?.[0];
    store.armPayment({ txId: capture.id, orderId: cap.id, invoiceId: capture.invoice_id ?? cap.purchase_units?.[0]?.invoice_id, amount: capture.amount?.value, currency: capture.amount?.currency_code, payer: cap.payer?.email_address, capturedAt: capture.create_time, raw: cap });
    broadcast("payments");
    return c.redirect(`/#/payments/${capture.id}`);
  } catch (e) { return c.text((e as Error).message, 502); }
});

// ---- PayPal webhook: the only route that answers from outside; trusted only after PayPal confirms the signature ----
app.post("/webhooks/paypal", async (c) => {
  const raw = await c.req.text();
  if (raw.length > 1_000_000) return c.text("too large", 413);
  let event: any;
  try { event = JSON.parse(raw); } catch { return c.text("bad json", 400); }
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
  let verified = false;
  try { verified = await pp.verifyWebhook(headers, event); } catch { verified = false; }
  if (!verified) return c.text("signature not verified", 401);
  if (!store.recordEvent(event.id, event.event_type, true, event)) return c.text("duplicate", 200);
  try {
    const r = event.resource ?? {};
    if (String(event.event_type).startsWith("CUSTOMER.DISPUTE.") && r.dispute_id) { await syncDispute(r.dispute_id); broadcast("dispute", r.dispute_id); }
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && r.id) {
      store.armPayment({ txId: r.id, orderId: r.supplementary_data?.related_ids?.order_id, invoiceId: r.invoice_id, amount: r.amount?.value, currency: r.amount?.currency_code, capturedAt: r.create_time, raw: r });
      broadcast("payments");
    }
  } catch (e) { console.error("webhook handling failed:", (e as Error).message); }
  return c.text("ok", 200);
});

app.get("/api/events", (c) => c.json(store.events()));
app.get("/api/stream", (c) => streamSSE(c, async (s) => {
  const send = (m: string) => { void s.writeSSE({ data: m }); };
  listeners.add(send);
  s.onAbort(() => { listeners.delete(send); });
  while (!s.aborted) await s.sleep(25_000).then(() => s.writeSSE({ event: "ping", data: "" }));
}));
app.get("/api/health", (c) => c.json({ ok: true, paypal: pp.base.includes("sandbox") ? "sandbox" : "live", webhookConfigured: !!process.env.PAYPAL_WEBHOOK_ID, ai: !!process.env.META_API_KEY }));

// ---- watching PayPal without a public address: poll the dispute list and sync what changed ----
// (Webhooks need PayPal to reach this computer; polling does not. Both lead to the same syncDispute.)
const POLL_SECONDS = Number(process.env.CLAIMPACK_POLL_SECONDS ?? 45);
let polling = false;
async function pollPayPal() {
  if (polling) return;
  polling = true;
  try {
    const list = await pp.listDisputes();
    let changed = 0;
    for (const item of list.items ?? []) {
      const known = store.dispute(item.dispute_id);
      if (known && known.update_time === item.update_time) continue;
      await syncDispute(item.dispute_id);
      broadcast("dispute", item.dispute_id);
      changed++;
    }
    if (changed) { broadcast("disputes"); console.log(`PayPal: ${changed} dispute(s) new or updated`); }
  } catch (e) { console.error("PayPal poll failed:", (e as Error).message); }
  finally { polling = false; }
}
if (POLL_SECONDS > 0) { setInterval(pollPayPal, POLL_SECONDS * 1000); setTimeout(pollPayPal, 2000); }

app.get("/api/watch", (c) => c.json({ pollSeconds: POLL_SECONDS, webhook: !!process.env.PAYPAL_WEBHOOK_ID }));

// ---- web app ----
const dist = join(ROOT, "web", "dist");
if (existsSync(dist)) {
  app.use("/assets/*", serveStatic({ root: "./web/dist" }));
  app.use("/img/*", serveStatic({ root: "./web/dist" }));
  app.get("*", (c) => c.html(readFileSync(join(dist, "index.html"), "utf8")));
} else app.get("/", (c) => c.text("Web app not built yet: run npm run web:build"));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`ClaimPack on http://${HOST}:${PORT}  (PayPal ${pp.base.includes("sandbox") ? "sandbox" : "LIVE"}, webhook ${process.env.PAYPAL_WEBHOOK_ID ? "configured" : "not configured"}, checking PayPal every ${POLL_SECONDS}s)`);
});
