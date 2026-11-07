// Builds the exact provide-evidence request PayPal receives. Measured in the sandbox on 5 Nov 2026: the endpoint takes
// multipart/form-data with an "input" JSON part plus one part per file, and documents[].name must match the file name.
import { ALLOWED_MIME, MAX_CALL_BYTES, MAX_FILE_BYTES } from "../rules/paypalRules";
import type { PackPlan } from "../types";

export interface EvidenceFile { name: string; mime: string; data: Uint8Array<ArrayBuffer> }

/** PayPal's schema for documents[].name: letters, digits, "-", "_", ",", spaces, then one dot and a letter extension. */
export const PAYPAL_DOC_NAME = /^[A-Za-z0-9-_,\s]+[.]{1}[A-Za-z]+$/;

/** One PayPal-safe name per file, in order, never two the same ("receipt (1).pdf" -> "receipt 1.pdf"). */
export function paypalFileNames(files: Pick<EvidenceFile, "name">[]): string[] {
  const seen = new Set<string>();
  return files.map((f) => {
    const dot = f.name.lastIndexOf(".");
    const ext = (dot > 0 ? f.name.slice(dot + 1) : "pdf").replace(/[^A-Za-z]/g, "").slice(0, 5) || "pdf";
    const stem = (dot > 0 ? f.name.slice(0, dot) : f.name).replace(/[^A-Za-z0-9\-_, ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "document";
    let name = `${stem}.${ext}`;
    for (let i = 2; seen.has(name.toLowerCase()); i++) name = `${stem}-${i}.${ext}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** Refuses anything PayPal documents as unacceptable, checked on the actual bytes being sent (reviews A05, B1, B4). */
function checkFiles(files: EvidenceFile[]) {
  let total = 0;
  for (const f of files) {
    if (!ALLOWED_MIME.has(f.mime)) throw new Error(`${f.name}: PayPal only accepts JPG, GIF, PNG and PDF files.`);
    if (f.data.length > MAX_FILE_BYTES) throw new Error(`${f.name} is ${(f.data.length / 1048576).toFixed(1)} MB; PayPal takes files under 10 MB.`);
    total += f.data.length;
  }
  if (total > MAX_CALL_BYTES) throw new Error(`The files total ${(total / 1048576).toFixed(1)} MB; PayPal takes up to 50 MB per filing.`);
}

export function evidenceInput(plan: PackPlan, notes: string, files: EvidenceFile[]) {
  if (!plan.evidenceType) throw new Error("No evidence type chosen.");
  if (plan.verdict !== "READY") throw new Error(`Refusing to build a filing for a pack that is ${plan.verdict}.`);
  checkFiles(files);
  const info: Record<string, unknown> = {};
  if (plan.evidenceInfo.tracking_info?.length) info.tracking_info = plan.evidenceInfo.tracking_info;
  if (plan.evidenceInfo.refund_ids?.length) info.refund_ids = plan.evidenceInfo.refund_ids;
  const names = paypalFileNames(files);
  return {
    evidences: [{
      evidence_type: plan.evidenceType,
      evidence_info: info,
      ...(files.length ? { documents: names.map((name) => ({ name })) } : {}),
      notes,
    }],
  };
}

export function evidenceForm(input: ReturnType<typeof evidenceInput>, files: EvidenceFile[]): FormData {
  checkFiles(files);
  const names = paypalFileNames(files); // the same names as in the input part, in the same order
  const fd = new FormData();
  fd.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
  files.forEach((f, i) => fd.append(`file${i + 1}`, new Blob([f.data], { type: f.mime }), names[i]));
  return fd;
}
