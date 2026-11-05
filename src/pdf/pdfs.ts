// PDFs ClaimPack generates: (1) a faithful PDF copy of a text document (PayPal accepts only PDF and images),
// (2) the evidence summary attached to every filing. Built with pdf-lib; standard fonts only (WinAnsi), so text is
// transliterated to plain ASCII first rather than dropped.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { REASON_LABEL } from "../rules/paypalRules";
import type { DisputeCase, EvidenceDoc, Fact, PackPlan } from "../types";

const A4: [number, number] = [595.28, 841.89];
const M = 50;

export function ascii(s: string): string {
  return s
    .replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[•·]/g, "*")
    .replace(/ /g, " ").replace(/\t/g, "    ")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private header: string, private fonts: { body: PDFFont; bold: PDFFont; mono: PDFFont }) { this.newPage(); }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
    this.page.drawText(ascii(this.header), { x: M, y: A4[1] - 30, size: 8, font: this.fonts.body, color: rgb(0.45, 0.45, 0.45) });
  }
  /** Writes wrapped text; returns nothing. */
  text(s: string, o: { size?: number; font?: "body" | "bold" | "mono"; color?: [number, number, number]; gap?: number; indent?: number } = {}) {
    const size = o.size ?? 10, font = this.fonts[o.font ?? "body"], width = A4[0] - 2 * M - (o.indent ?? 0);
    for (const para of ascii(s).split("\n")) {
      const words = para.split(/(\s+)/);
      let line = "";
      const flush = () => {
        if (this.y < M + size) this.newPage();
        this.page.drawText(line, { x: M + (o.indent ?? 0), y: this.y, size, font, color: rgb(...(o.color ?? [0.1, 0.1, 0.1])) });
        this.y -= size * 1.35;
        line = "";
      };
      for (const w of words) {
        if (font.widthOfTextAtSize(line + w, size) > width && line.trim()) flush();
        // a single word longer than the line (a URL, a hash): hard-break it
        let rest = line ? w : w.trimStart();
        while (font.widthOfTextAtSize(rest, size) > width) {
          let n = rest.length;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
          line = rest.slice(0, n); flush(); rest = rest.slice(n);
        }
        line += rest;
      }
      flush();
    }
    this.y -= o.gap ?? 4;
  }
}

async function fonts(doc: PDFDocument) {
  return { body: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), mono: await doc.embedFont(StandardFonts.Courier) };
}

/** A PDF copy of a text document, line for line, with the original file's name and fingerprint on every page. */
export async function textToPdf(name: string, text: string, sha256: string): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  doc.setTitle(name);
  doc.setProducer("ClaimPack");
  const w = new Writer(doc, `PDF copy of ${name} (original SHA-256 ${sha256.slice(0, 16)}...), made by ClaimPack without changes`, await fonts(doc));
  w.text(text, { font: "mono", size: 9, gap: 0 });
  return (await doc.save()) as Uint8Array<ArrayBuffer>;
}

/** The evidence summary that goes with every filing: what is claimed, which rule it meets, and where each fact is. */
export async function summaryPdf(d: DisputeCase, plan: PackPlan, facts: Fact[], docs: EvidenceDoc[], notes: string): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Evidence summary for dispute ${d.id}`);
  doc.setProducer("ClaimPack");
  const w = new Writer(doc, `Seller evidence summary - dispute ${d.id} - payment ${d.transaction.id}`, await fonts(doc));
  const name = new Map(docs.map((x) => [x.id, x.name]));
  w.text("Seller evidence summary", { size: 18, font: "bold", gap: 8 });
  w.text(`Dispute ${d.id}: ${REASON_LABEL[d.reason]} (${d.reason}), ${d.amount.value} ${d.amount.currency}`, { font: "bold" });
  w.text(`Payment ${d.transaction.id}${d.transaction.invoiceId ? `, invoice ${d.transaction.invoiceId}` : ""}, paid ${d.transaction.createTime.slice(0, 10)}${d.transaction.buyerName ? `, buyer ${d.transaction.buyerName}` : ""}`);
  w.text(`Evidence type: ${plan.evidenceType}`, { gap: 12 });
  w.text("Seller's statement", { size: 12, font: "bold" });
  w.text(notes, { gap: 12 });
  w.text("Facts relied on, with the exact words of each document", { size: 12, font: "bold" });
  for (const f of facts.filter((x) => plan.usedFactIds.includes(x.id))) {
    w.text(`${name.get(f.cite.docId) ?? f.cite.docId}${f.cite.page ? `, page ${f.cite.page}` : ""}:`, { font: "bold", size: 9, gap: 0 });
    w.text(`"${f.cite.quote}"`, { size: 9, indent: 12, gap: 6 });
  }
  w.text("Documents attached", { size: 12, font: "bold" });
  for (const x of docs.filter((x) => plan.documentIds.includes(x.id))) w.text(`${x.name}  (SHA-256 ${x.sha256})`, { size: 8, font: "mono", gap: 2 });
  return (await doc.save()) as Uint8Array<ArrayBuffer>;
}
