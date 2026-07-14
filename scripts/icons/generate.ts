/**
 * Generates PWA icons (192px, 512px) into public/. Uses only vector shapes
 * (no text) so rendering is font-independent and reproducible.
 * Run with: pnpm icons
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const svg = (size: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#2563eb"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.28}" fill="#ffffff"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.13}" fill="#2563eb"/>
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
