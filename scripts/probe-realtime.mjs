#!/usr/bin/env node
// scripts/probe-realtime.mjs
//
// Giai doan 1 (xem docs/roadmap.md): mo MOT KET NOI WEBSOCKET THUAN TUY
// (khong qua SIP/Asterisk, khong qua business logic gi ca) toi OpenAI
// Realtime API, gui cau hinh session toi thieu - GIONG HET "normal mode"
// cua production (xem _setVadMode trong session-ws.js ban cu: semantic_vad,
// eagerness low, create_response:true, interrupt_response:true) - roi log
// NGUYEN VAN tung event server gui ve. Muc dich: tu mat thay thu tu event
// that, khong phai doc lai code cu suy doan.
//
// CACH CHAY (tu chay tren may ban, khong qua cong cu dieu khien tu xa - can
// mang that toi api.openai.com va key that):
//   1) cp .env.example .env   roi dien OPENAI_API_KEY that vao .env
//   2) npm install            (can 'ws' va 'dotenv')
//   3a) Smoke test KHONG can audio (kiem tra ket noi/cau hinh truoc):
//         npm run probe
//   3b) Quan sat VAD that voi mot doan ban tu ghi am:
//         npm run probe -- samples/ten-file.wav
//       File WAV PHAI la: mono, 16-bit PCM, 24000 Hz. Neu ghi am bang Voice
//       Memos/QuickTime (thuong ra m4a, sample rate khac), doi truoc bang
//       ffmpeg:
//         ffmpeg -i ghiam.m4a -ar 24000 -ac 1 -sample_fmt s16 -f wav samples/test.wav
//
// [20/08/2026] BIEN MOI THAM DO THEM (khong sua code, chi doi bien moi
// truong khi chay - xem docs/fix/ de biet ly do can thu nghiem tung bien):
//   PROBE_CREATE_RESPONSE=false   Tat tu dong sinh cau tra loi (locked
//                                  mode giong ban cu). Khi TURN_TYPE khac
//                                  "none": KHONG co event response.done nao
//                                  ca - script tu dong dong sau khi phat het
//                                  audio + mot khoang cho an toan (xem
//                                  NO_RESPONSE_GRACE_MS). Khi TURN_TYPE la
//                                  "none": dieu khien co goi response.create
//                                  thu cong sau khi tu commit hay khong.
//   PROBE_TURN_TYPE=server_vad     Doi tu semantic_vad (mac dinh) sang
//                                  server_vad (kieu cu, dua nguong nang
//                                  luong + khoang lang co dinh) de so sanh.
//   PROBE_TURN_TYPE=none           [20/08/2026] TAT HAN VAD server
//                                  (turn_detection:null). Khong co
//                                  speech_started/speech_stopped/committed
//                                  tu dong nao ca - script tu phat het audio
//                                  roi TU MINH gui input_audio_buffer.commit
//                                  (mot lan duy nhat) de xem co giai quyet
//                                  duoc van de VAD tu tach luot noi thanh
//                                  nhieu manh khi co khoang ngung khong.
//   PROBE_EAGERNESS=low|medium|high|auto   Chi ap dung khi TURN_TYPE la
//                                  semantic_vad. Mac dinh "low" (giong
//                                  production).
//   PROBE_SILENCE_MS=500           Chi ap dung khi TURN_TYPE la server_vad:
//                                  so ms im lang can co truoc khi coi la
//                                  het luot noi.
//   Vi du: PROBE_TURN_TYPE=none PROBE_CREATE_RESPONSE=false npm run probe -- samples/2_22082351775.wav
//
// KET QUA: ghi ra 2 file cung ten (chi khac duoi), vd
// logs/probe-2_22082351775-<timestamp>.jsonl (du lieu tho, moi dong mot
// event) va logs/probe-2_22082351775-<timestamp>.txt (y het nhung gi in ra
// man hinh - khong can tu copy/dan nua). Dong dau tien cua moi lan chay in
// ra ca cau hinh turn_detection dang dung, de doi chieu ve sau khong can
// nho lai da doi bien moi truong nao. Thu muc logs/ va samples/ KHONG duoc
// commit len git (da chan trong .gitignore) vi co the chua noi dung giong
// du lieu that cua khach hang.

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import util from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
// [20/08/2026] Nang cap tu gpt-4o-mini-transcribe: file test doc so danh bo
// (2_22082351775.wav, xem docs/fix/giai_doan_1_quan_sat_event_that_20260820.md)
// tra ve transcript vo nghia chu Bengal - nghi model nho nhan dien nham
// ngon ngu voi doan audio ngan. TRANSCRIBE_LANGUAGE + prompt ngu canh domain
// ben duoi la thu nghiem sua truc tiep loi nay.
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuoc goi tong dai cham soc khach hang cong ty cap nuoc tai TP.HCM, " +
  "toan bo bang tieng Viet. Co the chua ma danh bo 11 chu so, so tien, " +
  "ten thu tuc: dinh muc nuoc, lap dat dong ho, sang ten, nang doi dong ho.";

// [20/08/2026] Bien dieu khien turn_detection - xem chu thich dau file.
const TURN_TYPE = ["server_vad", "none"].includes(process.env.PROBE_TURN_TYPE)
  ? process.env.PROBE_TURN_TYPE
  : "semantic_vad";
const CREATE_RESPONSE = process.env.PROBE_CREATE_RESPONSE !== "false";
const EAGERNESS = process.env.PROBE_EAGERNESS || "low";
const SILENCE_MS = Number(process.env.PROBE_SILENCE_MS || 500);
// Khi khong co response.done tu dong (CREATE_RESPONSE=false, hoac
// TURN_TYPE=none ma khong goi response.create thu cong) -> khong the dua
// vao event do de tu dong dong ket noi nhu binh thuong. Doi them khoang
// nay de kip thay het cac event con den tre roi tu dong dong.
const NO_RESPONSE_GRACE_MS = 4000;

function buildTurnDetection() {
  if (TURN_TYPE === "none") {
    // [20/08/2026] Tat han VAD phia server - app (o day la script probe)
    // tu quan ly toan bo: tu quyet dinh khi nao commit buffer, khi nao
    // goi response.create. Xem docs/fix/ - thu nghiem xem cach nay co
    // tranh duoc viec VAD tu tach 1 luot noi co khoang ngung thanh nhieu
    // item rieng hay khong.
    return null;
  }
  if (TURN_TYPE === "server_vad") {
    return {
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: SILENCE_MS,
      create_response: CREATE_RESPONSE,
      interrupt_response: true,
    };
  }
  return {
    type: "semantic_vad",
    eagerness: EAGERNESS,
    create_response: CREATE_RESPONSE,
    interrupt_response: true,
  };
}
const turnDetectionConfig = buildTurnDetection();

if (!API_KEY) {
  console.error("[probe] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

const audioFilePath = process.argv[2] || null;

// [20/08/2026] Ten file log gan lien ten file audio dau vao - de doi chieu
// nhieu lan chay (vd 2_22082351775.wav) khong bi lan giua cac file .jsonl
// chi khac timestamp. Che do text (khong co audioFilePath) dung nhan "text".
function slugifyAudioName(filePath) {
  if (!filePath) return "text";
  const base = path.basename(filePath, path.extname(filePath));
  const slug = base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "audio";
}
const audioSlug = slugifyAudioName(audioFilePath);

// ── Chuan bi file log ────────────────────────────────────────────────────
// [20/08/2026] Ghi kem file .txt y het nhung gi in ra man hinh (console.log/
// warn/error) - truoc phai tu copy tu terminal, ton thoi gian doi chieu
// nhieu lan chay. File .jsonl (du lieu tho, moi dong mot event) GIU NGUYEN.
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const runTimestamp = Date.now();
const logPath = path.join(logsDir, `probe-${audioSlug}-${runTimestamp}.jsonl`);
const txtPath = path.join(logsDir, `probe-${audioSlug}-${runTimestamp}.txt`);
const logStream = fs.createWriteStream(logPath, { flags: "a" });
const txtStream = fs.createWriteStream(txtPath, { flags: "a" });

// Ghi de console.log/warn/error: van in ra man hinh NHU CU, dong thoi ghi
// nguyen dong do vao file .txt. Dung util.format de giu dung dinh dang khi
// goi console.log voi nhieu tham so (vd console.log("a:", eventTally)).
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
function _tee(origFn, ...args) {
  origFn(...args);
  txtStream.write(util.format(...args) + "\n");
}
console.log = (...args) => _tee(_origLog, ...args);
console.warn = (...args) => _tee(_origWarn, ...args);
console.error = (...args) => _tee(_origError, ...args);

// [20/08/2026] In cau hinh dang dung NGAY DAU log - de moi file .txt tu no
// da du thong tin, khong can nho lai lan chay do da set bien moi truong
// gi. Quan trong khi bat dau thu nghiem nhieu to hop PROBE_* khac nhau.
console.log(`[probe] Cau hinh turn_detection: ${JSON.stringify(turnDetectionConfig)}`);
console.log(`[probe] Model: ${MODEL} | Transcribe: ${TRANSCRIBE_MODEL}`);

const t0 = Date.now();
let eventCount = 0;
const eventTally = {};

function logEvent(direction, event) {
  eventCount += 1;
  eventTally[event.type] = (eventTally[event.type] || 0) + 1;
  const elapsedMs = Date.now() - t0;
  logStream.write(JSON.stringify({ elapsedMs, direction, event }) + "\n");
  const summary = summarize(event);
  console.log(`[+${String(elapsedMs).padStart(6, " ")}ms] ${direction === "in" ? "<-" : "->"} ${event.type}${summary ? "  " + summary : ""}`);
}

function summarize(event) {
  switch (event.type) {
    case "conversation.item.input_audio_transcription.completed":
      return `transcript="${event.transcript}"`;
    case "response.audio_transcript.delta":
      return JSON.stringify(event.delta ?? "").slice(0, 40);
    case "response.done":
      return `status=${event.response?.status}`;
    case "input_audio_buffer.speech_started":
      return `audio_start_ms=${event.audio_start_ms}`;
    case "input_audio_buffer.speech_stopped":
      return `audio_end_ms=${event.audio_end_ms}`;
    case "input_audio_buffer.committed":
      // [20/08/2026] Quan trong voi PROBE_CREATE_RESPONSE=false: moi lan
      // event nay xuat hien la mot lan server tu "chot" buffer thanh 1
      // item rieng - dem so lan xuat hien de biet 1 luot noi co bi tach
      // thanh nhieu manh hay khong.
      return `item_id=${event.item_id}, previous_item_id=${event.previous_item_id}`;
    case "error":
      return JSON.stringify(event.error ?? event).slice(0, 200);
    default:
      return "";
  }
}

// ── Ket noi ──────────────────────────────────────────────────────────────
const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`;
console.log(`[probe] Dang ket noi ${url} ...`);

const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[probe] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

ws.on("open", () => {
  console.log("[probe] WebSocket da ket noi.");

  const sessionUpdate = {
    type: "session.update",
    session: {
      type: "realtime",
      audio: {
        input: {
          transcription: {
            model: TRANSCRIBE_MODEL,
            language: TRANSCRIBE_LANGUAGE,
            prompt: TRANSCRIBE_PROMPT,
          },
          turn_detection: turnDetectionConfig,
        },
      },
    },
  };
  send(sessionUpdate);
});

function send(obj) {
  ws.send(JSON.stringify(obj));
  logEvent("out", obj);
}

let streamed = false;

ws.on("message", (raw) => {
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return;
  }
  logEvent("in", event);

  if (event.type === "session.updated" && !streamed) {
    streamed = true;
    if (audioFilePath) {
      streamAudioFile(audioFilePath).catch((err) => {
        console.error("[probe] Loi khi stream audio:", err.message);
        closeSoon();
      });
    } else {
      runTextSmokeTest();
    }
  }

  if (event.type === "error") {
    console.error("[probe] Server bao loi:", JSON.stringify(event.error ?? event));
  }

  if (event.type === "response.done") {
    closeSoon();
  }
});

function runTextSmokeTest() {
  console.log("[probe] Che do TEXT (khong co file audio) - gui mot cau hoi mau.");
  send({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Xin chao, cho toi hoi ve hoa don tien nuoc thang nay." }],
    },
  });
  send({ type: "response.create", response: {} });
}

// ── Doc WAV toi gian (khong dung thu vien ngoai) ──────────────────────────
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
    throw new Error(`File phai la PCM 16-bit (dang gap: audioFormat=${fmt.audioFormat}, bitsPerSample=${fmt.bitsPerSample}). Doi bang ffmpeg -sample_fmt s16.`);
  }
  if (fmt.numChannels !== 1) {
    console.warn(`[probe] CANH BAO: file co ${fmt.numChannels} kenh, Realtime API mong doi mono.`);
  }
  if (fmt.sampleRate !== 24000) {
    console.warn(`[probe] CANH BAO: sample rate ${fmt.sampleRate}Hz, Realtime API mong doi 24000Hz. Doi bang: ffmpeg -i in.wav -ar 24000 -ac 1 -sample_fmt s16 out.wav`);
  }
  return { fmt, data };
}

async function streamAudioFile(filePath) {
  console.log(`[probe] Che do AUDIO - doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  console.log(`[probe] WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s`);

  const bytesPerSample = 2;
  const frameMs = 20;
  const frameBytes = Math.floor((fmt.sampleRate * frameMs) / 1000) * bytesPerSample;

  for (let i = 0; i < data.length; i += frameBytes) {
    const chunk = data.subarray(i, i + frameBytes);
    send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
    await sleep(frameMs);
  }

  if (TURN_TYPE === "none") {
    // [20/08/2026] Khong co VAD server -> khong co gi tu dong ca. Tu minh
    // chot (commit) buffer MOT LAN DUY NHAT sau khi phat het audio, roi
    // (neu duoc yeu cau) tu minh goi response.create. Muc dich: xem 1 luot
    // noi lien tuc (co khoang ngung tu nhien ben trong) co con bi tach
    // thanh nhieu conversation.item nhu khi de VAD tu quyet dinh khong.
    console.log("[probe] turn_detection=null - KHONG co VAD server, tu minh commit buffer (1 lan).");
    send({ type: "input_audio_buffer.commit" });
    if (CREATE_RESPONSE) {
      send({ type: "response.create", response: {} });
    } else {
      console.log(`[probe] create_response=false (thu cong) -> cho them ${NO_RESPONSE_GRACE_MS}ms roi tu dong dong.`);
      await sleep(NO_RESPONSE_GRACE_MS);
      closeSoon();
    }
    return;
  }

  const silenceFrame = Buffer.alloc(frameBytes);
  for (let i = 0; i < 1500 / frameMs; i++) {
    send({ type: "input_audio_buffer.append", audio: silenceFrame.toString("base64") });
    await sleep(frameMs);
  }
  console.log("[probe] Da phat het file + 1.5s im lang - cho server tu phat hien ket thuc luot noi.");

  if (!CREATE_RESPONSE) {
    // [20/08/2026] create_response:false -> KHONG bao gio co response.done
    // de tu dong trigger closeSoon() nhu binh thuong. Doi them mot khoang
    // an toan de kip thay het cac event con den tre (vd nhieu lan
    // input_audio_buffer.committed neu buffer bi tach lam nhieu manh) roi
    // tu dong dong.
    console.log(`[probe] create_response=false -> cho them ${NO_RESPONSE_GRACE_MS}ms roi tu dong dong (se khong co response.done).`);
    await sleep(NO_RESPONSE_GRACE_MS);
    closeSoon();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let closing = false;
function closeSoon() {
  if (closing) return;
  closing = true;
  setTimeout(() => {
    console.log("\n[probe] ===== Tom tat =====");
    console.log(`[probe] Cau hinh turn_detection: ${JSON.stringify(turnDetectionConfig)}`);
    console.log(`[probe] Tong so event: ${eventCount}`);
    console.log("[probe] Theo loai:", eventTally);
    console.log(`[probe] Log day du (jsonl): ${logPath}`);
    console.log(`[probe] Log dang text: ${txtPath}`);
    ws.close();
    logStream.end();
    txtStream.end();
    process.exit(0);
  }, 500);
}

process.on("SIGINT", () => {
  console.log("\n[probe] Ngat boi nguoi dung (Ctrl+C).");
  closeSoon();
});

ws.on("error", (err) => {
  console.error("[probe] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`[probe] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});
