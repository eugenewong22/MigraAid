/**
 * Generates PWA icons (192px, 512px) into public/. Uses only vector shapes
 * (no text) so rendering is font-independent and reproducible.
 * Run with: pnpm icons
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Daybreak: the header's circle-with-flat-bottom sunrise mark, terracotta on
// cream (colors track globals.css --color-terracotta / --color-cream).
const svg = (size: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#faf6ef"/>
  <path d="M ${size * 0.22} ${size * 0.62}
           A ${size * 0.28} ${size * 0.28} 0 1 1 ${size * 0.78} ${size * 0.62}
           Z" fill="#b04f27"/>
  <circle cx="${size * 0.68}" cy="${size * 0.24}" r="${size * 0.06}" fill="#e8a13c"/>
</svg>`;

async function main() {
  const out = path.join(process.cwd(), "public");
  await mkdir(out, { recursive: true });
  for (const size of [192, 512]) {
    await sharp(Buffer.from(svg(size)))
      .png()
      .toFile(path.join(out, `icon-${size}.png`));
    console.log(`wrote public/icon-${size}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
