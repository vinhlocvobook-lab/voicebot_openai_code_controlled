#!/usr/bin/env node
// scripts/probe-tool-call.mjs
//
// Giai doan 5a (xem docs/roadmap.md) - "Buoc 0" truoc khi lam domain layer:
// CHUA TUNG quan sat that hinh dang event tool/function-call cua Realtime
// API trong du an nay. probe-realtime.mjs (Giai doan 1) va
// checkpoint-giai-doan-4.mjs (Giai doan 4) chua bao gio cau hinh "tools"
// trong session.update. Script nay lam DUNG MOT VIEC: mo ket noi WebSocket
// thuan (khong SIP/Asterisk, giong probe-realtime.mjs), cau hinh 1 tool
// THAT (get_bill, copy nguyen schema tu voice_bot/src/system-prompt.js -
// day chinh la tool se dung that o Giai doan 5 domain layer, khong phai
// tool "do choi" bia dat), gui 1 cau hoi VAN BAN (che do text, theo yeu
// cau) chac chan kich hoat tool nay, roi di HET vong doi that:
//   model xin goi tool -> minh gia lap tra ket qua (function_call_output)
//   -> goi response.create tiep -> model doc cau tra loi.
// Muc dich: biet CHINH XAC ten event nao bao "model muon goi tool", hinh
// dang item ben trong (name/arguments/call_id nam o dau), va cach gui
// function_call_output dung de model tiep tuc - truoc khi sua turn-signal.js
// them "kind" moi va viet dispatcher, thay vi doan mo theo tai lieu chung
// chung cua OpenAI (dung nguyen tac quan sat truoc khi thiet ke, da dung
// cho VAD o Giai doan 1).
//
// CACH CHAY (tu chay tren may, can OPENAI_API_KEY that trong .env):
//   npm run probe:tool
//
// KET QUA: ghi ra logs/probe-tool-call-<timestamp>.jsonl (raw) va .txt
// (y het man hinh). Doc lai .jsonl de xem dung ten field cua tung event.

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import util from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";

if (!API_KEY) {
  console.error("[probe-tool] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

// ── Tool THAT, copy nguyen tu voice_bot/src/system-prompt.js (TOOLS[0],
// "get_bill") - KHONG bia dat, de ket qua quan sat dung voi hinh dang tool
// se dung o domain layer that (xem tongdai-api.js: getTienNuoc). Rut gon
// description cho ngan (khong anh huong hinh dang event, chi anh huong noi
// dung model doc), giu nguyen parameters/required.
const GET_BILL_TOOL = {
  type: "function",
  name: "get_bill",
  description:
    "Tra cuu tien nuoc, trang thai thanh toan va san luong nuoc su dung cua khach hang theo ma danh bo.",
  parameters: {
    type: "object",
    properties: {
      ma_danh_bo: { type: "string", description: "ma danh bo" },
      ky: { type: "integer", description: "Ky (thang) can tra cuu, tuy chon." },
      nam: { type: "integer", description: "Nam can tra cuu, tuy chon." },
    },
    required: ["ma_danh_bo"],
  },
};

// Cau hoi van ban chac chan can goi get_bill (co san ma danh bo trong cau,
// khong can hoi lai) - de khong phu thuoc model co tu hoi lai khong.
const USER_TEXT =
  "Xin chao, cho toi hoi hoa don tien nuoc thang nay voi. Ma danh bo cua toi la 22082351775.";

// Du lieu tra loi GIA LAP goi vao function_call_output - khong goi
// tongdai-api.js that (script nay chi quan sat hinh dang event WebSocket,
// khong phai kiem tra tich hop API that).
const FAKE_BILL_RESULT = {
  success: true,
  data: [{ ky: 7, nam: 2026, tong_tien: 185000, da_thanh_toan: false, san_luong_m3: 14 }],
};

// ── Log ra man hinh + file, giong probe-realtime.mjs ──────────────────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const runTimestamp = Date.now();
const logPath = path.join(logsDir, `probe-tool-call-${runTimestamp}.jsonl`);
const txtPath = path.join(logsDir, `probe-tool-call-${runTimestamp}.txt`);
const logStream = fs.createWriteStream(logPath, { flags: "a" });
const txtStream = fs.createWriteStream(txtPath, { flags: "a" });

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

console.log(`[probe-tool] Model: ${MODEL}`);
console.log(`[probe-tool] Tool cau hinh: ${GET_BILL_TOOL.name}`);
console.log(`[probe-tool] Cau hoi text: "${USER_TEXT}"`);

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
    case "response.output_item.added":
    case "response.output_item.done":
      // [Buoc 0] Day nghi la noi item type="function_call" xuat hien -
      // in het item de doi chieu, chua chac dung ten field tu tai lieu.
      return `item=${JSON.stringify(event.item)}`;
    case "response.function_call_arguments.delta":
      return `call_id=${event.call_id} delta=${JSON.stringify(event.delta)}`;
    case "response.function_call_arguments.done":
      return `call_id=${event.call_id} name=${event.name} arguments=${event.arguments}`;
    case "conversation.item.created":
      return `item=${JSON.stringify(event.item)}`;
    case "response.audio_transcript.delta":
      return JSON.stringify(event.delta ?? "").slice(0, 40);
    case "response.done":
      return `status=${event.response?.status}, output=${JSON.stringify(event.response?.output)}`;
    case "error":
      return JSON.stringify(event.error ?? event).slice(0, 300);
    default:
      return "";
  }
}

// ── Ket noi ──────────────────────────────────────────────────────────────
const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`;
console.log(`[probe-tool] Dang ket noi ${url} ...`);

const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[probe-tool] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

function send(obj) {
  ws.send(JSON.stringify(obj));
  logEvent("out", obj);
}

ws.on("open", () => {
  console.log("[probe-tool] WebSocket da ket noi.");
  send({
    type: "session.update",
    session: {
      type: "realtime",
      tools: [GET_BILL_TOOL],
      tool_choice: "auto",
    },
  });
});

// Trang thai vong doi: chua gui cau hoi (0) -> da gui, cho response dau
// (1, cho function_call) -> da gui function_call_output + response thu 2,
// cho model doc cau tra loi (2) -> xong (3).
let phase = 0;
let pendingCallId = null;

ws.on("message", (raw) => {
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return;
  }
  logEvent("in", event);

  if (event.type === "error") {
    console.error("[probe-tool] Server bao loi:", JSON.stringify(event.error ?? event));
  }

  if (event.type === "session.updated" && phase === 0) {
    phase = 1;
    console.log("[probe-tool] Session da cau hinh tool - gui cau hoi text.");
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: USER_TEXT }],
      },
    });
    send({ type: "response.create", response: {} });
    return;
  }

  // [Buoc 0] Bat function_call TU response.output_item.done (khong dung
  // response.function_call_arguments.done) - ly do: output_item.done mang
  // ca item day du (name/call_id/arguments trong 1 cho), con
  // function_call_arguments.done tach rieng - can quan sat CA HAI de biet
  // event nao thuc su du de dispatcher dung, khoi phai cho ca hai.
  if (event.type === "response.output_item.done" && event.item?.type === "function_call" && phase === 1) {
    phase = 2;
    pendingCallId = event.item.call_id;
    console.log(`[probe-tool] Phat hien function_call: name=${event.item.name}, call_id=${pendingCallId}, arguments=${event.item.arguments}`);
    return;
  }

  if (event.type === "response.done" && phase === 2) {
    phase = 3;
    console.log("[probe-tool] Response dau (xin goi tool) da done - gui function_call_output gia lap roi response.create tiep.");
    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: pendingCallId,
        output: JSON.stringify(FAKE_BILL_RESULT),
      },
    });
    send({ type: "response.create", response: {} });
    return;
  }

  if (event.type === "response.done" && phase === 3) {
    phase = 4;
    console.log("[probe-tool] Response thu 2 (doc ket qua) da done.");
    closeSoon(0);
    return;
  }

  if (event.type === "response.done" && phase === 1) {
    // [Buoc 0] Truong hop bat ngo: response dau da done ma KHONG di qua
    // phase 2 (khong thay function_call nao) - nghia la model KHONG goi
    // tool voi cau hoi nay (vd tra loi thang bang text/audio). Ghi lai ro
    // rang de biet thu nghiem that bai o buoc nao, khong tu suy doan.
    console.warn("[probe-tool] CANH BAO: response dau da done nhung KHONG thay function_call nao ca (model khong goi tool voi cau hoi nay).");
    closeSoon(1);
  }
});

let closing = false;
function closeSoon(exitCode) {
  if (closing) return;
  closing = true;
  setTimeout(() => {
    console.log("\n[probe-tool] ===== Tom tat =====");
    console.log(`[probe-tool] Tong so event: ${eventCount}`);
    console.log("[probe-tool] Theo loai:", eventTally);
    console.log(`[probe-tool] Log day du (jsonl): ${logPath}`);
    console.log(`[probe-tool] Log dang text: ${txtPath}`);
    ws.close();
    logStream.end();
    // [20/08/2026, lap lai fix da lam o checkpoint-giai-doan-4.mjs]
    // txtStream.end() la async - phai doi callback roi moi process.exit(),
    // khong thi mat noi dung ghi sau cung (vd chinh khoi Tom tat nay).
    txtStream.end(() => {
      process.exit(exitCode);
    });
  }, 500);
}

process.on("SIGINT", () => {
  console.log("\n[probe-tool] Ngat boi nguoi dung (Ctrl+C).");
  closeSoon(1);
});

ws.on("error", (err) => {
  console.error("[probe-tool] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`[probe-tool] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});
