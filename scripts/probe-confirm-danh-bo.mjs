#!/usr/bin/env node
// scripts/probe-confirm-danh-bo.mjs
//
// Giai doan 6b (xem docs/roadmap.md, muc "Giai doan 6b - Phuong an B").
// THI NGHIEM THAT - CAU HOI DUY NHAT can tra loi TRUOC khi viet bat ky
// matcher/tool-handler nao cho 6b (rà soát thiết kế 24/08/2026 với chủ dự
// án đã xác nhận giữ nguyên thiết kế 21/08, nhưng phát hiện 1 lỗ hổng kỹ
// thuật lúc rà soát): buoc 1 cua thiet ke ("Khop cap ... dung previous_
// item_id/thu tu item de khop DUNG CAP") DOI HOI tin hieu server gui ve
// khi KHACH tra loi (conversation.item.input_audio_transcription.completed)
// phai co field previous_item_id TRO DUNG ve item cua chinh cau MODEL vua
// doc lai xin xac nhan - nhung:
//   1. turn-signal.js#normalizeTurnEvent HIEN TAI chi chuan hoa
//      previous_item_id cho "input_audio_buffer.committed" (dung de noi cac
//      manh VAD cua CUNG 1 luot khach noi, xem danh-bo-collect.js) - KHONG
//      chuan hoa cho "conversation.item.input_audio_transcription.completed".
//   2. CHUA CO bang chung THAT nao xac nhan raw event do CO mang previous_
//      item_id hay khong, VA neu co thi gia tri co THAT SU tro ve item cua
//      MODEL (khac vai/role) hay chi tro ve item TRUOC DO cua CHINH khach
//      (cung vai, nhu cach dung o buffer-committed) - 2 kha nang nay HOAN
//      TOAN khac nhau ve y nghia, khong the doan.
//
// Script nay: bat model NOI 1 cau doc lai so + hoi xac nhan (dung text
// injection + response.create, KHONG can system-prompt.js that cua 6b -
// chi can mo phong DUNG HINH DANG 1 luot "model doc lai xin xac nhan"), roi
// phat NGAY audio khach xac nhan that (samples/6a_xac_nhan_dung.wav, da co
// san, da qua kiem tra bang tai) - ghi lai TOAN BO raw event (khong chi
// normalize) de doi chieu truc tiep item id cua ca 2 phia.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env):
//   node scripts/probe-confirm-danh-bo.mjs
//
// KET QUA: logs/probe-confirm-danh-bo-<timestamp>.jsonl (toan bo event tho)
// + tom tat cuoi cung in ra console (xem printSummary() cuoi file) - tra
// loi TRUC TIEP cau hoi o tren, khong suy doan.

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuoc goi tong dai cham soc khach hang cong ty cap nuoc tai TP.HCM, " +
  "toan bo bang tieng Viet. Co the chua ma danh bo 11 chu so, so tien.";

if (!API_KEY) {
  console.error("[probe-confirm-danh-bo] Thieu OPENAI_API_KEY trong .env.");
  process.exit(1);
}

const AUDIO_XAC_NHAN_DUNG = path.join(__dirname, "..", "samples", "6a_xac_nhan_dung.wav");
if (!fs.existsSync(AUDIO_XAC_NHAN_DUNG)) {
  console.error(`[probe-confirm-danh-bo] Thieu file ${AUDIO_XAC_NHAN_DUNG} - chay truoc: node scripts/gen-sample-6a.mjs`);
  process.exit(1);
}

// Bat model NOI cau nay NGUYEN VAN (mode "tool" khong dung duoc o day vi
// khong can tool - dung 1 tin nhan user + response.create BINH THUONG,
// nhung ep noi dung qua instructions truc tiep trong response.create de
// khoi phu thuoc he thong prompt CHUA viet cua 6b).
const READBACK_INSTRUCTIONS =
  "Đọc lại nguyên văn, chậm rãi, tách từng chữ số: " +
  "'Dạ, mã danh bộ của Quý Khách là Hai - Hai - Không - Hai - Ba - Hai - Năm - Một - Bảy - Bảy - Năm. " +
  "Quý Khách xác nhận giúp em có đúng không ạ?' - không nói gì thêm, không thêm bớt.";

const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const logPath = path.join(logsDir, `probe-confirm-danh-bo-${Date.now()}.jsonl`);
const logStream = fs.createWriteStream(logPath, { flags: "a" });

const t0 = Date.now();

// ── So lieu cho printSummary() ──────────────────────────────────────────
let aiItemId = null; // item_id cua CAU MODEL doc lai (tu response.output_audio_transcript.done)
let aiResponseId = null;
const conversationItemsRaw = []; // {source: "added"|"done", item} - TOAN BO conversation.item.* THAT nhan duoc, KHONG loc
let customerTranscriptEvent = null; // raw event conversation.item.input_audio_transcription.completed
let responseDoneSeen = false;

function logEvent(direction, event) {
  const elapsedMs = Date.now() - t0;
  logStream.write(JSON.stringify({ elapsedMs, direction, event }) + "\n");
  console.log(`[+${String(elapsedMs).padStart(6, " ")}ms] ${direction === "in" ? "<-" : "->"} ${event.type}`);

  if (direction !== "in") return;

  if (event.type === "response.output_audio_transcript.done") {
    aiItemId = event.item_id ?? null;
    aiResponseId = event.response_id ?? null;
    console.log(`    -> item_id CUA CAU MODEL doc lai: ${aiItemId} (response_id=${aiResponseId})`);
    console.log(`    -> transcript: "${event.transcript}"`);
  }
  if (event.type === "response.done") {
    responseDoneSeen = true;
  }
  if (event.type === "conversation.item.added" || event.type === "conversation.item.done") {
    // Ghi lai TOAN BO item object THAT server gui - KHONG doan truoc field
    // nao co/khong co, in het ra de doc bang mat.
    conversationItemsRaw.push({ source: event.type, item: event.item ?? null });
  }
  if (event.type === "conversation.item.input_audio_transcription.completed") {
    customerTranscriptEvent = event;
    console.log(`    -> KHACH noi: "${event.transcript}" (item_id=${event.item_id})`);
    console.log(`    -> RAW EVENT DAY DU: ${JSON.stringify(event)}`);
  }
}

const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`;
console.log(`[probe-confirm-danh-bo] Dang ket noi ${url}...`);
const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${API_KEY}` } });

function send(obj) {
  ws.send(JSON.stringify(obj));
  logEvent("out", obj);
}

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[probe-confirm-danh-bo] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

let phase = "connecting"; // connecting -> asking-readback -> waiting-response-done -> streaming-customer-reply -> done

ws.on("open", () => {
  console.log("[probe-confirm-danh-bo] WS da ket noi - gui session.update ('normal', KHONG can 'digits')...");
  send({
    type: "session.update",
    session: {
      type: "realtime",
      audio: {
        input: {
          transcription: { model: TRANSCRIBE_MODEL, language: TRANSCRIBE_LANGUAGE, prompt: TRANSCRIBE_PROMPT },
          turn_detection: { type: "server_vad", threshold: 0.6, silence_duration_ms: 700, create_response: false },
        },
      },
    },
  });
});

ws.on("message", (raw) => {
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return;
  }
  logEvent("in", event);

  if (event.type === "session.updated" && phase === "connecting") {
    phase = "asking-readback";
    console.log("[probe-confirm-danh-bo] Ep model doc lai cau xac nhan (response.create voi instructions truc tiep)...");
    send({ type: "response.create", response: { instructions: READBACK_INSTRUCTIONS } });
  }

  if (event.type === "response.done" && phase === "asking-readback") {
    phase = "streaming-customer-reply";
    console.log("[probe-confirm-danh-bo] Model da noi xong (response.done) - phat NGAY audio khach xac nhan...");
    streamAudioFile(AUDIO_XAC_NHAN_DUNG).catch((err) => {
      console.error("[probe-confirm-danh-bo] Loi khi stream audio:", err.message);
      closeSoon();
    });
  }

  if (event.type === "error") {
    console.error("[probe-confirm-danh-bo] Server bao loi:", JSON.stringify(event.error ?? event));
  }

  // Ket thuc khi DA co ca transcript cua khach (khong can doi gi them nua).
  if (customerTranscriptEvent && phase !== "done") {
    phase = "done";
    setTimeout(closeSoon, 500); // doi chut phong truong hop con conversation.item.done tra ve cham hon
  }
});

// ── Doc WAV toi gian (copy tu probe-danh-bo-vad.mjs) ──────────────────────
function readWavPcm16(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Khong phai file WAV hop le (thieu RIFF/WAVE header).");
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(chunkStart),
        numChannels: buf.readUInt16LE(chunkStart + 2),
        sampleRate: buf.readUInt32LE(chunkStart + 4),
        bitsPerSample: buf.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      data = buf.subarray(chunkStart, chunkStart + chunkSize);
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (!fmt || !data) throw new Error("Khong tim thay chunk 'fmt ' hoac 'data' trong file WAV.");
  return { fmt, data };
}

async function streamAudioFile(filePath) {
  const { fmt, data } = readWavPcm16(filePath);
  console.log(`[probe-confirm-danh-bo] WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s`);

  const bytesPerSample = 2;
  const frameMs = 20;
  const frameBytes = Math.floor((fmt.sampleRate * frameMs) / 1000) * bytesPerSample;

  for (let i = 0; i < data.length; i += frameBytes) {
    const chunk = data.subarray(i, i + frameBytes);
    send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
    await sleep(frameMs);
  }
  const silenceFrame = Buffer.alloc(frameBytes);
  for (let i = 0; i < 2500 / frameMs; i++) {
    send({ type: "input_audio_buffer.append", audio: silenceFrame.toString("base64") });
    await sleep(frameMs);
  }
  console.log("[probe-confirm-danh-bo] Da phat het audio khach + 2.5s im lang - cho transcript...");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const hardTimeout = setTimeout(() => {
  console.warn("[probe-confirm-danh-bo] Qua 60s khong tu ket thuc - dong cuong buc.");
  closeSoon();
}, 60000);

let closing = false;
function closeSoon() {
  if (closing) return;
  closing = true;
  clearTimeout(hardTimeout);
  setTimeout(() => {
    printSummary();
    ws.close();
    logStream.end();
    process.exit(0);
  }, 500);
}

function printSummary() {
  console.log("\n[probe-confirm-danh-bo] ===== TOM TAT =====");
  console.log(`\nitem_id cua CAU MODEL doc lai xac nhan: ${aiItemId ?? "(KHONG bat duoc - xem log day du)"}`);
  console.log(`response.done cua luot model: ${responseDoneSeen}`);

  console.log(`\nconversation.item.added/done THAT nhan duoc (${conversationItemsRaw.length} entry) - IN NGUYEN item object:`);
  conversationItemsRaw.forEach((entry, i) => {
    console.log(`  [${i}] (${entry.source}) ${JSON.stringify(entry.item)}`);
  });

  console.log(`\nconversation.item.input_audio_transcription.completed cua KHACH:`);
  if (!customerTranscriptEvent) {
    console.log("  -> KHONG nhan duoc (het thoi gian cho hoac loi mang - xem log day du).");
  } else {
    console.log(`  Raw event: ${JSON.stringify(customerTranscriptEvent)}`);
    const hasPreviousItemId = Object.prototype.hasOwnProperty.call(customerTranscriptEvent, "previous_item_id");
    console.log(`\n[CAU HOI CAN TRA LOI] Event nay CO field "previous_item_id" khong? ${hasPreviousItemId ? "CO" : "KHONG"}`);
    if (hasPreviousItemId) {
      const khop = customerTranscriptEvent.previous_item_id === aiItemId;
      console.log(`  previous_item_id = "${customerTranscriptEvent.previous_item_id}"`);
      console.log(`  So voi item_id cua cau model (${aiItemId}): ${khop ? "KHOP DUNG - previous_item_id CO THE dung de ghep cap qua vai (AI -> khach) nhu thiet ke 6b gia dinh" : "KHONG KHOP - previous_item_id KHONG tro ve dung item cua model, GIA DINH cua thiet ke 6b (buoc 1) SAI, can 1 co che ghep cap KHAC (vd chi dung thu tu/thoi gian den cua signal, hoac dung conversation.item.added/done o tren de tu xay chuoi item that su)"}`);
    } else {
      console.log(
        "  -> KHONG co field nay trong event conversation.item.input_audio_transcription.completed - " +
          "GIA DINH cua thiet ke 6b (buoc 1, \"dung previous_item_id\") KHONG AP DUNG DUOC TRUC TIEP cho chinh event nay. " +
          "Xem danh sach conversation.item.added/done o tren - neu CAC event do CO previous_item_id trong item object, " +
          "co the ghep cap GIAN TIEP qua item_id chung (item_id cua conversation.item.done ung voi item_id cua transcription.completed, " +
          "roi tra previous_item_id CUA CHINH item do trong conversation.item.added/done, khong phai trong transcription.completed).",
      );
    }
  }

  console.log(`\n[probe-confirm-danh-bo] Log day du: ${logPath}`);
}

process.on("SIGINT", () => {
  console.log("\n[probe-confirm-danh-bo] Ngat boi nguoi dung (Ctrl+C).");
  closeSoon();
});

ws.on("error", (err) => {
  console.error("[probe-confirm-danh-bo] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`[probe-confirm-danh-bo] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});
