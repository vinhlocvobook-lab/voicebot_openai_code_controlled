#!/usr/bin/env node
// scripts/log-to-sequence.mjs
//
// CLI mong - doc 1 file log .txt do scripts/checkpoint-*.mjs / scripts/
// probe-*.mjs sinh ra, goi src/tools/log-to-sequence.js (PHAN LOGIC THUAN,
// da co test rieng) de sinh 1 sequenceDiagram (Mermaid), roi ghi ra 2 file
// cung thu muc: 1 file .mmd (nguon Mermaid thuan, dan duoc vao noi khac
// nhu mermaid.live/Notion/GitHub) va 1 file .html (tu mo duoc bang trinh
// duyet, khong can cai gi them - can mang de tai thu vien mermaid.js qua
// CDN, xem ghi chu trong toHtml()).
//
// Dung lai duoc cho MOI log tuong lai (Giai doan 6a, 7, 8, 9...), khong
// rieng gi log cua Giai doan 5a.
//
// CACH DUNG:
//   node scripts/log-to-sequence.mjs logs/checkpoint5a-XXXX.txt
//   (tuy chon) node scripts/log-to-sequence.mjs logs/checkpoint5a-XXXX.txt duong-dan-output-khong-duoi

import fs from "node:fs";
import path from "node:path";
import { parseCheckpointLog, toMermaid, toHtml } from "../src/tools/log-to-sequence.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Dung: node scripts/log-to-sequence.mjs <duong-dan-file-log.txt> [duong-dan-output-khong-duoi]");
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`log-to-sequence: khong tim thay file "${inputPath}"`);
  process.exit(1);
}

const text = fs.readFileSync(inputPath, "utf8");
const events = parseCheckpointLog(text);
const title = path.basename(inputPath);
const mermaidSource = toMermaid(events, { title });
const html = toHtml(mermaidSource, title);

const outBase = process.argv[3] || inputPath.replace(/\.txt$/, "");
const mmdPath = `${outBase}.sequence.mmd`;
const htmlPath = `${outBase}.sequence.html`;

fs.writeFileSync(mmdPath, mermaidSource, "utf8");
fs.writeFileSync(htmlPath, html, "utf8");

console.log(`[log-to-sequence] Da sinh: ${mmdPath}`);
console.log(`[log-to-sequence] Da sinh: ${htmlPath}`);
console.log(`[log-to-sequence] So dong trong sequenceDiagram: ${mermaidSource.split("\n").length}`);
