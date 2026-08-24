#!/usr/bin/env node
// scripts/probe-danh-bo-vad.mjs
//
// Giai doan 6a (xem docs/roadmap.md). THI NGHIEM THAT - kiem chung cau hinh
// "digits" (buildTurnDetectionConfig("digits"), src/session/session-ws.js)
// truoc khi tin dung cho danh-bo-flow.js (chua viet). KHONG doan/ke thua mu
// tham so tu ban cu (voice_bot/) - chu du an da nhac: code cu co the co bug/
// chua hop ly, khong tin tuyet doi.
//
// Giai doan 1 (docs/fix/giai_doan_1_quan_sat_event_that_20260820.md, muc
// "Thi nghiem mo rong") DA do that tren audio that + 2 model: da xac nhan
// create_response:false KHONG ngan VAD tach nhieu manh (ca semantic_vad lan
// server_vad), va turn_detection:null (dung nhat, luon ra 1 manh) KHONG
// dung duoc cho san xuat (chi nhan audio qua SIP). NHUNG thi nghiem do CHUA
// tung do dung to hop server_vad + create_response:false (dung to hop
// buildTurnDetectionConfig("digits") dang dung, PORT tu ban cu, threshold
// 0.6/silence_duration_ms 2000) - script nay do dung to hop that su se dung.
//
// Kiem tra 3 cau hoi CHUA co bang chung that tren du an nay:
//   1. Voi "digits" mode that su (server_vad+create_response:false+cac
//      tham so PORT tu ban cu) - co CHAC CHAN 0 lan response.created tu VAD
//      tu phat khong (day la ly do DUY NHAT dung server_vad thay vi
//      semantic_vad cho mode nay)? Van bi tach nhieu manh nhu du doan
//      khong (neu co, dung ket qua Giai doan 1, khong phai bat ngo)?
//   2. Khoang lang do DUOC (audio_end_ms cua speech_stopped truoc so voi
//      audio_start_ms cua speech_started sau) trong file that co < 2000ms
//      (gia tri silence_duration_ms dang dung) khong - neu khoang lang that
//      DAI HON 2000ms o dau do, gia tri nay se KHONG BAO GIO cho khach
//      ngung giua chung (tuong duong nhu khong co "cho ngung" nao ca).
//   3. Chuyen VAD tu "normal" (mac dinh luc moi ket noi) sang "digits" NGAY
//      (mo phong dung luc dispatch-tool-call.js phat hien DANH_BO_MISSING
//      va goi flow.start() ngay lap tuc, chua kip cho gi) - "cua so ho hong"
//      giua luc gui session.update va luc server xac nhan ap dung xong
//      (session.updated) dai bao nhieu ms? Day la dung lop bug that ban cu
//      GHI NHAN nhung CHUA TUNG sua tan goc (fix_migrate_gpt_realtime_21_
//      20260730.md, dot 15, 04/08/2026 - response tu sinh SAI dung luc VAD
//      chuyen che do, tung khoa chet 1 ma danh bo DUNG that).
//
// CACH CHAY (tren may ban, KHONG qua cong cu dieu khien tu xa - can mang
// that + OPENAI_API_KEY that trong .env, giong cach chay probe-realtime.mjs):
//   node scripts/probe-danh-bo-vad.mjs samples/2_22082351775.wav
//   node scripts/probe-danh-bo-vad.mjs samples/6_ngap_ngung.wav
//   node scripts/probe-danh-bo-vad.mjs samples/2_22082351775_lienmach.wav
//
// [them 24/08/2026 #4, theo audit docs/fix/giai_doan_6a_audit_kich_ban_da_
// test_20260824.md - muc "tap am luc doc so chua test"] Them tham so THU 2
// TUY CHON: ma danh bo MONG DOI, de doi chieu TRUC TIEP voi candidate that
// su danh-bo-collect.js (module THAT, khong phai ban sao/mo phong) gom
// duoc tu CHINH cac manh transcript vua nhan - KHONG can chay qua toan bo
// checkpoint-giai-doan-6a.mjs (von gan chat voi 1 ma danh bo CO du lieu
// billing that, cac file "tap am" hien co lai doc 1 ma KHAC (22082351775)
// CHUA xac nhan co du lieu that trong moi truong test - xem ghi chu file
// audit) - script nay chi can biet CANDIDATE co dung khong, khong lien
// quan gi toi viec tra cuu hoa don co thanh cong hay khong. Vi du dung cho
// tap am (5 file, muc do tang dan noise1->noise5):
//   node scripts/probe-danh-bo-vad.mjs samples/2_22082351775_lienmach_noise1.wav 22082351775
//   node scripts/probe-danh-bo-vad.mjs samples/2_22082351775_lienmach_noise3.wav 22082351775
//   node scripts/probe-danh-bo-vad.mjs samples/2_22082351775_lienmach_noise5.wav 22082351775
//
// KET QUA: logs/probe-danh-bo-vad-<file>-<timestamp>.jsonl (toan bo event
// tho, dung dinh dang probe-realtime.mjs de doi chieu duoc voi log Giai
// doan 1) + tom tat cuoi cung in ra console (xem printSummary() cuoi file).

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTurnDetectionConfig } from "../src/session/session-ws.js";
import { createDanhBoSession, noteDanhBoDigits, isDanhBoComplete, danhBoCandidate } from "../src/call-flow/danh-bo-collect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuoc goi tong dai cham soc khach hang cong ty cap nuoc tai TP.HCM, " +
  "toan bo bang tieng Viet. Co the chua ma danh bo 11 chu so, so tien, " +
  "ten thu tuc: dinh muc nuoc, lap dat dong ho, sang ten, nang doi dong ho.";

if (!API_KEY) {
  console.error("[probe-danh-bo-vad] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

const audioFilePath = process.argv[2];
if (!audioFilePath) {
  console.error("[probe-danh-bo-vad] Can truyen duong dan file WAV test, vd:");
  console.error("  node scripts/probe-danh-bo-vad.mjs samples/2_22082351775.wav");
  process.exit(1);
}
// [them 24/08/2026 #4] Tuy chon - xem ghi chu "CACH CHAY" dau file.
const expectedDanhBo = process.argv[3] || null;

const audioSlug = path.basename(audioFilePath, path.extname(audioFilePath)).replace(/[^a-zA-Z0-9_-]+/g, "-");
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const logPath = path.join(logsDir, `probe-danh-bo-vad-${audioSlug}-${Date.now()}.jsonl`);
const logStream = fs.createWriteStream(logPath, { flags: "a" });

const t0 = Date.now();

// ── So lieu cho printSummary() ──────────────────────────────────────────
let responseCreatedEvents = []; // moi phan tu la {elapsedMs} - PHAI rong khi in ket qua
let sessionUpdateDigitsSentAt = null;
let sessionUpdatedAfterDigitsAt = null;
const speechStops = []; // {elapsedMs, atMs}
const speechStarts = []; // {elapsedMs, atMs}
const committedItemIds = [];
const transcripts = [];

function logEvent(direction, event) {
  const elapsedMs = Date.now() - t0;
  logStream.write(JSON.stringify({ elapsedMs, direction, event }) + "\n");
  const extra = summarize(event);
  console.log(`[+${String(elapsedMs).padStart(6, " ")}ms] ${direction === "in" ? "<-" : "->"} ${event.type}${extra ? "  " + extra : ""}`);

  if (direction !== "in") return;
  if (event.type === "response.created") responseCreatedEvents.push({ elapsedMs });
  if (event.type === "input_audio_buffer.speech_started") speechStarts.push({ elapsedMs, atMs: event.audio_start_ms });
  if (event.type === "input_audio_buffer.speech_stopped") speechStops.push({ elapsedMs, atMs: event.audio_end_ms });
  if (event.type === "input_audio_buffer.committed") committedItemIds.push(event.item_id);
  if (event.type === "conversation.item.input_audio_transcription.completed") transcripts.push(event.transcript);
  if (event.type === "session.updated" && sessionUpdateDigitsSentAt !== null && sessionUpdatedAfterDigitsAt === null) {
    sessionUpdatedAfterDigitsAt = elapsedMs;
  }
}

function summarize(event) {
  switch (event.type) {
    case "conversation.item.input_audio_transcription.completed":
      return `transcript="${event.transcript}"`;
    case "response.done":
      return `status=${event.response?.status}`;
    case "response.created":
      return "**RESPONSE.CREATED — KHONG DUOC PHEP XAY RA O DIGITS MODE**";
    case "error":
      return JSON.stringify(event.error ?? event).slice(0, 200);
    default:
      return "";
  }
}

const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`;
console.log(`[probe-danh-bo-vad] Dang ket noi ${url} (file=${audioFilePath})...`);
const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${API_KEY}` } });

function send(obj) {
  ws.send(JSON.stringify(obj));
  logEvent("out", obj);
}

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[probe-danh-bo-vad] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

ws.on("open", () => {
  console.log("[probe-danh-bo-vad] WS da ket noi - gui session.update ('normal', dung mo phong luc bat dau cuoc goi that)...");
  send({
    type: "session.update",
    session: {
      type: "realtime",
      audio: {
        input: {
          transcription: { model: TRANSCRIBE_MODEL, language: TRANSCRIBE_LANGUAGE, prompt: TRANSCRIBE_PROMPT },
          turn_detection: buildTurnDetectionConfig("normal"),
        },
      },
    },
  });
});

let phase = "connecting"; // connecting -> switching-to-digits -> streaming -> done
let streamed = false;

ws.on("message", (raw) => {
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return;
  }
  logEvent("in", event);

  if (event.type === "session.updated" && phase === "connecting") {
    phase = "switching-to-digits";
    // [cau hoi 3] Chuyen VAD sang "digits" NGAY - khong doi gi ca, roi bat
    // dau phat audio NGAY LAP TUC (khong doi session.updated cua LAN GUI
    // NAY ve) - day la kich ban XAU NHAT that co the xay ra (audio SIP toi
    // lien tuc, code khong the "cho" server ack truoc khi co am thanh vao).
    console.log("[probe-danh-bo-vad] Chuyen VAD sang 'digits' + bat dau phat audio NGAY (do cua so ho hong that)...");
    sessionUpdateDigitsSentAt = Date.now() - t0;
    send({
      type: "session.update",
      session: { type: "realtime", audio: { input: { turn_detection: buildTurnDetectionConfig("digits") } } },
    });
    if (!streamed) {
      streamed = true;
      phase = "streaming";
      streamAudioFile(audioFilePath).catch((err) => {
        console.error("[probe-danh-bo-vad] Loi khi stream audio:", err.message);
        closeSoon();
      });
    }
  }

  if (event.type === "error") {
    console.error("[probe-danh-bo-vad] Server bao loi:", JSON.stringify(event.error ?? event));
  }
});

// ── Doc WAV toi gian (copy tu probe-realtime.mjs, giu dung logic) ────────
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
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`File phai la PCM 16-bit (dang gap: audioFormat=${fmt.audioFormat}, bitsPerSample=${fmt.bitsPerSample}).`);
  }
  return { fmt, data };
}

async function streamAudioFile(filePath) {
  console.log(`[probe-danh-bo-vad] Doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  console.log(`[probe-danh-bo-vad] WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s`);

  const bytesPerSample = 2;
  const frameMs = 20;
  const frameBytes = Math.floor((fmt.sampleRate * frameMs) / 1000) * bytesPerSample;

  for (let i = 0; i < data.length; i += frameBytes) {
    const chunk = data.subarray(i, i + frameBytes);
    send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
    await sleep(frameMs);
  }

  // silence_duration_ms cua "digits" mode la 2000ms - doi du DAI HON de
  // chac chan server kip commit manh CUOI CUNG truoc khi dong ket noi.
  const silenceFrame = Buffer.alloc(frameBytes);
  for (let i = 0; i < 3500 / frameMs; i++) {
    send({ type: "input_audio_buffer.append", audio: silenceFrame.toString("base64") });
    await sleep(frameMs);
  }
  console.log("[probe-danh-bo-vad] Da phat het file + 3.5s im lang - dong ket noi va in tom tat.");
  closeSoon();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Luoi an toan: neu vi ly do gi do khong bao gio toi duoc closeSoon() qua
// luong binh thuong (vd loi mang giua chung), tu dong dong sau 60s.
const hardTimeout = setTimeout(() => {
  console.warn("[probe-danh-bo-vad] Qua 60s khong tu ket thuc - dong cuong buc.");
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
  console.log("\n[probe-danh-bo-vad] ===== TOM TAT (doi chieu voi 3 cau hoi dau file) =====");

  console.log(`\n[cau hoi 1] Tong so response.created trong luc "digits" mode: ${responseCreatedEvents.length}`);
  if (responseCreatedEvents.length === 0) {
    console.log("  -> DUNG NHU MONG DOI: create_response:false hoat dong dung, khong co response nao tu VAD tu phat.");
  } else {
    console.log("  -> **CANH BAO**: co response tu sinh du dang o 'digits' mode - can xem lai log day du:", logPath);
    for (const r of responseCreatedEvents) console.log(`     - luc +${r.elapsedMs}ms`);
  }
  console.log(`  So lan input_audio_buffer.committed: ${committedItemIds.length} (${committedItemIds.length > 1 ? "BI TACH NHIEU MANH, dung ket qua du doan tu Giai doan 1" : "1 manh duy nhat"})`);
  console.log(`  Cac manh transcript: ${transcripts.map((t) => `"${t}"`).join(" -> ") || "(khong co)"}`);

  console.log(`\n[cau hoi 2] Khoang lang GIUA cac cum so (so voi silence_duration_ms=2000 dang dung):`);
  if (speechStops.length === 0 || speechStarts.length <= 1) {
    console.log("  -> Khong du du lieu (chi 1 hoac 0 lan speech_started/stopped) de tinh khoang lang giua cac cum.");
  } else {
    for (let i = 0; i < speechStops.length && i + 1 < speechStarts.length; i++) {
      const gapMs = speechStarts[i + 1].atMs - speechStops[i].atMs;
      const canhBao = gapMs > 2000 ? "  ← DAI HON silence_duration_ms=2000, se KHONG duoc coi la 'ngung giua chung'" : "";
      console.log(`  Khoang lang #${i + 1}: ${gapMs}ms${canhBao}`);
    }
  }

  console.log(`\n[cau hoi 3] Cua so ho hong luc chuyen VAD sang 'digits':`);
  if (sessionUpdateDigitsSentAt === null) {
    console.log("  -> Khong ghi nhan duoc (session.update 'digits' chua tung gui - kiem tra loi ket noi).");
  } else if (sessionUpdatedAfterDigitsAt === null) {
    console.log(`  -> Da gui session.update('digits') luc +${sessionUpdateDigitsSentAt}ms nhung KHONG thay session.updated xac nhan ve truoc khi dong ket noi (co the qua nhanh audio da phat het, hoac event nay khong ton tai - can xem log day du).`);
  } else {
    const windowMs = sessionUpdatedAfterDigitsAt - sessionUpdateDigitsSentAt;
    console.log(`  -> Gui luc +${sessionUpdateDigitsSentAt}ms, server xac nhan (session.updated) luc +${sessionUpdatedAfterDigitsAt}ms.`);
    console.log(`  -> CUA SO HO HONG DO DUOC: ${windowMs}ms (thoi gian giua luc gui va luc server xac nhan ap dung xong).`);
  }

  // [them 24/08/2026 #4] Doi chieu TRUC TIEP voi danh-bo-collect.js THAT
  // (khong phai mo phong lai logic) - dung DUNG cach danh-bo-flow.js goi
  // (noteDanhBoDigits tung manh THEO DUNG THU TU nhan duoc, roi lay
  // danhBoCandidate) de biet CANDIDATE cuoi cung co dung khong voi chinh
  // du lieu STT that vua nhan, khong can chay qua toan bo checkpoint-
  // giai-doan-6a.mjs (xem ghi chu "CACH CHAY" dau file ve ly do).
  console.log(`\n[doi chieu danh-bo-collect.js THAT] Gom ${transcripts.length} manh transcript qua noteDanhBoDigits()...`);
  const session = createDanhBoSession();
  for (const t of transcripts) noteDanhBoDigits(session, t);
  const complete = isDanhBoComplete(session);
  const candidate = danhBoCandidate(session);
  console.log(`  digits gom duoc: "${session.digits}" (${session.digits.length} chu so)`);
  console.log(`  isDanhBoComplete(): ${complete}`);
  console.log(`  danhBoCandidate(): ${candidate ?? "(chua du 11 so, null)"}`);
  if (expectedDanhBo) {
    const khop = candidate === expectedDanhBo;
    console.log(`  So voi ma danh bo MONG DOI (${expectedDanhBo}): ${khop ? "KHOP DUNG" : "**KHONG KHOP**"}`);
  } else {
    console.log("  (khong truyen ma danh bo mong doi qua argv[3] nen khong tu doi chieu dung/sai)");
  }

  console.log(`\n[probe-danh-bo-vad] Log day du: ${logPath}`);
}

process.on("SIGINT", () => {
  console.log("\n[probe-danh-bo-vad] Ngat boi nguoi dung (Ctrl+C).");
  closeSoon();
});

ws.on("error", (err) => {
  console.error("[probe-danh-bo-vad] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`[probe-danh-bo-vad] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});
