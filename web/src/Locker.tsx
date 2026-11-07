import { useRef, useState } from "react";
import { post, remove, upload, type DocView } from "./api";
import { useToast } from "./App";
import { Cutout } from "./Cutout";

/** The seller's documents for one payment: add, read with AI, and see what each one contributed or why it was set aside. */
export function Locker({ txId, docs, unread, readPath, onChange }: { txId: string; docs: DocView[]; unread: number; readPath: string; onChange: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<"" | "upload" | "read">("");

  async function add(files: FileList | File[]) {
    if (!files.length) return;
    setBusy("upload");
    try {
      const r = await upload(txId, files);
      toast({ text: r.added.length ? `Added ${r.added.map((a) => a.name).join(", ")}.` : "Those files are already in the locker." });
      onChange();
    } catch (e) { toast({ text: (e as Error).message, error: true }); }
    finally { setBusy(""); }
  }

  async function read() {
    setBusy("read");
    try {
      const r = await post<{ costUsd: number }>(readPath);
      toast({ text: `Read ${unread} document${unread === 1 ? "" : "s"} with Muse Spark (${(r.costUsd * 100).toFixed(1)}¢ of API credit).` });
      onChange();
    } catch (e) { toast({ text: (e as Error).message, error: true }); }
    finally { setBusy(""); }
  }

  return (
    <section className="panel tabbed" aria-labelledby="locker-h">
      <div className="row locker-head" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        {docs.length > 0 && unread > 0 && <Cutout name="cut-loupe" />}
        <h2 id="locker-h" style={{ margin: 0 }}>Your documents</h2>
        <button className="btn primary" disabled={!unread || !!busy} onClick={read}>
          {busy === "read" ? "Reading…" : unread ? `Read ${unread} new document${unread === 1 ? "" : "s"}` : "All documents read"}
        </button>
      </div>
      <label className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}>
        <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.log,.eml,.md" onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ""; }} />
        {!docs.length && <Cutout name="cut-parcel" />}
        {busy === "upload" ? "Adding…" : <>Drop invoices, delivery records, messages or screenshots here, or <u>choose files</u>.<br /><span className="small muted">PDF, images or text. Text files get an exact PDF copy, because PayPal only accepts PDFs and images.</span></>}
      </label>
      {docs.length > 0 && (
        <ul className="docs">
          {docs.map((d) => (
            <li className="doc" key={d.id}>
              <a className="name" href={`/api/docs/${d.id}/file`} target="_blank" rel="noreferrer">{d.originalName}</a>
              <button className="btn link small" onClick={async () => { await remove(d.id); onChange(); }} aria-label={`Remove ${d.originalName}`}>Remove</button>
              <span className={`state${d.quarantined ? " bad" : d.read ? " good" : ""}`}>
                {d.quarantined ? "Set aside: it contains instructions aimed at an AI, so nothing from it is used"
                  : d.read ? `Read: ${d.read.facts.length} fact${d.read.facts.length === 1 ? "" : "s"} found${d.read.dropped.length ? `, ${d.read.dropped.length} incomplete line${d.read.dropped.length === 1 ? "" : "s"} skipped` : ""}`
                  : "Not read yet"}
                {d.originalMime === "text/plain" && " (sent to PayPal as a PDF copy)"}
              </span>
              {d.quarantined && d.read?.quarantineQuote && <span className="aside">“{d.read.quarantineQuote}”</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
