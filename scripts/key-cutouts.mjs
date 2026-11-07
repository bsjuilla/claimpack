// Usage: node scripts/key-cutouts.mjs <source-dir>
// Turns the flat #00FF00 (or #FF00FF, for objects with green on them) backgrounds of the cut-out photographs (cut-*.png)
// into transparency, removes the colour spill on the edges, trims to the object, and writes WebP with alpha to
// web/public/img. hero-*.png photographs are resized and converted as they are. Adapted from Filao Studio's script.
import sharp from "sharp";
import { readdirSync } from "node:fs";
import path from "node:path";

const [sourceDir] = process.argv.slice(2);
if (!sourceDir) { console.error("Usage: node scripts/key-cutouts.mjs <source-dir>"); process.exit(1); }
const outDir = path.join("web", "public", "img");
const CUT_WIDTH = 480; // displayed at up to ~210 px wide, so this covers 2x screens

for (const file of readdirSync(sourceDir).filter((f) => /^(cut|hero)-.*\.png$/i.test(f))) {
  const name = path.parse(file).name;
  const src = path.join(sourceDir, file);
  if (name.startsWith("hero-")) {
    await sharp(src).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(outDir, `${name}.webp`));
    console.log(`${name}.webp (photo)`);
    continue;
  }
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  const magenta = data[0] > 180 && data[2] > 180 && data[1] < 100; // screen colour, read from the top-left corner
  let [x0, y0, x1, y1] = [info.width, info.height, 0, 0];
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    let [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    // How far the pixel leans toward the screen colour: 0 on the object, ~255 on the screen.
    const spill = magenta ? Math.min(r, b) - g : g - Math.max(r, b);
    const a = spill <= 28 ? 255 : spill >= 110 ? 0 : Math.round(255 * (1 - (spill - 28) / 82));
    if (spill > 0) { if (magenta) { r -= spill; b -= spill; } else g = Math.max(r, b); } // no coloured fringe
    out[j] = Math.max(0, r); out[j + 1] = g; out[j + 2] = Math.max(0, b); out[j + 3] = a;
    if (a > 24) {
      const p = j / 4, x = p % info.width, y = (p / info.width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const pad = 6;
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  const width = Math.min(info.width, x1 + pad) - left, height = Math.min(info.height, y1 + pad) - top;
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width, height })
    .resize({ width: CUT_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(path.join(outDir, `${name}.webp`));
  console.log(`${name}.webp (${magenta ? "magenta" : "green"} screen, trimmed to ${width}x${height})`);
}
