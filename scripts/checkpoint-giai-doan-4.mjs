#!/usr/bin/env node
// scripts/checkpoint-giai-doan-4.mjs
//
// Giai doan 4 (xem docs/roadmap.md). KHAC scripts/probe-realtime.mjs
// (Giai doan 1 - cong cu tham do, giu nguyen, KHONG sua nua o day).
// Script nay chay THAT src/session/session-ws.js (Giai doan 4) - xac
// nhan turn-signal.js + turn-controller.js phoi hop dung voi API that,
// trong kich ban don gian nhat: 1 luot hoi dap tu do (create_response:
// true, model tu tra loi, code khong goi say()).
//
// QUAN TRONG: script nay TU DAY audio tu 1 file WAV mau vao
// input_audio_buffer.append - dieu nay CHI de TEST (mo phong dau vao),
// KHONG PHAI code san xuat. Ban that session-ws.js (connectRealtimeSession)
// khong tu lam viec nay - o san xuat audio den truc tiep tu SIP (xem
// "Rang buoc kien truc" trong docs/roadmap.md).
//
// Diem quan trong ve thiet ke: tu luc ket noi mo ra, script nay CHI doc
// tin hieu qua onSignal (da chuan hoa boi turn-signal.js) de quyet dinh
// khi nao bat dau phat audio / khi nao ket thuc - khong tu doc event tho
// cua OpenAI nua (tru cac su kien cap WebSocket thuan nhu error/close).
// Day chinh la bai test thuc te cho lop chuan hoa: neu khong du de lai
// dieu khien ca luong nay, nghia la turn-signal.js dang thieu gi do.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env - xem
// .env.example, KHONG commit .env):
//   node scripts/checkpoint-giai-doan-4.mjs samples/ten-file.wav
// File WAV phai la mono, 16-bit PCM, 24000Hz (giong yeu cau cua
// probe-realtime.mjs). Vi du file da dung o Giai doan 1:
// samples/1_hoa_don_tien_nuoc_24k.wav (cau hoi thuong, hop nhat kich ban
// "hoi dap tu do" cua Giai doan 4).

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectRealtimeSession } from "../src/session/session-ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuoc goi tong dai cham soc khach hang cong ty cap nuoc tai TP.HCM, " +
  "toan bo bang tieng Viet. Co the chua ma danh bo 11 chu so, so tien, " +
  "ten thu tuc: dinh muc nuoc, lap dat dong ho, sang ten, nang doi dong ho.";

if (!API_KEY) {
  console.error("[checkpoint-4] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

const audioFilePath = process.argv[2];
if (!audioFilePath) {
  console.error("[checkpoint-4] Can truyen duong dan file WAV mau. Vi du:");
  console.error("  node scripts/checkpoint-giai-doan-4.mjs samples/1_hoa_don_tien_nuoc_24k.wav");
  process.exit(1);
}

// ── Log ra file, giong style probe-realtime.mjs, de xem lai duoc ────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const audioSlug = path.basename(audioFilePath, path.extname(audioFilePath)).replace(/[^a-zA-Z0-9_-]+/g, "-");
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint4-${audioSlug}-${runTimestamp}.txt`);
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

let streamed = false;
let responseSeen = false;
let responseDone = false;
let sawError = false;

const { ws, turnController } = connectRealtimeSession({
  apiKey: API_KEY,
  model: MODEL,
  transcribeModel: TRANSCRIBE_MODEL,
  transcribeLanguage: TRANSCRIBE_LANGUAGE,
  transcribePrompt: TRANSCRIBE_PROMPT,
  WebSocketImpl: WebSocket,
  log,
  onSignal(signal) {
    tee("[checkpoint-4] tin hieu chuan hoa:", JSON.stringify(signal));

    if (signal.kind === "ignored" && signal.rawType === "session.updated" && !streamed) {
      streamed = true;
      streamAudioFile(audioFilePath).catch((err) => {
        console.error("[checkpoint-4] Loi khi stream audio:", err.message);
        finish(1);
      });
    }
    if (signal.kind === "response-started") responseSeen = true;
    if (signal.kind === "response-ended") {
      responseDone = true;
      finish(0);
    }
    if (signal.kind === "error") sawError = true;
  },
});

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[checkpoint-4] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

ws.on("error", (err) => {
  console.error("[checkpoint-4] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  tee(`[checkpoint-4] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

// ── Doc + phat WAV (CHI de test dau vao, xem ghi chu dau file) ──────────
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
  return { fmt, data };
}

async function streamAudioFile(filePath) {
  tee(`[checkpoint-4] Doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  tee(`[checkpoint-4] WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s`);

  const bytesPerSample = 2;
  const frameMs = 20;
  const frameBytes = Math.floor((fmt.sampleRate * frameMs) / 1000) * bytesPerSample;

  for (let i = 0; i < data.length; i += frameBytes) {
    const chunk = data.subarray(i, i + frameBytes);
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
    await sleep(frameMs);
  }

  const silenceFrame = Buffer.alloc(frameBytes);
  for (let i = 0; i < 1500 / frameMs; i++) {
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: silenceFrame.toString("base64") }));
    await sleep(frameMs);
  }
  tee("[checkpoint-4] Da phat het file + 1.5s im lang - cho server tu phat hien ket thuc luot noi + tu tao response (create_response:true).");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let finished = false;
function finish(exitCode) {
  if (finished) return;
  finished = true;
  setTimeout(() => {
    tee("\n[checkpoint-4] ===== Tom tat =====");
    tee(`[checkpoint-4] response-started da thay: ${responseSeen}`);
    tee(`[checkpoint-4] response-ended da thay: ${responseDone}`);
    tee(`[checkpoint-4] co event error: ${sawError}`);
    tee(`[checkpoint-4] isResponseActive() cuoi cung: ${turnController.isResponseActive()}`);
    tee(`[checkpoint-4] Log: ${txtPath}`);
    const ok = responseSeen && responseDone && !sawError;
    tee(`[checkpoint-4] KET QUA: ${ok ? "PASS - luong hoi dap tu do chay tron ven" : "CAN XEM LAI"}`);
    ws.close();
    // [21/08/2026] txtStream.end() la BAT DONG BO - goi process.exit()
    // ngay sau se giet tien trinh truoc khi kip ghi het xuong dia (mat
    // dung phan tom tat nay). Doi callback cua .end() bao flush xong roi
    // moi exit.
    txtStream.end(() => {
      process.exit(ok ? 0 : (exitCode || 1));
    });
  }, 500);
}

process.on("SIGINT", () => {
  console.log("\n[checkpoint-4] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});
