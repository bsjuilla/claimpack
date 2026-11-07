import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { get, post, onServerChange, type DocView, type PaymentRow } from "./api";
import { useToast } from "./App";
import { gridTheme } from "./grid";
import { Locker } from "./Locker";
import { day, money } from "./words";

/** Every payment ClaimPack has seen, with its evidence locker: filled when the sale happens, long before any dispute. */
export function Payments() {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  useEffect(() => {
    const load = () => get<PaymentRow[]>("/api/payments").then(setRows).catch(() => setRows([]));
    load();
    return onServerChange((m) => { if (["payments", "docs", "disputes", "dispute"].includes(m.what)) load(); });
  }, []);
  const cols = useMemo<ColDef<PaymentRow>[]>(() => [
    { headerName: "Paid", width: 140, sort: "desc", valueGetter: (p) => p.data!.capturedAt ?? p.data!.armedAt, valueFormatter: (p) => day(p.value) },
    { headerName: "Your invoice", width: 150, valueGetter: (p) => p.data!.invoiceId ?? "", cellClass: "mono" },
    { headerName: "Amount", width: 130, type: "rightAligned", valueGetter: (p) => Number(p.data!.amount ?? 0), valueFormatter: (p) => money(p.data?.amount, p.data?.currency) },
    { headerName: "Buyer", flex: 1, minWidth: 200, field: "payer" },
    { headerName: "Documents kept", width: 150, field: "docs", type: "rightAligned" },
    { headerName: "Dispute", width: 200, valueGetter: (p) => p.data!.disputeId ?? "None", cellStyle: (p) => ({ color: p.value === "None" ? "var(--ink-3)" : "var(--conflict)", fontWeight: p.value === "None" ? 400 : 600 }) },
    { headerName: "Payment", width: 190, field: "txId", cellClass: "mono" },
  ], []);
  return (
    <>
      <div className="head">
        <div>
          <h1>Payments</h1>
          <p className="lede">Keep the proof when you are paid, not when a buyer complains. Each payment has a locker for its invoice, delivery record and messages, so a dispute arrives with its evidence already in place.</p>
        </div>
      </div>
      <div className="split" style={{ gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1fr)" }}>
        <div className="grid-wrap">
          <AgGridReact<PaymentRow> theme={gridTheme()} rowData={rows ?? undefined} loading={!rows} columnDefs={cols} getRowId={(p) => p.data.txId}
            onRowClicked={(e) => { if (e.data) location.hash = `#/payments/${e.data.txId}`; }} rowStyle={{ cursor: "pointer" }}
            overlayNoRowsTemplate="No payments yet. Make a test sale on the right." />
        </div>
        <TestSale />
      </div>
    </>
  );
}

/** A sandbox sale carrying the seller's own invoice number, so the evidence can be matched to the payment later. */
function TestSale() {
  const toast = useToast();
  const [item, setItem] = useState("Logo design, 3 concepts (digital delivery)");
  const [amount, setAmount] = useState("120.00");
  const [invoiceId, setInvoiceId] = useState(`INV-${1000 + Math.floor(Math.random() * 9000)}`);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel" aria-labelledby="sale-h">
      <h2 id="sale-h">Make a test sale</h2>
      <p className="small muted">Uses the PayPal sandbox: no real money. You approve it as the sandbox buyer, then return here.</p>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 14 }}>What was sold<input type="text" value={item} onChange={(e) => setItem(e.target.value)} /></label>
        <div className="row">
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>Amount (USD)<input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ minWidth: 0, width: 120 }} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>Your invoice number<input type="text" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} style={{ minWidth: 0, width: 150 }} /></label>
        </div>
        <button className="btn primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { const r = await post<{ approveUrl: string }>("/api/demo/order", { item, amount, invoiceId }); location.href = r.approveUrl; }
          catch (e) { toast({ text: (e as Error).message, error: true }); setBusy(false); }
        }}>{busy ? "Opening PayPal…" : "Pay with the sandbox buyer"}</button>
      </div>
    </section>
  );
}

export function PaymentLocker({ txId }: { txId: string }) {
  const [data, setData] = useState<{ payment: PaymentRow; disputeId: string | null; docs: DocView[] } | null>(null);
  const load = useCallback(() => get<typeof data>(`/api/payments/${encodeURIComponent(txId)}`).then(setData), [txId]);
  useEffect(() => { void load(); return onServerChange((m) => { if (m.what !== "disputes") void load(); }); }, [load]);
  if (!data) return <p className="muted">Loading…</p>;
  const p = data.payment;
  return (
    <>
      <p><a href="#/payments" className="small">All payments</a></p>
      <div className="head">
        <div>
          <h1>{p.amount ? money(p.amount, p.currency) : "Payment"}{p.invoiceId ? `, invoice ${p.invoiceId}` : ""}</h1>
          <div className="meta row small muted" style={{ marginTop: 8 }}>
            <span>Payment <span className="mono">{p.txId}</span></span>{p.payer && <span>Buyer {p.payer}</span>}{p.capturedAt && <span>Paid {day(p.capturedAt)}</span>}
          </div>
        </div>
        {data.disputeId ? <a className="btn primary" href={`#/disputes/${encodeURIComponent(data.disputeId)}`}>Open the dispute on this payment</a>
          : <span className="small muted">No dispute on this payment. Anything you add now is ready if one comes.</span>}
      </div>
      <Locker txId={p.txId} docs={data.docs} unread={data.docs.filter((d) => !d.read).length} readPath={`/api/payments/${encodeURIComponent(p.txId)}/read`} onChange={load} />
    </>
  );
}
