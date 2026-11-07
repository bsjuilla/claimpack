import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { get, post } from "./api";
import { Queue } from "./Queue";
import { CaseView } from "./CaseView";
import { Payments, PaymentLocker } from "./Payments";

type Toast = { text: string; error?: boolean } | null;
const ToastCtx = createContext<(t: Toast) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

function useHash() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => { setHash(location.hash || "#/"); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <path d="M9 8h10l4 4v12H9z" fill="none" stroke="var(--mark)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M12.5 18l2.5 2.5 5-5.5" fill="none" stroke="var(--paper)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function App() {
  const hash = useHash();
  const [toast, setToast] = useState<Toast>(null);
  const [health, setHealth] = useState<{ paypal: string; webhookConfigured: boolean; ai: boolean } | null>(null);
  const show = useCallback((t: Toast) => { setToast(t); if (t) setTimeout(() => setToast((cur) => (cur === t ? null : cur)), t.error ? 7000 : 3500); }, []);
  useEffect(() => { get<typeof health>("/api/health").then(setHealth).catch(() => setHealth(null)); }, []);

  const parts = hash.replace(/^#\//, "").split("/");
  let page;
  if (parts[0] === "disputes" && parts[1]) page = <CaseView id={decodeURIComponent(parts[1])} />;
  else if (parts[0] === "payments" && parts[1]) page = <PaymentLocker txId={decodeURIComponent(parts[1])} />;
  else if (parts[0] === "payments") page = <Payments />;
  else page = <Queue />;
  const section = parts[0] === "payments" ? "payments" : "disputes";

  return (
    <ToastCtx.Provider value={show}>
      <header className="bar">
        <a className="brand" href="#/"><Mark />ClaimPack</a>
        <nav className="nav" aria-label="Main">
          <a href="#/" aria-current={section === "disputes" ? "page" : undefined}>Disputes</a>
          <a href="#/payments" aria-current={section === "payments" ? "page" : undefined}>Payments</a>
        </nav>
        <span className="spacer" />
        <span className="env" title={health?.webhookConfigured ? "PayPal notifications are connected" : "PayPal notifications are not connected; use Sync with PayPal"}>
          <span className={`dot${health?.webhookConfigured ? "" : " off"}`} />
          {health ? (health.paypal === "sandbox" ? "PayPal sandbox" : "PayPal live") : "Server offline"}
        </span>
        <SyncButton />
      </header>
      <main id="main">{page}</main>
      {toast && <div className={`toast${toast.error ? " error" : ""}`} role="status">{toast.text}</div>}
    </ToastCtx.Provider>
  );
}

function SyncButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const r = await post<{ synced: number }>("/api/sync"); toast({ text: `Synced ${r.synced} dispute${r.synced === 1 ? "" : "s"} from PayPal.` }); }
      catch (e) { toast({ text: (e as Error).message, error: true }); }
      finally { setBusy(false); }
    }}>{busy ? "Syncing…" : "Sync with PayPal"}</button>
  );
}
