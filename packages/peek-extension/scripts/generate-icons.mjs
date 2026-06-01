#!/usr/bin/env node
// Generates peek extension PNG icons from the brand SVG mark.
// Run with: pnpm --filter @peekdev/extension generate:icons
// Re-run whenever assets/brand/sub-peek.svg changes.

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icon');

await mkdir(outDir, { recursive: true });

const SIZES = [16, 32, 48, 96, 128];

function iconSvg(size) {
  const pad = Math.round(size * 0.15);
  const inner = size - pad * 2;
  const cx = size / 2;
  const cy = size / 2;
  // Eye half-width and half-height derived from v4 mark proportions (96:72 ratio)
  const rx = inner / 2;
  const ry = inner * 0.375;
  const irisR = (inner * 0.109).toFixed(1);
  const pupilR = Math.max(1, inner * 0.031).toFixed(1);
  const sw = Math.max(1, size * 0.047).toFixed(1);
  const cornerR = (size * 0.2).toFixed(1);

  const lx = (cx - rx).toFixed(1);
  const rx2 = (cx + rx).toFixed(1);
  const top = (cy - ry).toFixed(1);
  const bot = (cy + ry).toFixed(1);
  const cxs = cx.toFixed(1);
  const cys = cy.toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${cornerR}" fill="#4A6B82"/>
  <g fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${lx} ${cys} Q${cxs} ${top} ${rx2} ${cys} Q${cxs} ${bot} ${lx} ${cys} Z"/>
    <circle cx="${cxs}" cy="${cys}" r="${irisR}"/>
  </g>
  <circle cx="${cxs}" cy="${cys}" r="${pupilR}" fill="#fff"/>
</svg>`;
}

for (const size of SIZES) {
  const svg = iconSvg(size);
  const outPath = join(outDir, `${size}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`✓ ${size}.png`);
}

console.log('Done — extension icons written to public/icon/');
