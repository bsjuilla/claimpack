// Check that a file's bytes are what its extension says, before it is stored or sent to PayPal.
// A renamed executable or an HTML page named .png is refused at upload.

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  ".pdf": (b) => starts(b, ascii("%PDF-")),
  ".png": (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ".jpg": (b) => starts(b, [0xff, 0xd8, 0xff]),
  ".jpeg": (b) => starts(b, [0xff, 0xd8, 0xff]),
  ".gif": (b) => starts(b, ascii("GIF87a")) || starts(b, ascii("GIF89a")),
  ".webp": (b) => starts(b, ascii("RIFF")) && starts(b, ascii("WEBP"), 8),
};

/** True when the bytes match the extension. Text files must be UTF-8 with no NUL bytes. */
export function bytesMatchExtension(ext: string, bytes: Uint8Array, textExts: Set<string>): boolean {
  const sig = SIGNATURES[ext];
  if (sig) return sig(bytes);
  if (!textExts.has(ext)) return false;
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}
