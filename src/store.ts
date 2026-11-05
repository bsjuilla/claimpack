// Local store (node:sqlite, built into Node 22.5+). One file under data/. Evidence files live next to it.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceDoc, Fact } from "./types";

export const DATA = process.env.CLAIMPACK_DATA || join(import.meta.dirname, "..", "data");

export interface StoredDoc extends EvidenceDoc {
  txId: string; // the PayPal capture (seller transaction) this document belongs to
  path: string; // file on disk (for text originals: the original; pdfPath holds the PDF copy)
  pdfPath?: string;
  pdfBytes?: number;
  addedAt: string;
}

export interface ReadRow { docId: string; facts: Fact[]; dropped: string[]; docType: string; quarantineQuote?: string; costUsd: number; readAt: string }

export class Store {
  db: DatabaseSync;
  constructor(file = join(DATA, "claimpack.db")) {
    mkdirSync(join(DATA, "files"), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS disputes (id TEXT PRIMARY KEY, tx_id TEXT, raw TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (tx_id TEXT PRIMARY KEY, order_id TEXT, invoice_id TEXT, amount TEXT, currency TEXT, payer TEXT, captured_at TEXT, raw TEXT, armed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, tx_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL, path TEXT NOT NULL, pdf_path TEXT, pdf_bytes INTEGER, quarantined INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reads (doc_id TEXT PRIMARY KEY, facts TEXT NOT NULL, dropped TEXT NOT NULL, doc_type TEXT, quarantine_quote TEXT, cost_usd REAL, read_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS filings (id INTEGER PRIMARY KEY AUTOINCREMENT, dispute_id TEXT NOT NULL, approved_by TEXT NOT NULL, request TEXT NOT NULL,
        files TEXT NOT NULL, response TEXT, status INTEGER, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT, verified INTEGER, received_at TEXT NOT NULL, raw TEXT);
    `);
  }

  upsertDispute(raw: any) {
    this.db.prepare("INSERT INTO disputes (id, tx_id, raw, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET raw = excluded.raw, tx_id = excluded.tx_id, updated_at = excluded.updated_at")
      .run(raw.dispute_id, raw.disputed_transactions?.[0]?.seller_transaction_id ?? null, JSON.stringify(raw), new Date().toISOString());
  }
  dispute(id: string): any | undefined {
    const r = this.db.prepare("SELECT raw FROM disputes WHERE id = ?").get(id) as { raw: string } | undefined;
    return r && JSON.parse(r.raw);
  }
  disputes(): any[] {
    return (this.db.prepare("SELECT raw FROM disputes ORDER BY updated_at DESC").all() as { raw: string }[]).map((r) => JSON.parse(r.raw));
  }

  armPayment(p: { txId: string; orderId?: string; invoiceId?: string; amount?: string; currency?: string; payer?: string; capturedAt?: string; raw?: unknown }) {
    this.db.prepare(`INSERT INTO payments (tx_id, order_id, invoice_id, amount, currency, payer, captured_at, raw, armed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tx_id) DO UPDATE SET order_id = coalesce(excluded.order_id, order_id), invoice_id = coalesce(excluded.invoice_id, invoice_id), raw = coalesce(excluded.raw, raw)`)
      .run(p.txId, p.orderId ?? null, p.invoiceId ?? null, p.amount ?? null, p.currency ?? null, p.payer ?? null, p.capturedAt ?? null, p.raw ? JSON.stringify(p.raw) : null, new Date().toISOString());
  }
  payments(): any[] {
    return this.db.prepare("SELECT tx_id AS txId, order_id AS orderId, invoice_id AS invoiceId, amount, currency, payer, captured_at AS capturedAt, armed_at AS armedAt FROM payments ORDER BY armed_at DESC").all();
  }
  payment(txId: string): any | undefined {
    return this.db.prepare("SELECT tx_id AS txId, order_id AS orderId, invoice_id AS invoiceId, amount, currency, payer, captured_at AS capturedAt, armed_at AS armedAt FROM payments WHERE tx_id = ?").get(txId);
  }

  addDoc(d: StoredDoc) {
    this.db.prepare("INSERT INTO docs (id, tx_id, name, mime, bytes, sha256, path, pdf_path, pdf_bytes, quarantined, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(d.id, d.txId, d.name, d.mime, d.bytes, d.sha256, d.path, d.pdfPath ?? null, d.pdfBytes ?? null, d.quarantined ? 1 : 0, d.addedAt);
  }
  docs(txId: string): StoredDoc[] {
    return (this.db.prepare("SELECT * FROM docs WHERE tx_id = ? ORDER BY added_at").all(txId) as any[]).map((r) => ({
      id: r.id, txId: r.tx_id, name: r.name, mime: r.mime, bytes: r.bytes, sha256: r.sha256, path: r.path, pdfPath: r.pdf_path ?? undefined, pdfBytes: r.pdf_bytes ?? undefined, quarantined: !!r.quarantined, addedAt: r.added_at,
    }));
  }
  removeDoc(id: string) { this.db.prepare("DELETE FROM docs WHERE id = ?").run(id); this.db.prepare("DELETE FROM reads WHERE doc_id = ?").run(id); }

  saveRead(r: ReadRow) {
    this.db.prepare("INSERT INTO reads (doc_id, facts, dropped, doc_type, quarantine_quote, cost_usd, read_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(doc_id) DO UPDATE SET facts = excluded.facts, dropped = excluded.dropped, doc_type = excluded.doc_type, quarantine_quote = excluded.quarantine_quote, cost_usd = excluded.cost_usd, read_at = excluded.read_at")
      .run(r.docId, JSON.stringify(r.facts), JSON.stringify(r.dropped), r.docType, r.quarantineQuote ?? null, r.costUsd, r.readAt);
    this.db.prepare("UPDATE docs SET quarantined = ? WHERE id = ?").run(r.quarantineQuote ? 1 : 0, r.docId);
  }
  read(docId: string): ReadRow | undefined {
    const r = this.db.prepare("SELECT * FROM reads WHERE doc_id = ?").get(docId) as any;
    return r && { docId: r.doc_id, facts: JSON.parse(r.facts), dropped: JSON.parse(r.dropped), docType: r.doc_type, quarantineQuote: r.quarantine_quote ?? undefined, costUsd: r.cost_usd, readAt: r.read_at };
  }

  addFiling(f: { disputeId: string; approvedBy: string; request: unknown; files: { name: string; sha256: string; bytes: number }[]; response: unknown; status: number }) {
    this.db.prepare("INSERT INTO filings (dispute_id, approved_by, request, files, response, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(f.disputeId, f.approvedBy, JSON.stringify(f.request), JSON.stringify(f.files), JSON.stringify(f.response), f.status, new Date().toISOString());
  }
  filings(disputeId: string): any[] {
    return (this.db.prepare("SELECT * FROM filings WHERE dispute_id = ? ORDER BY id").all(disputeId) as any[]).map((r) => ({ ...r, request: JSON.parse(r.request), files: JSON.parse(r.files), response: r.response && JSON.parse(r.response) }));
  }

  /** Returns false if this webhook event was already seen (PayPal retries deliveries). */
  recordEvent(id: string, type: string, verified: boolean, raw: unknown): boolean {
    const r = this.db.prepare("INSERT OR IGNORE INTO events (id, type, verified, received_at, raw) VALUES (?, ?, ?, ?, ?)").run(id, type, verified ? 1 : 0, new Date().toISOString(), JSON.stringify(raw));
    return Number(r.changes) > 0;
  }
  events(limit = 50): any[] {
    return this.db.prepare("SELECT id, type, verified, received_at AS receivedAt FROM events ORDER BY received_at DESC LIMIT ?").all(limit);
  }
}
