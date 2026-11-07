import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { get, post, onServerChange, ApiError, type CaseView as Case, type Check, type Draft, type Fact, type StatementCheck } from "./api";
import { useToast } from "./App";
import { gridTheme } from "./grid";
import { Locker } from "./Locker";
import { Cutout } from "./Cutout";
import { EVIDENCE_WORD, KIND_WORD, REASON_LABEL, STAGE_WORD, STATUS_WORD, VERDICT_WORD, day, money, when } from "./words";

export function CaseView({ id }: { id: string }) {
  const toast = useToast();
  const [kase, setKase] = useState<Case | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => get<Case>(`/api/disputes/${encodeURIComponent(id)}`).then((k) => { setKase(k); setError(""); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { void load(); return onServerChange((m) => { if (!m.id || m.id === id || m.what === "docs") void load(); }); }, [id, load]);

  if (error) return <div className="panel empty-state"><h2>This dispute could not be opened</h2><p>{error}</p><a href="#/">Back to disputes</a></div>;
  if (!kase) return <p className="muted">Loading the dispute from PayPal…</p>;
  const { dispute: d, plan } = kase;

  return (
    <>
      <p><a href="#/" className="small">All disputes</a></p>
      <header className="case-head">
        <div>
          <h1>{REASON_LABEL[d.reason] ?? d.reason}</h1>
          <div className="meta">
            <span><b>{money(d.amount.value, d.amount.currency)}</b> disputed</span>
            <span>Buyer <b>{d.transaction.buyerName ?? d.transaction.buyerEmail ?? "unknown"}</b></span>
            <span>Paid {day(d.transaction.createTime)}</span>
            <span>{STATUS_WORD[d.status] ?? d.status}</span>
            <span>{STAGE_WORD[d.stage] ?? d.stage}</span>
          </div>
          <div className="meta small"><span>Dispute <span className="mono">{d.id}</span></span><span>Payment <span className="mono">{d.transaction.id}</span></span>
            {d.transaction.invoiceId && <span>Invoice <span className="mono">{d.transaction.invoiceId}</span></span>}</div>
        </div>
        <div className="clock">
          <Cutout name="cut-hourglass" />
          {plan.daysLeft !== undefined ? <>
            <div className={`days${plan.daysLeft <= 3 ? " urgent" : ""}`}>{plan.daysLeft < 0 ? "Deadline passed" : `${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"}`}</div>
            <div className="small muted">{plan.daysLeft < 0 ? "" : "left to respond, "}until {day(d.sellerResponseDue)}</div>
          </> : <div className="small muted">PayPal gives no response deadline at this stage.</div>}
          <button className="btn link small" onClick={async () => { try { setKase(await post<Case>(`/api/disputes/${encodeURIComponent(id)}/refresh`)); toast({ text: "Updated from PayPal." }); } catch (e) { toast({ text: (e as Error).message, error: true }); } }}>Refresh from PayPal</button>
        </div>
      </header>

      {kase.held && <div className="hold"><b>PayPal is holding {money(kase.held.amount, kase.held.currency)}</b><span className="muted">of this payment while the dispute is open.</span></div>}
      {d.buyerStatement && <p className="buyer-words" style={{ marginBottom: 24 }}>The buyer wrote: “{d.buyerStatement}”</p>}

      <div className="split">
        <Pack kase={kase} />
        <Locker txId={d.transaction.id} docs={kase.docs} unread={kase.unread} readPath={`/api/disputes/${encodeURIComponent(id)}/read`} onChange={load} />
      </div>

      <Facts facts={kase.facts} docs={kase.docs} used={plan.usedFactIds} />
      <Filing kase={kase} id={id} onFiled={setKase} />
    </>
  );
}

/** The verdict and PayPal's requirements as slots, each filled with the exact words that satisfy it. */
function Pack({ kase }: { kase: Case }) {
  const { plan, facts, docs } = kase;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const docName = new Map(docs.map((x) => [x.id, x.originalName]));
  const slots = plan.checks.filter((c) => c.required || c.id.startsWith("rec-"));
  const notices = plan.checks.filter((c) => !slots.includes(c));
  return (
    <section aria-labelledby="pack-h" className="tabbed">
      <div className={`verdict v-${plan.verdict}`}>
        <Cutout key={plan.verdict} name={({ READY: "cut-folder-ready", INCOMPLETE: "cut-folder-missing", CONFLICT: "cut-receipts-conflict", NO_DEFENCE: "cut-folder-empty" })[plan.verdict]} />
        <div id="pack-h" className="word">{VERDICT_WORD[plan.verdict]}</div>
        <p className="why">{plan.evidenceType ? <>Filed as <b>{EVIDENCE_WORD[plan.evidenceType]}</b>, the evidence PayPal accepts for this reason. </> : null}{plan.verdict === "READY" ? plan.suggestion ?? "" : plan.suggestion}</p>
        <div className="meter"><div className="track"><div className="fill" style={{ width: `${plan.completeness}%` }} /></div><span>{plan.completeness}% of what PayPal asks for</span></div>
      </div>
      <div className="slots">
        {slots.length === 0 && <div className="slot missing"><span className="tick" /><span className="label">Add documents to see what PayPal needs</span></div>}
        {slots.map((c) => <Slot key={c.id} c={c} byId={byId} docName={docName} />)}
      </div>
      {notices.length > 0 && (
        <div className="notices">
          {notices.map((c) => <p key={c.id} className={`notice${c.status === "conflict" ? " conflict" : ""}`}><b>{c.label}.</b> {c.detail}</p>)}
        </div>
      )}
    </section>
  );
}

function Slot({ c, byId, docName }: { c: Check; byId: Map<string, Fact>; docName: Map<string, string> }) {
  const quotes = c.factIds.map((id) => byId.get(id)).filter(Boolean) as Fact[];
  return (
    <div className={`slot ${c.status}`}>
      <span className="tick" aria-label={c.status}>{c.status === "ok" ? "✓" : c.status === "conflict" ? "!" : ""}</span>
      <span className="label">{c.label}{!c.required && <span className="opt">, strengthens the case</span>}</span>
      {c.status === "ok" && quotes.length > 0 ? (
        <div className="quotes">
          {quotes.slice(0, 3).map((f) => (
            <div className="quote" key={f.id}><q>{f.cite.quote}</q><span className="src">{docName.get(f.cite.docId) ?? f.cite.docId}{f.cite.page ? `, page ${f.cite.page}` : ""}</span></div>
          ))}
          {quotes.length > 3 && <span className="small muted">and {quotes.length - 3} more</span>}
        </div>
      ) : c.status === "missing" ? <div className="empty">{c.detail}</div> : <span className="detail">{c.detail}</span>}
    </div>
  );
}

function Facts({ facts, docs, used }: { facts: Fact[]; docs: Case["docs"]; used: string[] }) {
  const name = useMemo(() => new Map(docs.map((d) => [d.id, d.originalName])), [docs]);
  const setAside = useMemo(() => new Set(docs.filter((d) => d.quarantined).map((d) => d.id)), [docs]);
  const cols = useMemo<ColDef<Fact>[]>(() => [
    { headerName: "Used", width: 110, valueGetter: (p) => (setAside.has(p.data!.cite.docId) ? "Set aside" : used.includes(p.data!.id) ? "Yes" : "No"),
      cellStyle: (p) => ({ color: p.value === "Yes" ? "var(--ready)" : p.value === "Set aside" ? "var(--conflict)" : "var(--ink-3)", fontWeight: 600 }) },
    { headerName: "What", width: 150, valueGetter: (p) => KIND_WORD[p.data!.kind] ?? p.data!.kind },
    { headerName: "When", width: 190, valueGetter: (p) => ("at" in p.data! ? p.data!.at ?? "" : ""), valueFormatter: (p) => when(p.value) },
    { headerName: "Exact words in the document", flex: 2, minWidth: 320, valueGetter: (p) => p.data!.cite.quote, wrapText: true, autoHeight: true, cellStyle: { fontFamily: "var(--serif)", fontSize: "15px", lineHeight: "1.45", paddingTop: "8px", paddingBottom: "8px" } },
    { headerName: "Document", flex: 1, minWidth: 160, valueGetter: (p) => name.get(p.data!.cite.docId) ?? p.data!.cite.docId },
  ], [name, used, setAside]);
  if (!facts.length) return null;
  return (
    <section className="section" aria-labelledby="facts-h">
      <div className="facts-head">
        <Cutout name="cut-receipt-highlight" />
        <h2 id="facts-h">Everything the documents say</h2>
        <p className="muted small">Read by Muse Spark. Each line keeps the exact words it came from; the checks above decide which ones count.</p>
      </div>
      <div className="grid-wrap short"><AgGridReact<Fact> theme={gridTheme()} rowData={facts} columnDefs={cols} getRowId={(p) => p.data.id} /></div>
    </section>
  );
}

/** Statement, guard, the exact request, and the approval. Nothing goes to PayPal without a named person. */
function Filing({ kase, id, onFiled }: { kase: Case; id: string; onFiled: (k: Case) => void }) {
  const toast = useToast();
  const { plan } = kase;
  const [statement, setStatement] = useState("");
  const [check, setCheck] = useState<StatementCheck | null>(null);
  const [busy, setBusy] = useState<"" | "draft" | "check" | "file">("");
  const [name, setName] = useState("");
  const [sure, setSure] = useState(false);

  useEffect(() => {
    if (!statement.trim()) { setCheck(null); return; }
    const t = setTimeout(async () => {
      try { setCheck(await post<StatementCheck>(`/api/disputes/${encodeURIComponent(id)}/check-statement`, { statement })); } catch { /* shown on filing */ }
    }, 350);
    return () => clearTimeout(t);
  }, [statement, id, kase.planHash]);

  const files = ["evidence-summary.pdf", ...plan.documentIds.map((d) => kase.docs.find((x) => x.id === d)?.name ?? d)];
  const request = plan.evidenceType ? { evidences: [{ evidence_type: plan.evidenceType, evidence_info: { ...(plan.evidenceInfo.tracking_info ? { tracking_info: plan.evidenceInfo.tracking_info } : {}), ...(plan.evidenceInfo.refund_ids ? { refund_ids: plan.evidenceInfo.refund_ids } : {}) }, documents: files.map((n) => ({ name: n })), notes: check?.notes ?? "(the statement, once written)" }] } : null;
  const canFile = plan.verdict === "READY" && plan.canFileNow && !!check?.ok && name.trim().length > 1 && sure && busy === "";

  async function draft() {
    setBusy("draft");
    try { const r = await post<Draft>(`/api/disputes/${encodeURIComponent(id)}/draft`); setStatement(r.statement); setCheck(r.check); toast({ text: `Drafted with Muse Spark (${(r.costUsd * 100).toFixed(1)}¢). Every sentence is checked against your documents.` }); }
    catch (e) { toast({ text: (e as Error).message, error: true }); }
    finally { setBusy(""); }
  }
  async function file() {
    setBusy("file");
    try {
      const r = await post<{ ok: boolean; case: Case }>(`/api/disputes/${encodeURIComponent(id)}/file`, { statement, approvedBy: name, planHash: kase.planHash });
      onFiled(r.case);
      toast({ text: "Evidence filed with PayPal." });
    } catch (e) {
      const body = e instanceof ApiError ? e.body : null;
      if (body?.problems) setCheck({ ok: false, problems: body.problems, notes: check?.notes ?? "" });
      toast({ text: (e as Error).message, error: true });
    } finally { setBusy(""); }
  }

  return (
    <section className="section" aria-labelledby="file-h">
      <h2 id="file-h">Statement to PayPal and approval</h2>
      {kase.filings.length > 0 && kase.filings.map((f) => (
        <div key={f.id} className={`filed${f.status === 200 ? "" : " failed"}`}>
          {f.status === 200 ? <b>Filed with PayPal</b> : <b>PayPal refused this filing ({f.status})</b>} on {new Date(f.at).toLocaleString("en-GB")}, approved by {f.approved_by}. Sent {f.files.map((x) => x.name).join(", ")}.
          {f.status !== 200 && f.response?.details && <> PayPal said: <span className="mono">{f.response.details.map((x: any) => x.issue).join(", ")}</span></>}
        </div>
      ))}
      {kase.context.sellerEvidenceFiled.length > 0 && kase.filings.length === 0 && (
        <div className="filed">PayPal already has seller evidence on this dispute ({kase.context.sellerEvidenceFiled.map((e) => EVIDENCE_WORD[e.type] ?? e.type).join(", ")}). PayPal accepts one filing per stage.</div>
      )}
      <div className="file-grid" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h3>Your statement</h3>
            <button className="btn" disabled={plan.verdict !== "READY" || busy !== ""} onClick={draft}>{busy === "draft" ? "Drafting…" : statement ? "Draft again" : "Draft from the evidence"}</button>
          </div>
          {plan.verdict !== "READY" && <p className="small muted">A statement is drafted once the pack is ready to file.</p>}
          <textarea value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="The statement PayPal reads. Draft it from the evidence, then edit as you like: each sentence must keep its [F1] reference and only use what the documents say." aria-label="Statement to PayPal" />
          {check && (check.ok ? <p className="passed" style={{ marginTop: 8 }}>Every sentence is backed by your documents.</p>
            : <ul className="problems">{check.problems.map((p, i) => <li key={i}>{p.problem}{p.sentence && <>: <span>“{p.sentence}”</span></>}</li>)}</ul>)}
        </div>
        <div className="panel">
          <h3 style={{ marginBottom: 10 }}>Exactly what PayPal will receive</h3>
          {request ? <pre className="request">{JSON.stringify(request, null, 2)}</pre> : <p className="muted small">Nothing to send yet.</p>}
          <p className="small muted" style={{ marginTop: 8 }}>Plus the files listed, sent to PayPal's provide-evidence endpoint. <a href={`/api/disputes/${encodeURIComponent(id)}/summary.pdf?notes=${encodeURIComponent(check?.notes ?? "")}`} target="_blank" rel="noreferrer">Preview the evidence summary PDF</a></p>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="row" style={{ alignItems: "flex-end", gap: 20 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 14 }}>Approved by<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></label>
          <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I have read the statement and the documents, and they are true. PayPal takes one evidence filing at this stage.</label>
          <button className="btn primary" disabled={!canFile} onClick={file}>{busy === "file" ? "Filing…" : "File evidence with PayPal"}</button>
        </div>
        {!plan.canFileNow && <p className="small muted" style={{ marginTop: 10 }}>PayPal is not accepting evidence on this dispute right now{kase.context.sellerEvidenceFiled.length ? " (evidence was already filed)" : ""}.</p>}
      </div>
    </section>
  );
}
