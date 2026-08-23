#!/usr/bin/env node
// scripts/gen-sample-5b.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Tao 1 file WAV mau MOI cho
// checkpoint-giai-doan-5b-audio.mjs bang TTS THAT (OpenAI audio/speech),
// thay vi phai tu ghi am tay. Kho samples/ hien co chi co mau cho danh bo
// 22082351775 (CUSTOMER_NOT_FOUND trong moi truong test hien tai - da xac
// nhan khi test billing.js/outages.js) - chua co mau nao cho 22023251775
// (danh bo CO du lieu that, da dung de xac nhan billing.js/tool-router.js).
// Muon checkpoint audio chung minh duoc du lieu THAT (khong chi nhanh loi
// CUSTOMER_NOT_FOUND) chay qua duong audio+VAD, can 1 mau moi.
//
// Doc SO DANH BO tach TUNG CHU SO (vd "hai hai khong hai ba..." thay vi co
// the bi TTS doc gop thanh so lon "hai muoi hai nghin...") - giong cach
// nguoi that thuong doc 1 ma danh bo qua dien thoai, tranh sai lech noi
// dung so voi kich ban van ban (checkpoint-giai-doan-5b.mjs#USER_TEXT).
//
// response_format: "wav" - theo tai lieu OpenAI day la PCM 16-bit boc WAV
// header, cung sample rate 24000Hz Realtime API dung noi bo - CO THE da
// khop san dinh dang can (mono/16-bit/24000Hz), nhung KHONG doan chac o
// day. checkpoint-giai-doan-5b-audio.mjs (ke thua readWavPcm16 tu ban 5a)
// se tu in ra dung sample rate/so kenh/bit doc duoc tu file THAT ngay dong
// log dau tien - nhin dong do de biet co can convert bang ffmpeg khong (vd
// `ffmpeg -i samples/5b_..._raw.wav -ar 24000 -ac 1 -sample_fmt s16
// samples/5b_hoi_tien_nuoc_22023251775_24k.wav`), khong can doan truoc.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env):
//   node scripts/gen-sample-5b.mjs
// Sau khi chay xong, NGHE THU file trong samples/ truoc khi dung cho
// checkpoint - xac nhan TTS doc DUNG tung chu so cua danh bo (khong bi
// gop/nuot/doc sai chu so nao) - day la buoc kiem tra bang tai, khong co
// cach nao tu dong hoa duoc.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("[gen-sample-5b] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";

// Doc DUNG cau, DUNG danh bo voi checkpoint-giai-doan-5b.mjs (ban text) -
// chi khac o cho so danh bo doc tach tung chu so cho TTS (xem ghi chu dau
// file). Danh bo 22023251775 -> 2 2 0 2 3 2 5 1 7 7 5 (11 chu so).
const TTS_INPUT =
  "Xin chào, cho tôi hỏi hóa đơn tiền nước tháng này với. " +
  "Mã danh bộ của tôi là hai hai không hai ba hai năm một bảy bảy năm.";

const outDir = path.join(__dirname, "..", "samples");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "5b_hoi_tien_nuoc_22023251775_24k.wav");

console.log(`[gen-sample-5b] Goi OpenAI TTS (model=${TTS_MODEL}, voice=${TTS_VOICE})...`);
console.log(`[gen-sample-5b] Noi dung: "${TTS_INPUT}"`);

const res = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: TTS_INPUT,
    response_format: "wav",
  }),
});

if (!res.ok) {
  const body = await res.text().catch(() => "");
  console.error(`[gen-sample-5b] OpenAI TTS tra loi HTTP ${res.status}: ${body.slice(0, 500)}`);
  process.exit(1);
}

const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(outPath, buf);
console.log(`[gen-sample-5b] Da luu ${outPath} (${buf.length} bytes).`);
console.log(
  "[gen-sample-5b] TIEP THEO: (1) nghe thu file de xac nhan doc DUNG danh bo, " +
    "(2) chay: node scripts/checkpoint-giai-doan-5b-audio.mjs " +
    `${path.relative(path.join(__dirname, ".."), outPath)}`,
);
