// Builds the exact provide-evidence request PayPal receives. Measured in the sandbox on 5 Nov 2026: the endpoint takes
// multipart/form-data with an "input" JSON part plus one part per file, and documents[].name must match the file name.
import type { PackPlan } from "../types";

export interface EvidenceFile { name: string; mime: string; data: Uint8Array<ArrayBuffer> }

export function evidenceInput(plan: PackPlan, notes: string, files: EvidenceFile[]) {
  if (!plan.evidenceType) throw new Error("No evidence type chosen.");
  if (plan.verdict !== "READY") throw new Error(`Refusing to build a filing for a pack that is ${plan.verdict}.`);
  const info: Record<string, unknown> = {};
  if (plan.evidenceInfo.tracking_info?.length) info.tracking_info = plan.evidenceInfo.tracking_info;
  if (plan.evidenceInfo.refund_ids?.length) info.refund_ids = plan.evidenceInfo.refund_ids;
  return {
    evidences: [{
      evidence_type: plan.evidenceType,
      evidence_info: info,
      ...(files.length ? { documents: files.map((f) => ({ name: f.name })) } : {}),
      notes,
    }],
  };
}

export function evidenceForm(input: ReturnType<typeof evidenceInput>, files: EvidenceFile[]): FormData {
  const fd = new FormData();
  fd.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
  files.forEach((f, i) => fd.append(`file${i + 1}`, new Blob([f.data], { type: f.mime }), f.name));
  return fd;
}
