#!/usr/bin/env node
// scripts/checkpoint-giai-doan-5a-audio.mjs
//
// Giai doan 5a (xem docs/roadmap.md). Ban AUDIO cua scripts/checkpoint-
// giai-doan-5a.mjs (ban text) - CUNG day noi that (session-ws.js +
// dispatch-tool-call.js + tool get_bill gia lap), nhung input la audio
// WAV mau (dung lai dung cach stream cua scripts/checkpoint-giai-doan-
// 4.mjs) thay vi conversation.item.create + say() bang text.
//
// LY DO CAN BAN RIENG NAY (khong chi dung lai ban text da PASS): ban text
// dung turnController.say() de tao response 1 (chua tool-call) - nghia la
// turn-controller.js CO track response do la active (qua hang doi trong
// say()). Nhung o san xuat that, audio khach noi kich hoat response qua
// semantic_vad + create_response:true - response do la SERVER TU TAO,
// KHONG qua say() - va turn-controller.js đa biet tu Giai doan 3/4 la
// KHONG track duoc response tu tao nay la active (hang doi rong luc
// response.created toi -> bi bo qua co y, xem canh bao trong turn-
// controller.js). Day la 1 gioi han DA BIET nhung CHUA TUNG duoc test
// cung luc voi tool-calling - ban audio nay de quan sat that xem ket hop
// "response tu tao qua VAD" + "co tool-call ben trong" co on khong, thay
// vi doan tu code (dung nguyen tac "test truoc khi doan" cua du an).
//
// Handler get_bill o day van la GIA LAP - cung ly do nhu ban text (xem
// checkpoint-giai-doan-5a.mjs).
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env):
//   node scripts/checkpoint-giai-doan-5a-audio.mjs samples/ten-file.wav
// File WAV phai la mono, 16-bit PCM, 24000Hz (giong yeu cau cua
// checkpoint-giai-doan-4.mjs/probe-realtime.mjs). Noi dung nen la 1 cau
// DUY NHAT vua hoi vua doc luon ma danh bo (vd "Xin chao, cho toi hoi hoa
// don tien nuoc thang nay voi. Ma danh bo cua toi la 22082351775.") - vi
// checkpoint nay KHONG nap instructions tu system-prompt.js (chi co
// schema tool), khong co logic "hoi lai xin ma danh bo" - can du thong
// tin trong 1 luot de model goi tool ngay, giong het kich ban ban text.

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectRealtimeSession } from "../src/session/session-ws.js";
import { createToolDispatcher } from "../src/call-flow/dispatch-tool-call.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuộc gọi tổng đài chăm sóc khách hàng công ty cấp nước tại TP.HCM, " +
  "toàn bộ bằng tiếng Việt. Có thể chứa mã danh bộ 11 chữ số, số tiền, " +
  "tên thủ tục: định mức nước, lắp đặt đồng hồ, sang tên, nâng đời đồng hồ.";

if (!API_KEY) {
  console.error("[checkpoint-5a-audio] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

const audioFilePath = process.argv[2];
if (!audioFilePath) {
  console.error("[checkpoint-5a-audio] Can truyen duong dan file WAV mau. Vi du:");
  console.error("  node scripts/checkpoint-giai-doan-5a-audio.mjs samples/5a_hoi_tien_nuoc_22082351775_24k.wav");
  process.exit(1);
}

// Tool THAT, giong het ban text (xem checkpoint-giai-doan-5a.mjs de biet
// ly do rut gon + vi sao co dau day du).
const GET_BILL_TOOL = {
  type: "function",
  name: "get_bill",
  description:
    "Tra cứu tiền nước, trạng thái thanh toán và sản lượng nước sử dụng của khách hàng theo mã danh bộ.",
  parameters: {
    type: "object",
    properties: {
      ma_danh_bo: { type: "string", description: "Mã danh bộ" },
      ky: { type: "integer", description: "Kỳ (tháng) cần tra cứu, tùy chọn." },
      nam: { type: "integer", description: "Năm cần tra cứu, tùy chọn." },
    },
    required: ["ma_danh_bo"],
  },
};

// ── Log ra file, giong style checkpoint-giai-doan-4.mjs/5a ────────────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const audioSlug = path.basename(audioFilePath, path.extname(audioFilePath)).replace(/[^a-zA-Z0-9_-]+/g, "-");
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint5a-audio-${audioSlug}-${runTimestamp}.txt`);
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

// ── Trang thai quan sat - dung theo tung responseId, KHONG doan truoc thu
// tu (giong het ban text) ──────────────────────────────────────────────────
const responses = new Map(); // responseId -> { started, ended, status }
let toolCallInfo = null;
let functionOutputSent = false;
let sawError = false;
let streamed = false;
let finished = false;

// [bo sung 23/08/2026 - giong het checkpoint-giai-doan-5a.mjs ban text,
// xem ghi chu day du o do] Truoc day chi doi 2 response ket thuc roi dong
// ngay - khong bao gio thay say() (hoan lai) thuc su TAO VA HOAN TAT duoc
// response thu 3 hay khong, chi thay no duoc GOI (dong "-> response.create").
// Nang len 3 de tu xac nhan het vong doi ngay tren duong audio+VAD that,
// KHONG can cho toi khi noi that (SIP) moi biet duoc dieu nay.
const RESPONSES_ENDED_FOR_PASS = 3;

function send(obj) {
  ws.send(JSON.stringify(obj));
  log("out", obj);
}

const { ws, turnController } = connectRealtimeSession({
  apiKey: API_KEY,
  model: MODEL,
  transcribeModel: TRANSCRIBE_MODEL,
  transcribeLanguage: TRANSCRIBE_LANGUAGE,
  transcribePrompt: TRANSCRIBE_PROMPT,
  tools: [GET_BILL_TOOL],
  WebSocketImpl: WebSocket,
  log,
  onSignal(signal) {
    tee("[checkpoint-5a-audio] tin hieu chuan hoa:", JSON.stringify(signal));

    // [KHAC ban text] khong gui conversation.item.create + say() - phat
    // audio WAV mau vao input_audio_buffer.append, de semantic_vad
    // (create_response:true, cau hinh trong session-ws.js) TU PHAT HIEN
    // het luot noi va TU TAO response - day chinh la duong san xuat that.
    if (signal.kind === "ignored" && signal.rawType === "session.updated" && !streamed) {
      streamed = true;
      streamAudioFile(audioFilePath).catch((err) => {
        console.error("[checkpoint-5a-audio] Loi khi stream audio:", err.message);
        finish(1);
      });
    }

    if (signal.kind === "response-started") {
      responses.set(signal.responseId, { started: true, ended: false, status: null });
    }

    if (signal.kind === "response-ended") {
      const r = responses.get(signal.responseId) || { started: true };
      r.ended = true;
      r.status = signal.status;
      responses.set(signal.responseId, r);
      maybeFinish();
    }

    if (signal.kind === "tool-call-requested") {
      toolCallInfo = signal;
      tee(
        "[checkpoint-5a-audio] CHU Y - diem can quan sat: response chua tool-call nay co the la response " +
          "SERVER TU TAO qua VAD (khong qua say()) - turn-controller.js co the CHUA tung track no la active " +
          "(xem canh bao 'hang doi rong' o cac dong ban WS phia tren neu co). Dispatcher van se gui " +
          "function_call_output NGAY va HOAN say() toi khi thay dung response-ended cua responseId=" +
          signal.responseId + " - xem cac dong sau day co response.cancel/error bat thuong khong, va " +
          "say() (dong -> response.create) co dung lich sau response-ended khong.",
      );
    }

    // Giong het ban text - chuyen MOI tin hieu cho dispatcher (khong rieng
    // gi tool-call-requested), vi dispatch-tool-call.js can ca response-
    // ended de biet luc nao an toan goi say() (xem ghi chu dau file do).
    dispatcher
      .handleSignal(signal)
      .then(() => {
        if (signal.kind === "tool-call-requested") {
          functionOutputSent = true;
          tee("[checkpoint-5a-audio] Dispatcher da gui function_call_output (say() con hoan lai).");
          maybeFinish();
        }
      })
      .catch((err) => {
        tee("[checkpoint-5a-audio] Dispatcher loi bat ngo (KHONG duoc xay ra, dispatcher phai tu bat loi):", err.message);
        finish(1);
      });

    if (signal.kind === "error") {
      sawError = true;
      tee("[checkpoint-5a-audio] NHAN DUOC EVENT ERROR - xem chi tiet o dong <- error phia tren.");
    }
  },
});

const dispatcher = createToolDispatcher({
  send,
  turnController,
  log,
  handlers: {
    // Handler GIA LAP - xem ghi chu dau file checkpoint-giai-doan-5a.mjs.
    get_bill: async (args) => ({
      success: true,
      data: [
        {
          ky: args.ky ?? 8,
          nam: args.nam ?? 2026,
          tong_tien: 185000,
          da_thanh_toan: false,
          san_luong_m3: 14,
        },
      ],
    }),
  },
});

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[checkpoint-5a-audio] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

ws.on("error", (err) => {
  console.error("[checkpoint-5a-audio] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  tee(`[checkpoint-5a-audio] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

// ── Doc + phat WAV (CHI de test dau vao, giong het checkpoint-giai-doan-
// 4.mjs - khong sua lai logic da xac nhan chay dung o do) ──────────────────
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
  tee(`[checkpoint-5a-audio] Doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  tee(`[checkpoint-5a-audio] WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s`);

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
  tee("[checkpoint-5a-audio] Da phat het file + 1.5s im lang - cho server tu phat hien ket thuc luot noi + tu tao response (create_response:true).");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maybeFinish() {
  const endedCount = [...responses.values()].filter((r) => r.ended).length;
  // PASS khi: da thay tool-call, da gui xong function_call_output, VA it
  // nhat RESPONSES_ENDED_FOR_PASS response rieng biet da ket thuc - giong
  // het tieu chi ban text (xem ghi chu tren dau bien RESPONSES_ENDED_FOR_PASS).
  if (toolCallInfo && functionOutputSent && endedCount >= RESPONSES_ENDED_FOR_PASS) {
    finish(sawError ? 1 : 0);
  }
}

function finish(exitCode) {
  if (finished) return;
  finished = true;
  setTimeout(() => {
    tee("\n[checkpoint-5a-audio] ===== Tom tat =====");
    tee(`[checkpoint-5a-audio] tool-call-requested da thay: ${!!toolCallInfo}` + (toolCallInfo ? ` (name=${toolCallInfo.name}, callId=${toolCallInfo.callId})` : ""));
    tee(`[checkpoint-5a-audio] function_call_output da gui: ${functionOutputSent}`);
    tee(`[checkpoint-5a-audio] So response da ket thuc: ${[...responses.values()].filter((r) => r.ended).length} / ${responses.size} da bat dau`);
    for (const [id, r] of responses.entries()) {
      tee(`[checkpoint-5a-audio]   responseId=${id} started=${r.started} ended=${r.ended} status=${r.status}`);
    }
    tee(`[checkpoint-5a-audio] co event error: ${sawError}`);
    tee(`[checkpoint-5a-audio] isResponseActive() cuoi cung: ${turnController.isResponseActive()}`);
    tee(`[checkpoint-5a-audio] Log: ${txtPath}`);
    const ok =
      !!toolCallInfo &&
      functionOutputSent &&
      !sawError &&
      [...responses.values()].filter((r) => r.ended).length >= RESPONSES_ENDED_FOR_PASS;
    tee(`[checkpoint-5a-audio] KET QUA: ${ok ? "PASS - vong doi tool-call chay tron ven qua duong audio+VAD that, KE CA say() hoan lai da hoan tat" : "CAN XEM LAI"}`);
    ws.close();
    txtStream.end(() => {
      process.exit(ok ? 0 : (exitCode || 1));
    });
  }, 500);
}

// An toan: neu khong ket thuc trong 30s (vd model khong goi tool lan nay,
// hoac ket noi treo) - tu dong dong, khong de script chay mai. [nang tu
// 20s -> 30s ngay 23/08/2026 cung luc voi RESPONSES_ENDED_FOR_PASS: 2->3 -
// ban audio da ton ~16-17s chi de phat het file WAV + 1.5s im lang truoc
// khi response 1 con kip bat dau, nen can nhieu du dia hon ban text de
// con kip cho them response 3 hoan tat.]
setTimeout(() => {
  if (!finished) {
    tee("[checkpoint-5a-audio] TIMEOUT 30s - chua thay du dieu kien PASS, xem log de biet dung o buoc nao.");
    finish(1);
  }
}, 30000);

process.on("SIGINT", () => {
  console.log("\n[checkpoint-5a-audio] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});
