import { describe, expect, it } from "vitest";
import { bytesMatchExtension } from "../src/sniff";

const TEXT = new Set([".txt", ".csv", ".log", ".eml", ".md"]);
const enc = (s: string) => new TextEncoder().encode(s);

describe("upload bytes must match the extension", () => {
  it("accepts real PNG, PDF, JPEG and text", () => {
    expect(bytesMatchExtension(".png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), TEXT)).toBe(true);
    expect(bytesMatchExtension(".pdf", enc("%PDF-1.7\n"), TEXT)).toBe(true);
    expect(bytesMatchExtension(".jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), TEXT)).toBe(true);
    expect(bytesMatchExtension(".txt", enc("Delivered to front door, 4 Nov"), TEXT)).toBe(true);
  });
  it("refuses an HTML page named .png and an executable named .pdf", () => {
    expect(bytesMatchExtension(".png", enc("<html><script>alert(1)</script>"), TEXT)).toBe(false);
    expect(bytesMatchExtension(".pdf", enc("MZ\x90\x00"), TEXT)).toBe(false);
  });
  it("refuses binary or non-UTF-8 content named .txt", () => {
    expect(bytesMatchExtension(".txt", new Uint8Array([0x4d, 0x5a, 0x00, 0x01]), TEXT)).toBe(false);
    expect(bytesMatchExtension(".txt", new Uint8Array([0xc3, 0x28]), TEXT)).toBe(false);
  });
  it("refuses unknown extensions", () => {
    expect(bytesMatchExtension(".exe", enc("MZ"), TEXT)).toBe(false);
  });
});
