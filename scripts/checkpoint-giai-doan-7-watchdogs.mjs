#!/usr/bin/env node
// scripts/checkpoint-giai-doan-7-watchdogs.mjs
//
// Giai doan 7 (xem docs/roadmap.md). Checkpoint THAT dau-cuoi cho
// src/session/watchdogs.js - noi VAO duong day that: connectRealtimeSession
// that (session-ws.js) + turnController that. Khung chung ke thua
// checkpoint-giai-doan-6a.mjs/6b.mjs (tee() log ra file, finish()/timeout an
// toan, main() async/await tuan tu). KHAC 2 checkpoint truoc o CHO watchdogs.js
// la lop "session-level", KHONG co module nghiep vu nao khac can noi cung
// (khong dung tool-router.js/dispatch-tool-call.js) - checkpoint nay CO Y GIA
// LAP dung 1 kich ban duy nhat ma toan bo Giai doan 7 sinh ra de chan: "code
// quen tra loi" (dung nguyen van cau chu roadmap.md da ghi).
//
// 2 PHA doc lap trong CUNG 1 ket noi that (tiet kiem 1 lan handshake/setup,
// van la 2 kich ban TACH BIET khong anh huong nhau - xem giai thich o tung
// pha duoi day):
//
//   PHA A - mute watchdog: chu dong khoa VAD sang "digits" (create_response:
//   false), phat 1 doan audio khach noi THAT (tai su dung samples/
//   6a_xac_nhan_dung.wav co san, khong ghi am moi), roi CO Y KHONG LAM GI CA
//   (khong goi turnController.say(), khong tu gui response.create) - gia lap
//   DUNG bug "code quen tra loi" (dot 19, ban cu - da bao cao chu du an truoc
//   do). Ky vong: mute watchdog tu phat hien + tu mo khoa + ep model tra loi.
//
//   PHA B - vad-restore watchdog: SAU KHI pha A xong (VAD da ve "normal"),
//   khoa VAD sang "digits" LAN NUA nhung LAN NAY KHONG phat audio gi ca (khong
//   co luot khach nao) - co y de mute watchdog KHONG co co hoi kich hoat (no
//   can it nhat 1 luot khach that - xem watchdogs.js), CHI con vad-restore
//   watchdog la co che duy nhat co the tu khoi phuc VAD ve "normal".
//
// NGUONG RUT NGAN CHI DE CHECKPOINT CHAY NHANH (KHONG PHAI gia tri san xuat -
// san xuat chua co lop wiring that vao 1 server.js/session-ws.js chinh thuc,
// nen chua co so "chot" nao khac gia tri mac dinh cua watchdogs.js, 15000ms/
// 90000ms - xem docs/roadmap.md). VAD_RESTORE_THRESHOLD_MS PHAI du LON HON
// tong thoi gian pha A (khoa "digits" -> audio -> khach noi xong -> mute
// watchdog can them MUTE_THRESHOLD_MS nua moi kich hoat, uoc luong tong ~13s,
// cong them do tre mang/VAD that khong doan truoc chinh xac duoc) - neu
// khong, vad-restore watchdog se TU kich hoat NGAY TRONG pha A (truoc khi
// mute watchdog kip lam viec), lam 2 pha khong con tach biet duoc nua. Chon
// 20000ms (du bien ~7s so voi uoc luong ~13s) thay vi so sat nut de tranh
// flaky do do tre mang that khong the doan truoc 100% chinh xac.
const MUTE_THRESHOLD_MS = 5000;
const VAD_RESTORE_THRESHOLD_MS = 20000;

// [them 25/08/2026] Phat hien tu chinh log THAT cua lan chay checkpoint nay
// (xem docs/roadmap.md "Cap nhat 25/08/2026 #3"): khi mute watchdog kich
// hoat, code cu goi turnController.say() TRAN (mode "auto", KHONG co
// instructions gi ca) - khong co persona/system prompt nao dang duoc nap o
// checkpoint nay (watchdogs.js la lop session-level, khong biet gi ve
// nghiep vu/persona - dung thiet ke), nen model tu "bia" ra 1 cau tra loi
// LAC DE, sai giong dieu CSKH ("Da, dung roi, nghe kha la tu tin luon...").
// Sua theo DUNG khuon UNCLEAR_CONFIRM_INSTRUCTIONS cua danh-bo-flow.js: dung
// say({mode:"guided", instructions, toolChoice:"none"}) de EP noi dung xin
// loi + hoi lai, khong de model "auto" tu quyet dinh noi gi khi khong co gi
// dan duong ca. Noi dung CO Y chung chung/khong gan nghiep vu cu the (dung
// nguyen tac watchdogs.js/checkpoint nay khong duoc hardcode noi dung
// nghiep vu) - ben tich hop that (sau nay co server.js) co the thay bang
// cau phu hop persona/nghiep vu that cua ho.
const MUTE_RECOVERY_INSTRUCTIONS =
  "Xin lỗi Quý Khách thật ngắn gọn vì vừa im lặng hơi lâu, sau đó hỏi lại xem Quý Khách cần hỗ trợ gì hoặc " +
  "nhắc lại điều Quý Khách vừa nói, giọng điệu nhân viên chăm sóc khách hàng tự nhiên, không giải thích lý do kỹ thuật.";

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectRealtimeSession } from "../src/session/session-ws.js";
import { createMuteWatchdog, createVadRestoreWatchdog } from "../src/session/watchdogs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuộc gọi tổng đài chăm sóc khách hàng công ty cấp nước tại TP.HCM, " +
  "toàn bộ bằng tiếng Việt.";

if (!API_KEY) {
  console.error("[checkpoint-7] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

// Tai su dung audio THAT co san tu Giai doan 6a - noi dung khong quan trong
// (chi can 1 luot khach noi THAT de kich hoat transcript-ready that), khong
// can ghi am moi.
const AUDIO_KHACH_NOI = path.join(__dirname, "..", "samples", "6a_xac_nhan_dung.wav");
if (!fs.existsSync(AUDIO_KHACH_NOI)) {
  console.error(`[checkpoint-7] Thieu file audio ${AUDIO_KHACH_NOI} - chay truoc: node scripts/gen-sample-6a.mjs`);
  process.exit(1);
}

// ── Log ra file, giong style checkpoint-giai-doan-6a.mjs/6b.mjs ────────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint7-${runTimestamp}.txt`);
const txtStream = fs.createWriteStream(txtPath, { flags: "a" });
function tee(...args) {
  console.log(...args);
  txtStream.write(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
}

const t0 = Date.now();
function log(directionOrLevel, payload) {
  const elapsedMs = Date.now() - t0;
  const label = directionOrLevel === "out" ? "->" : directionOrLevel === "in" ? "<-" : `[${directionOrLevel}]`;
  const desc = typeof payload === "string" ? payload : (payload && payload.type) || JSON.stringify(payload);
  tee(`[+${String(elapsedMs).padStart(6, " ")}ms] ${label} ${desc}`);
}

// ── Trang thai quan sat ─────────────────────────────────────────────────
let sawError = false;
let finished = false;
let sessionReady = false;
const muteFireEvents = []; // nowMs cua moi lan mute watchdog tra ve true
const vadRestoreFireEvents = []; // nowMs cua moi lan vad-restore watchdog tra ve true
const responseStartedEvents = []; // nowMs cua MOI tin hieu "response-started" (de doi chieu "bot co that su tra loi sau khi watchdog ep khong")

const muteWatchdog = createMuteWatchdog({ thresholdMs: MUTE_THRESHOLD_MS, log });
const vadRestoreWatchdog = createVadRestoreWatchdog({ thresholdMs: VAD_RESTORE_THRESHOLD_MS, log });

function nowMs() {
  return Date.now() - t0;
}

const { ws, turnController, setVadMode: rawSetVadMode } = connectRealtimeSession({
  apiKey: API_KEY,
  model: MODEL,
  transcribeModel: TRANSCRIBE_MODEL,
  transcribeLanguage: TRANSCRIBE_LANGUAGE,
  transcribePrompt: TRANSCRIBE_PROMPT,
  WebSocketImpl: WebSocket,
  log,
  onSignal(signal) {
    tee("[checkpoint-7] tin hieu chuan hoa:", JSON.stringify(signal));

    if (signal.kind === "session-updated" && !sessionReady) {
      sessionReady = true;
    }
    if (signal.kind === "error") {
      sawError = true;
      tee("[checkpoint-7] NHAN DUOC EVENT ERROR - xem chi tiet o dong <- error phia tren.");
    }

    // Noi dung tin hieu vao 2 watchdog - dung DUNG diem watchdogs.js da thiet
    // ke: "transcript-ready" = khach vua noi 1 luot THAT (onCustomerTurn),
    // "response-started" = bot THAT SU bat dau noi (onBotSpoke). Khong co
    // module nghiep vu nao khac o checkpoint nay nen isBusy() mac dinh
    // (luon false) la dung - khong co gi de "cho ban" ca.
    if (signal.kind === "transcript-ready") {
      muteWatchdog.onCustomerTurn(nowMs());
    }
    if (signal.kind === "response-started") {
      muteWatchdog.onBotSpoke(nowMs());
      responseStartedEvents.push(nowMs());
    }
  },
});

// Boc setVadMode that de nuoi CA vadRestoreWatchdog - dung diem tich hop ma
// docs/roadmap.md da mo ta ("diem goi onCustomerTurn/onBotSpoke/
// onVadModeChanged"). KHONG sua session-ws.js - watchdogs.js van hoan toan
// khong biet gi ve session-ws.js, chi ben goi (checkpoint nay) noi 2 ben lai.
function setVadMode(mode) {
  const result = rawSetVadMode(mode);
  vadRestoreWatchdog.onVadModeChanged(mode, nowMs());
  tee(`[checkpoint-7] setVadMode("${mode}")`);
  return result;
}

// Interval THAT - poll ca 2 watchdog dinh ky, dung DUNG quy uoc checkWatchdog
// (nowMs) THUAN cua watchdogs.js (ben goi tu dat interval, giong danh-bo-
// flow.js#checkWatchdog da lam o checkpoint-giai-doan-6a.mjs). 250ms - ngan
// hon nhieu so voi ca 2 nguong da rut gon o tren, du chinh xac de doi chieu
// thoi diem kich hoat khong bi lech qua nhieu.
const watchdogInterval = setInterval(() => {
  const t = nowMs();
  if (muteWatchdog.checkWatchdog(t)) {
    muteFireEvents.push(t);
    tee(`[checkpoint-7] *** MUTE WATCHDOG KICH HOAT tai +${t}ms *** - tu mo khoa VAD + ep model tra loi.`);
    setVadMode("normal");
    turnController.say({ mode: "guided", instructions: MUTE_RECOVERY_INSTRUCTIONS, toolChoice: "none" });
  }
  if (vadRestoreWatchdog.checkWatchdog(t)) {
    vadRestoreFireEvents.push(t);
    tee(`[checkpoint-7] *** VAD-RESTORE WATCHDOG KICH HOAT tai +${t}ms *** - tu dua turn_detection ve "normal".`);
    setVadMode("normal");
  }
}, 250);

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[checkpoint-7] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});
ws.on("error", (err) => {
  console.error("[checkpoint-7] WS error:", err.message);
});
ws.on("close", (code, reason) => {
  tee(`[checkpoint-7] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

// ── Tien ich stream audio (copy tu checkpoint-giai-doan-6a.mjs/6b.mjs) ─────
function readWavPcm16(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${filePath}: khong phai file WAV hop le (thieu RIFF/WAVE header).`);
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
  if (!fmt || !data) throw new Error(`${filePath}: khong tim thay chunk 'fmt ' hoac 'data'.`);
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`${filePath}: phai la PCM 16-bit (dang gap: audioFormat=${fmt.audioFormat}, bitsPerSample=${fmt.bitsPerSample}).`);
  }
  return { fmt, data };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamAudioFile(filePath, label, trailingSilenceMs) {
  tee(`[checkpoint-7] (${label}) Doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  tee(`[checkpoint-7] (${label}) WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s`);

  const bytesPerSample = 2;
  const frameMs = 20;
  const frameBytes = Math.floor((fmt.sampleRate * frameMs) / 1000) * bytesPerSample;

  for (let i = 0; i < data.length; i += frameBytes) {
    const chunk = data.subarray(i, i + frameBytes);
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
    await sleep(frameMs);
  }
  const silenceFrame = Buffer.alloc(frameBytes);
  for (let i = 0; i < trailingSilenceMs / frameMs; i++) {
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: silenceFrame.toString("base64") }));
    await sleep(frameMs);
  }
  tee(`[checkpoint-7] (${label}) Da phat het file + ${trailingSilenceMs}ms im lang.`);
}

// silence_duration_ms cua "digits" mode la 2000ms (buildTurnDetectionConfig)
// - doi du DAI HON de chac chan server kip commit manh cuoi cung.
const TRAILING_SILENCE_MS = 2500;

function waitForCondition(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (predicate()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`Timeout (${label})`));
      }
    }, 200);
  });
}

// ── main() - dieu khien TUAN TU 2 pha, doi tung buoc that ─────────────────
async function main() {
  await waitForCondition(() => sessionReady, 15000, "cho session-updated dau tien");
  tee("[checkpoint-7] Ket noi san sang.\n[checkpoint-7] === PHA A: mute watchdog ===");

  setVadMode("digits");
  await sleep(300); // "cua so ho hong" ~200-250ms giua luc goi setVadMode va luc server ap dung xong - xem danh-bo-flow.js
  tee("[checkpoint-7] Da khoa VAD 'digits' - phat audio khach noi (khong lien quan noi dung, chi can 1 luot THAT)...");
  await streamAudioFile(AUDIO_KHACH_NOI, "khach-noi", TRAILING_SILENCE_MS);
  tee(
    "[checkpoint-7] Da phat het audio - CO Y KHONG LAM GI CA tu day (khong goi turnController.say(), khong tu " +
      "gui response.create) - gia lap DUNG bug 'code quen tra loi' ma mute watchdog sinh ra de bat.",
  );

  await waitForCondition(
    () => muteFireEvents.length >= 1,
    MUTE_THRESHOLD_MS + 8000,
    "cho mute watchdog tu kich hoat",
  );
  tee(`[checkpoint-7] Mute watchdog da kich hoat tai +${muteFireEvents[0]}ms. Doi model thuc su tra loi xong...`);
  await sleep(3000);

  tee("[checkpoint-7] === PHA B: vad-restore watchdog (doc lap, KHONG co luot khach nao) ===");
  setVadMode("digits");
  tee("[checkpoint-7] Da khoa VAD 'digits' LAN NUA - LAN NAY khong phat audio gi ca, cho vad-restore watchdog tu kich hoat...");

  await waitForCondition(
    () => vadRestoreFireEvents.length >= 1,
    VAD_RESTORE_THRESHOLD_MS + 8000,
    "cho vad-restore watchdog tu kich hoat",
  );
  tee(`[checkpoint-7] Vad-restore watchdog da kich hoat tai +${vadRestoreFireEvents[0]}ms.`);

  await sleep(1000);
  finish(0);
}

main().catch((err) => {
  tee("[checkpoint-7] main() loi:", err.message);
  finish(1);
});

function finish(exitCode) {
  if (finished) return;
  finished = true;
  clearInterval(watchdogInterval);
  setTimeout(() => {
    tee("\n[checkpoint-7] ===== Tom tat =====");
    tee(`[checkpoint-7] Nguong da dung (CHI DE CHECKPOINT, khong phai gia tri san xuat): mute=${MUTE_THRESHOLD_MS}ms, vad-restore=${VAD_RESTORE_THRESHOLD_MS}ms`);
    tee(`[checkpoint-7] muteFireEvents: ${JSON.stringify(muteFireEvents)}`);
    tee(`[checkpoint-7] vadRestoreFireEvents: ${JSON.stringify(vadRestoreFireEvents)}`);
    tee(`[checkpoint-7] responseStartedEvents: ${JSON.stringify(responseStartedEvents)}`);
    tee(`[checkpoint-7] co event error: ${sawError}`);

    const muteKichHoatDungMotLan = muteFireEvents.length === 1;
    // response-started SAU lan mute watchdog kich hoat - bang chung model
    // THAT SU tra loi sau khi bi ep, khong chi la watchdog "bao dong suong".
    const botThatSuTraLoiSauKhiBiEp =
      muteFireEvents.length >= 1 && responseStartedEvents.some((t) => t > muteFireEvents[0]);
    const vadRestoreKichHoatDungMotLan = vadRestoreFireEvents.length === 1;
    // vad-restore CHI duoc kich hoat trong PHA B (sau khi mute da xong) -
    // khong duoc kich hoat som trong pha A (xem gioi han VAD_RESTORE_THRESHOLD_MS dau file).
    const vadRestoreKhongKichHoatSom =
      vadRestoreFireEvents.length === 0 || (muteFireEvents.length >= 1 && vadRestoreFireEvents[0] > muteFireEvents[0]);

    tee(`[checkpoint-7] (a) Mute watchdog kich hoat DUNG 1 lan trong pha A: ${muteKichHoatDungMotLan}`);
    tee(`[checkpoint-7] (b) Sau khi kich hoat, model THAT SU tra loi (response-started moi): ${botThatSuTraLoiSauKhiBiEp}`);
    tee(`[checkpoint-7] (c) Vad-restore watchdog kich hoat DUNG 1 lan (o pha B, doc lap khong can khach noi): ${vadRestoreKichHoatDungMotLan}`);
    tee(`[checkpoint-7] (d) Vad-restore KHONG kich hoat som trong pha A (2 pha tach biet dung thiet ke): ${vadRestoreKhongKichHoatSom}`);

    tee(`[checkpoint-7] Log: ${txtPath}`);
    const ok = muteKichHoatDungMotLan && botThatSuTraLoiSauKhiBiEp && vadRestoreKichHoatDungMotLan && vadRestoreKhongKichHoatSom && !sawError;
    tee(
      `[checkpoint-7] KET QUA: ${
        ok
          ? "PASS - ca 2 watchdog (mute/vad-restore) trong src/session/watchdogs.js hoat dong dung qua Realtime API " +
            "that: tu phat hien dung kich ban 'code quen tra loi'/'quen tra VAD ve normal', tu can thiep dung 1 lan, " +
            "dung thoi diem, khong kich hoat nham/kich hoat som."
          : "CAN XEM LAI - xem 4 dieu kien (a)-(d) o tren de biet dung o buoc nao."
      }`,
    );
    ws.close();
    txtStream.end(() => {
      process.exit(ok ? 0 : (exitCode || 1));
    });
  }, 500);
}

// [120s, KHAC 90s cua checkpoint 6a/6b] Tong ngan sach cho ca 2 pha (tinh ca
// nguong VAD_RESTORE_THRESHOLD_MS=20000 da tang o tren de tranh flaky) co the
// cong lai toi ~65s O MUC "cho toi han timeout" cua tung buoc - 90s qua sat
// nut, chon 120s de co du bien an toan, khong lam checkpoint that bai chi vi
// tinh toan ngan sach thoi gian, khong phai loi watchdog that.
setTimeout(() => {
  if (!finished) {
    tee("[checkpoint-7] TIMEOUT 120s - chua thay du dieu kien PASS, xem log de biet dung o buoc nao.");
    finish(1);
  }
}, 120000);

process.on("SIGINT", () => {
  console.log("\n[checkpoint-7] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});
