#!/usr/bin/env node
// scripts/gen-sample-confirm-ngat-quang.mjs
//
// Giai doan 6b (xem docs/roadmap.md muc "Giai doan 6b"). Tao 1 file WAV MOI
// bang TTS THAT - dung LAI Y HET ky thuat da xac nhan hoat dong tot o
// gen-sample-6a.mjs/gen-sample-5b.mjs (model gpt-4o-mini-tts, voice alloy,
// response_format "wav").
//
// LY DO CAN FILE NAY (25/08/2026, cau hoi that tu chu du an): scripts/
// probe-confirm-danh-bo.mjs (chay 24/08/2026) moi chi thu 1 kich ban - khach
// tra loi "Dạ đúng rồi ạ." LIEN MACH, KHONG ngung giua chung (dung
// samples/6a_xac_nhan_dung.wav co san). Nhung danh-bo-flow.js (Giai doan 6a)
// va createReadbackMatcher() (Giai doan 6b, danh-bo-readback-match.js) CHUA
// tung duoc kiem chung khi CHINH cau tra loi xac nhan cua khach (khong phai
// cau doc so) bi VAD tach thanh NHIEU manh (khach tra loi ngat quang, vd
// "Dạ... (ngung 1 chut)... đúng rồi ạ."). Giai doan 1 da co bang chung THAT
// rang VAD tach luot noi khi co khoang ngung tu nhien (xem docs/fix/
// giai_doan_1_quan_sat_event_that_20260820.md, thi nghiem A/B) - NHUNG chi
// kiem chung cho luot DOC SO (11 chu so, cau dai), CHUA kiem chung cho 1 cau
// TRA LOI NGAN (xac nhan/tu choi) - do dai cau khac han co the anh huong toi
// viec VAD co tach hay khong (chua biet truoc, phai chay thu).
//
// Text co "..." (dau ba cham) o giua CO Y - dung DUNG cach da tao ra khoang
// ngung tu nhien trong cac file .wav dung o Giai doan 1/6a (tuy nhien LUU Y:
// cac file 2_.../3_.../6_ngap_ngung.wav goc la NGUOI THAT ghi am, KHONG phai
// TTS - CHUA CO bang chung TTS (gpt-4o-mini-tts) co tao duoc khoang ngung du
// dai de VAD tach hay khong, day chinh la 1 phan cau hoi can probe tra loi).
//
// KET QUA THAT (25/08/2026): chay thu, nghe lai - TTS (gpt-4o-mini-tts,
// voice alloy) DOC LIEN MACH ca 2 cum "Dạ..." va "đúng rồi ạ", KHONG tao ra
// khoang ngung du ro/du dai (dau "..." khong duoc TTS nay the hien thanh im
// lang dang ke). => Script nay KHONG dung duoc de kiem chung kich ban ngat
// quang - CHU DU AN da tu GHI AM THAT 3 file thay the (dung quy uoc nhu
// 2_.../3_.../6_ngap_ngung.wav goc cua Giai doan 1 - NGUOI THAT doc, khong
// phai TTS): samples/6b_xac_nhan_ngat_quang.wav,
// samples/6b_xac_nhan_ngat_quang_noise1.wav,
// samples/6b_xac_nhan_ngat_quang_noise2.wav (2 file sau co tap am nen, dat
// ten theo dung quy uoc _noise{N} cua Giai doan 6a). GIU LAI script nay
// trong repo lam bang chung/tai lieu (khong xoa) nhung KHONG con dung de tao
// file .wav that su dung cho probe nua - dung 3 file NGUOI GHI AM o tren.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env):
//   node scripts/gen-sample-confirm-ngat-quang.mjs
// Sau khi chay xong, NGHE THU file trong samples/ - xac nhan CO nghe ro 1
// khoang ngung/im lang giua "Dạ..." va "...đúng rồi ạ." hay khong (neu TTS
// doc lien mach khong ngung, file nay se KHONG dung de kiem chung duoc kich
// ban ngat quang - can thu lai voi text/dau cau khac, KHONG doan truoc).

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("[gen-sample-confirm-ngat-quang] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";

const outName = "6b_xac_nhan_ngat_quang.wav";
// Dau "..." + xuong dong y (khoang dung ro rang giua 2 cum) - mo phong khach
// ngung lai suy nghi giua chung cau tra loi xac nhan.
const text = "Dạ... để em xem lại đã... Dạ, đúng rồi ạ.";

const FORCE = process.argv.includes("--force");
const outDir = path.join(__dirname, "..", "samples");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, outName);

if (!FORCE && fs.existsSync(outPath)) {
  console.log(`[gen-sample-confirm-ngat-quang] BO QUA - ${outPath} da ton tai (dung --force neu muon tao lai co y).`);
  process.exit(0);
}

console.log(`[gen-sample-confirm-ngat-quang] Goi OpenAI TTS (model=${TTS_MODEL}, voice=${TTS_VOICE})...`);
console.log(`[gen-sample-confirm-ngat-quang] Noi dung: "${text}"`);

const res = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
    response_format: "wav",
  }),
});

if (!res.ok) {
  const body = await res.text().catch(() => "");
  console.error(`[gen-sample-confirm-ngat-quang] OpenAI TTS tra loi HTTP ${res.status}: ${body.slice(0, 500)}`);
  process.exit(1);
}

const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(outPath, buf);
console.log(`[gen-sample-confirm-ngat-quang] Da luu ${outPath} (${buf.length} bytes).`);
console.log(
  "\n[gen-sample-confirm-ngat-quang] TIEP THEO: nghe thu file vua tao - xac nhan CO khoang ngung ro " +
    "giua 'Dạ...' va 'đúng rồi ạ' hay khong, roi bao lai cho minh TRUOC khi dung cho probe-confirm-danh-bo.mjs " +
    "(neu doc lien mach khong ngung, file nay chua kiem chung duoc kich ban ngat quang).",
);
