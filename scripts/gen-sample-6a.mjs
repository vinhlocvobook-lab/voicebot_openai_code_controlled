#!/usr/bin/env node
// scripts/gen-sample-6a.mjs
//
// Giai doan 6a (xem docs/roadmap.md). Tao 3 file WAV mau MOI cho
// checkpoint-giai-doan-6a.mjs (chua viet, se can toi ngay sau khi co audio
// nay) bang TTS THAT (OpenAI audio/speech) - dung lai Y HET ky thuat da
// xac nhan hoat dong tot o scripts/gen-sample-5b.mjs (Giai doan 5b, da
// dung THAT cho checkpoint-giai-doan-5b-audio.mjs): model gpt-4o-mini-tts,
// voice alloy, response_format "wav", so danh bo doc TACH TUNG CHU SO
// (tranh TTS doc gop thanh so lon).
//
// KHAC 5b (chi 1 file, 1 cau gop ca loi chao + doc so): Giai doan 6a can
// nhieu luot noi RIENG BIET vi danh-bo-flow.js (state machine moi) doi hoi
// CODE chu dong dan dat tung buoc (arming -> asking -> confirming), khong
// con la 1 cau tu do nhu 5b:
//   1. 6a_mo_dau_khong_danh_bo.wav - loi mo dau CO Y KHONG doc danh bo
//      (khach hoi hoa don nhung CHUA cho biet ma danh bo - dung tinh huong
//      thuc te se lam get_bill tra ve DANH_BO_MISSING, kich hoat
//      danhBoFlow.start() qua dispatch-tool-call.js).
//   2. 6a_doc_so_22023251775.wav - doc 11 chu so danh bo 22023251775 (danh
//      bo DA XAC NHAN co du lieu that trong moi truong test, dung chung
//      voi checkpoint-giai-doan-5b.mjs) - se phat SAU khi danhBoFlow hoi
//      ("Dạ, Quý Khách vui lòng đọc giúp em mã danh bộ...").
//   3. 6a_xac_nhan_dung.wav - "Dạ đúng rồi ạ." - se phat SAU khi
//      danhBoFlow doc lai xin xac nhan.
//   4. [them 24/08/2026 #10, viec uu tien con lai "xac nhan SAI qua audio
//      that" - xem docs/fix/giai_doan_6a_audit_kich_ban_da_test_20260824.md]
//      6a_xac_nhan_sai.wav - "Dạ, sai rồi ạ." - dung cho
//      checkpoint-giai-doan-6a-xac-nhan-sai.mjs (script MOI, chua viet luc
//      sample nay duoc tao) de kich nhanh isNegative() THAT cua
//      danh-bo-flow.js (xem src/call-flow/danh-bo-confirm.js#PHU_DINH_RE -
//      "sai rồi" khop CA 2 nhanh trong regex do, "sai rồi" VA rieng le
//      "\bsai\b" - chon co y de khong mo ho, tranh khop nham nhanh
//      isAffirmative/wantsRepeat nao khac).
// checkpoint-giai-doan-6a.mjs se tu quyet dinh LUC NAO phat file nao (doi
// dung tin hieu/phase tuong ung, khong phat theo timer co dinh mu quang) -
// script nay CHI tao san cac file, khong lien quan toi luc phat.
//
// [them 24/08/2026 #10] Script nay GIO SE BO QUA (khong goi TTS lai, khong
// ghi de) bat ky file nao DA TON TAI san trong samples/ - tranh nguy co THAT
// (neu chay lai ca script se GHI DE ca 3 file cu DA duoc nghe/xac nhan tot +
// DA dung PASS qua checkpoint that, TTS khong dinh - lan tao lai co the doc
// khac di chut it, lam hong lai audio dang hoat dong dung). Dung "--force"
// (process.argv) de ep tao lai TAT CA (chi dung khi CO Y muon tao lai, vd
// doi giong/model TTS).
//
// response_format: "wav" - 5b da xac nhan day la PCM 16-bit boc WAV
// header, sample rate ra sao thi TU BAN THAN file WAV do se noi (khong
// doan truoc) - checkpoint-giai-doan-6a.mjs (dung lai readWavPcm16 tu
// probe-danh-bo-vad.mjs/checkpoint-5a) se tu in ra sample rate/so kenh/bit
// doc duoc NGAY dong log dau tien khi doc file - nhin dong do de biet co
// can convert bang ffmpeg khong (vd neu KHONG phai 24000Hz: `ffmpeg -i
// samples/6a_xxx.wav -ar 24000 -ac 1 -sample_fmt s16 samples/6a_xxx_24k.wav`
// roi doi lai duong dan trong checkpoint-giai-doan-6a.mjs), khong doan
// truoc khi chua thay so that.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env):
//   node scripts/gen-sample-6a.mjs
// Sau khi chay xong, NGHE THU CA 3 file trong samples/ TRUOC khi dung cho
// checkpoint - xac nhan: (1) file 1 nghe tu nhien nhu 1 khach hang thuc su
// hoi, KHONG lo ra so danh bo nao; (2) file 2 doc DUNG tung chu so
// "2 2 0 2 3 2 5 1 7 7 5", khong bi gop/nuot/doc sai chu so nao; (3) file 3
// nghe ro "dung"/"khong dung" phan biet duoc (dung cho ca test nhanh phu
// dinh sau nay neu can). Day la buoc kiem tra bang tai, khong co cach nao
// tu dong hoa duoc.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("[gen-sample-6a] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";

// [xem ghi chu dau file] Danh bo 22023251775 -> 2 2 0 2 3 2 5 1 7 7 5 (11
// chu so) - dung DUNG cach doc tach tung chu so da xac nhan hoat dong tot
// o gen-sample-5b.mjs, KHONG doi cach doc.
const SAMPLES = [
  {
    outName: "6a_mo_dau_khong_danh_bo.wav",
    text: "Dạ cho em hỏi hóa đơn tiền nước kỳ tháng 8 năm 2026 của em với ạ.",
    note: "loi mo dau, CO Y KHONG doc danh bo - de kich DANH_BO_MISSING that",
  },
  {
    outName: "6a_doc_so_22023251775.wav",
    text: "hai hai không hai ba hai năm một bảy bảy năm",
    note: "doc 11 chu so danh bo 22023251775, tach tung chu so",
  },
  {
    outName: "6a_xac_nhan_dung.wav",
    text: "Dạ đúng rồi ạ.",
    note: "xac nhan DUNG khi danhBoFlow doc lai so xin xac nhan",
  },
  {
    outName: "6a_xac_nhan_sai.wav",
    text: "Dạ, sai rồi ạ.",
    note: "[them 24/08/2026 #10] xac nhan SAI khi danhBoFlow doc lai so xin xac nhan - kich isNegative() that",
  },
];

const FORCE = process.argv.includes("--force");
const outDir = path.join(__dirname, "..", "samples");
fs.mkdirSync(outDir, { recursive: true });

for (const sample of SAMPLES) {
  const outPath = path.join(outDir, sample.outName);
  if (!FORCE && fs.existsSync(outPath)) {
    console.log(`\n[gen-sample-6a] (${sample.note})`);
    console.log(`[gen-sample-6a] BO QUA - ${outPath} da ton tai (dung --force neu muon tao lai co y).`);
    continue;
  }
  console.log(`\n[gen-sample-6a] (${sample.note})`);
  console.log(`[gen-sample-6a] Goi OpenAI TTS (model=${TTS_MODEL}, voice=${TTS_VOICE})...`);
  console.log(`[gen-sample-6a] Noi dung: "${sample.text}"`);

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: sample.text,
      response_format: "wav",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[gen-sample-6a] OpenAI TTS tra loi HTTP ${res.status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  console.log(`[gen-sample-6a] Da luu ${outPath} (${buf.length} bytes).`);
}

console.log(
  "\n[gen-sample-6a] XONG. TIEP THEO: nghe thu file(s) MOI vua tao trong samples/ " +
    "(nghe ro 6a_xac_nhan_sai.wav noi 'sai'/'không đúng', KHONG bi lan sang 'đúng') " +
    "truoc khi bao lai cho minh de dung cho checkpoint.",
);
