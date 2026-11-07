// Builds the evaluation documents from scripts/eval/cases.ts into eval/cases/<id>/ (PDF, PNG and text files),
// plus case.json (dispute + gold). Deterministic: running it twice gives the same files.
// Usage: npx tsx scripts/eval/build.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { CASES, type DocSpec } from "./cases";

const OUT = join(import.meta.dirname, "..", "..", "eval", "cases");
const STAMP = "SPECIMEN - SYNTHETIC DOCUMENT";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function pdf(title: string, lines: { text: string; bold?: boolean; size?: number; gap?: number }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date("2026-10-01T00:00:00Z")); doc.setModificationDate(new Date("2026-10-01T00:00:00Z"));
  const page = doc.addPage([595.28, 841.89]);
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(STAMP, { x: 380, y: 805, size: 8, font: b, color: rgb(0.7, 0.1, 0.1) });
  page.drawText(title, { x: 50, y: 770, size: 18, font: b, color: rgb(0.1, 0.12, 0.18) });
  let y = 740;
  for (const l of lines) {
    page.drawText(l.text, { x: 50, y, size: l.size ?? 10.5, font: l.bold ? b : f, color: rgb(0.12, 0.14, 0.2) });
    y -= l.gap ?? 17;
  }
  return doc.save();
}

async function png(svg: string, w: number, h: number): Promise<Buffer> {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`)).png().toBuffer();
}

async function render(d: DocSpec): Promise<Uint8Array | Buffer | string> {
  switch (d.kind) {
    case "delivery-log":
      return [`${STAMP}`, "Studio file delivery log (export)", `${d.order ? `Order ${d.order} | ` : ""}Client: ${d.client} <${d.email}>`,
        ...d.lines.map(([t, e]) => `${t}  ${e}`), ...(d.injection ? ["", d.injection] : []), ""].join("\n");
    case "refund-email":
      return [STAMP, "From: billing@studio.example", `Subject: Your refund has been sent`, "", `Hello,`, `We have refunded ${d.amount} USD to your PayPal account on ${d.date}.`,
        `Refund ID: ${d.refundId}`, "", "Kind regards,", "Studio billing", ""].join("\n");
    case "listing":
      return [STAMP, `Listing: ${d.title}`, "", ...d.body, ...(d.injection ? ["", d.injection] : []), ""].join("\n");
    case "invoice":
      return pdf("INVOICE", [
        { text: `Invoice no. ${d.invoice}`, bold: true }, { text: `Date: ${d.date}` }, { text: `Bill to: ${d.buyer}${d.email ? ` <${d.email}>` : ""}`, gap: 28 },
        { text: "Description", bold: true }, { text: `${d.item}`, gap: 22 }, { text: `Total paid: ${d.amount} USD`, bold: true, gap: 22 },
        { text: d.txn ? `Paid by PayPal, transaction ${d.txn}` : "Paid by PayPal" },
      ]);
    case "terms":
      return pdf(d.title, d.clauses.map((c, i) => ({ text: `${i + 1}. ${c}`, gap: 20 })));
    case "tracking-png": {
      const svg = `<rect width="900" height="520" fill="#ffffff"/><rect width="900" height="70" fill="#2f3b4c"/>
        <text x="30" y="45" font-family="Arial" font-size="26" fill="#ffffff" font-weight="bold">${esc(d.carrier)} tracking</text>
        <text x="610" y="45" font-family="Arial" font-size="14" fill="#ffb4b4">${STAMP}</text>
        <text x="30" y="120" font-family="Arial" font-size="16" fill="#555">Tracking number</text>
        <text x="30" y="150" font-family="Arial" font-size="24" fill="#111" font-weight="bold">${esc(d.number)}</text>
        <text x="30" y="215" font-family="Arial" font-size="34" fill="${d.status === "Delivered" ? "#1f7a4d" : "#9a5b00"}" font-weight="bold">${d.status}</text>
        <text x="30" y="255" font-family="Arial" font-size="18" fill="#222">${esc(d.at)}${d.status === "Delivered" ? ` · ${esc(d.city)}` : ""}</text>
        <line x1="30" y1="290" x2="870" y2="290" stroke="#dddddd"/>
        <text x="30" y="330" font-family="Arial" font-size="16" fill="#555">Recipient</text><text x="230" y="330" font-family="Arial" font-size="18" fill="#111">${esc(d.recipient)}</text>
        <text x="30" y="370" font-family="Arial" font-size="16" fill="#555">Destination</text><text x="230" y="370" font-family="Arial" font-size="18" fill="#111">${esc(d.city)}</text>
        ${d.order ? `<text x="30" y="410" font-family="Arial" font-size="16" fill="#555">Reference</text><text x="230" y="410" font-family="Arial" font-size="18" fill="#111">${esc(d.order)}</text>` : ""}`;
      return png(svg, 900, 520);
    }
    case "chat-png": {
      let y = 110;
      const bubbles = d.messages.map((m) => {
        const right = m.from === "seller", w = Math.min(560, 40 + m.text.length * 9.2), x = right ? 680 - w : 40;
        const out = `<rect x="${x}" y="${y}" width="${w}" height="64" rx="18" fill="${right ? "#d9f3e3" : "#eef1f4"}"/>
          <text x="${x + 18}" y="${y + 28}" font-family="Arial" font-size="17" fill="#111">${esc(m.text)}</text>
          <text x="${x + 18}" y="${y + 52}" font-family="Arial" font-size="12" fill="#777">${m.from === "seller" ? "You" : "Buyer"}, ${esc(m.at)}</text>`;
        y += 92;
        return out;
      }).join("");
      const h = y + 30;
      return png(`<rect width="720" height="${h}" fill="#ffffff"/><rect width="720" height="70" fill="#f4f6f8"/>
        <text x="30" y="44" font-family="Arial" font-size="22" fill="#111" font-weight="bold">Messages</text>
        <text x="420" y="44" font-family="Arial" font-size="13" fill="#b42318">${STAMP}</text>${bubbles}`, 720, h);
    }
  }
}

rmSync(OUT, { recursive: true, force: true });
for (const c of CASES) {
  const dir = join(OUT, c.id);
  mkdirSync(dir, { recursive: true });
  const docs = [];
  for (const d of c.docs) {
    const data = await render(d);
    writeFileSync(join(dir, d.name), data);
    docs.push({ name: d.name, kind: d.kind });
  }
  writeFileSync(join(dir, "case.json"), JSON.stringify({ id: c.id, title: c.title, trap: c.trap, dispute: c.dispute, refunds: c.refunds, docs, gold: c.gold }, null, 1));
}
console.log(`built ${CASES.length} cases, ${CASES.reduce((s, c) => s + c.docs.length, 0)} documents in eval/cases/`);
