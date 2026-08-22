#!/usr/bin/env node
// scripts/checkpoint-giai-doan-5a.mjs
//
// Giai doan 5a (xem docs/roadmap.md). KHAC scripts/probe-tool-call.mjs
// (mo WebSocket THUAN, tu tay xu ly tung event - dung de LAN DAU quan sat
// hinh dang event that, giu nguyen khong sua nua). Script nay chay THAT
// src/session/session-ws.js (connectRealtimeSession, da them tools/
// toolChoice) + src/call-flow/dispatch-tool-call.js voi nhau - xac nhan
// TOAN BO day noi that (khong phai tu tay gui function_call_output nhu
// probe-tool-call.mjs) hoat dong dung, y het cach production se dung.
//
// Handler get_bill o day la GIA LAP (khong goi tongdai-api.js/API that) -
// co y: muc tieu checkpoint nay la xac nhan DAY NOI (session-ws + turn-
// controller + dispatch-tool-call), khong phai xac nhan lai tongdai-api.js
// (da co 13 test rieng voi fetch gia lap). Noi voi API that la buoc sau,
// khi co san moi truong/API key that cua Tong dai.
//
// [22/08/2026] DIEM CAN QUAN SAT KY (chua biet truoc, khong doan): du
// lieu that o probe-tool-call.mjs cho thay response.function_call_arguments
// .done (nguon cua tin hieu tool-call-requested) den TRUOC response.done
// (nguon cua response-ended) trong CUNG 1 response. dispatch-tool-call.js
// goi turnController.say() ngay khi xu ly xong tool-call-requested - nghia
// la say() co the duoc goi trong luc turnController con coi response 1 la
// "active" (response-ended chua toi), khien turn-controller.js gui them
// 1 response.cancel cho response 1 (dang tu hoan tat, khong can huy).
// KHONG ro day co gay loi gi that su khong (vd OpenAI tra loi error, huy
// nham lam mat function_call output) - CHU DICH KHONG sua truoc, de
// checkpoint nay tu quan sat that roi moi quyet dinh co can sua khong,
// dung nguyen tac "quan sat truoc khi thiet ke" cua du an.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env):
//   node scripts/checkpoint-giai-doan-5a.mjs

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
// [fix 22/08/2026] Doi sang co dau day du - xem ghi chu "CHU Y - tieng Viet
// khong dau" o duoi cung file de biet ly do.
const TRANSCRIBE_PROMPT = "Cuộc gọi tổng đài chăm sóc khách hàng công ty cấp nước tại TP.HCM, " +
  "toàn bộ bằng tiếng Việt. Có thể chứa mã danh bộ 11 chữ số, số tiền, " +
  "tên thủ tục: định mức nước, lắp đặt đồng hồ, sang tên, nâng đời đồng hồ.";

if (!API_KEY) {
  console.error("[checkpoint-5a] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

// Tool THAT, rut gon tu voice_bot/src/system-prompt.js (cau truc field giong
// het, phan mo ta rut gon cho vua 1 checkpoint - KHONG phai nguyen van toan
// bo doan prompt goc, vi doan goc co nhac ca ngu canh "Thong tin tu he
// thong" chi ton tai trong system prompt day du, khong hop voi script don
// le nay). [fix 22/08/2026] Doi sang co dau day du - xem ghi chu "CHU Y -
// tieng Viet khong dau" o duoi cung file de biet ly do.
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

const USER_TEXT =
  "Xin chào, cho tôi hỏi hóa đơn tiền nước tháng này với. Mã danh bộ của tôi là 22082351775.";

// ── Log ra file, giong style checkpoint-giai-doan-4.mjs ───────────────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint5a-${runTimestamp}.txt`);
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
// tu (xem ghi chu dau file ve diem can quan sat) ───────────────────────────
const responses = new Map(); // responseId -> { started, ended, status }
let toolCallInfo = null;
let functionOutputSent = false;
let sawError = false;
let sentText = false;
let finished = false;

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
    tee("[checkpoint-5a] tin hieu chuan hoa:", JSON.stringify(signal));

    if (signal.kind === "ignored" && signal.rawType === "session.updated" && !sentText) {
      sentText = true;
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: USER_TEXT }] },
      });
      turnController.say();
      tee("[checkpoint-5a] Da gui cau hoi text + say() - cho model xin goi tool.");
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
        "[checkpoint-5a] CHU Y - diem can quan sat: sap goi dispatcher (se goi turnController.say() " +
          "ngay), trong khi response chua tao tin hieu response-ended tuong ung - xem cac dong sau day " +
          "co response.cancel/error bat thuong lien quan responseId=" + signal.responseId + " khong.",
      );
      dispatcher
        .handleSignal(signal)
        .then(() => {
          functionOutputSent = true;
          tee("[checkpoint-5a] Dispatcher da gui function_call_output + goi say() xong.");
          maybeFinish();
        })
        .catch((err) => {
          tee("[checkpoint-5a] Dispatcher loi bat ngo (KHONG duoc xay ra, dispatcher phai tu bat loi):", err.message);
          finish(1);
        });
    }

    if (signal.kind === "error") {
      sawError = true;
      tee("[checkpoint-5a] NHAN DUOC EVENT ERROR - xem chi tiet o dong <- error phia tren.");
    }
  },
});

const dispatcher = createToolDispatcher({
  send,
  turnController,
  log,
  handlers: {
    // Handler GIA LAP - xem ghi chu dau file ve ly do chua goi tongdai-api.js that.
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
    console.error(`[checkpoint-5a] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

ws.on("error", (err) => {
  console.error("[checkpoint-5a] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  tee(`[checkpoint-5a] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

function maybeFinish() {
  const endedCount = [...responses.values()].filter((r) => r.ended).length;
  // PASS khi: da thay tool-call, da gui xong function_call_output, VA it
  // nhat 2 response rieng biet da ket thuc (response 1 - xin goi tool,
  // response 2 - doc ket qua) - khong doan truoc thu tu chinh xac, chi
  // doan trang thai CUOI CUNG can dat duoc.
  if (toolCallInfo && functionOutputSent && endedCount >= 2) {
    finish(sawError ? 1 : 0);
  }
}

function finish(exitCode) {
  if (finished) return;
  finished = true;
  setTimeout(() => {
    tee("\n[checkpoint-5a] ===== Tom tat =====");
    tee(`[checkpoint-5a] tool-call-requested da thay: ${!!toolCallInfo}` + (toolCallInfo ? ` (name=${toolCallInfo.name}, callId=${toolCallInfo.callId})` : ""));
    tee(`[checkpoint-5a] function_call_output da gui: ${functionOutputSent}`);
    tee(`[checkpoint-5a] So response da ket thuc: ${[...responses.values()].filter((r) => r.ended).length} / ${responses.size} da bat dau`);
    for (const [id, r] of responses.entries()) {
      tee(`[checkpoint-5a]   responseId=${id} started=${r.started} ended=${r.ended} status=${r.status}`);
    }
    tee(`[checkpoint-5a] co event error: ${sawError}`);
    tee(`[checkpoint-5a] isResponseActive() cuoi cung: ${turnController.isResponseActive()}`);
    tee(`[checkpoint-5a] Log: ${txtPath}`);
    const ok = !!toolCallInfo && functionOutputSent && !sawError && [...responses.values()].filter((r) => r.ended).length >= 2;
    tee(`[checkpoint-5a] KET QUA: ${ok ? "PASS - vong doi tool-call chay tron ven qua day that" : "CAN XEM LAI"}`);
    ws.close();
    txtStream.end(() => {
      process.exit(ok ? 0 : (exitCode || 1));
    });
  }, 500);
}

// An toan: neu khong ket thuc trong 20s (vd model khong goi tool lan nay,
// hoac ket noi treo) - tu dong dong, khong de script chay mai.
setTimeout(() => {
  if (!finished) {
    tee("[checkpoint-5a] TIMEOUT 20s - chua thay du dieu kien PASS, xem log de biet dung o buoc nao.");
    finish(1);
  }
}, 20000);

process.on("SIGINT", () => {
  console.log("\n[checkpoint-5a] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});

// ── CHU Y - tieng Viet khong dau ───────────────────────────────────────────
// [fix 22/08/2026] Ban dau GET_BILL_TOOL.description, USER_TEXT va
// TRANSCRIBE_PROMPT o file nay deu la tieng Viet KHONG dau (copy nguyen tu
// scripts/probe-tool-call.mjs). Bi phat hien la LOI - khong co ly do ky
// thuat nao ca, chi la thoi quen viet comment (luon khong dau trong du an
// nay) bi mang nham sang day. 3 truong nay KHAC comment: chung duoc GUI THAT
// qua API cho model doc, khong phai chi de nguoi doc code:
//   - GET_BILL_TOOL.description: anh huong model chon dung luc goi tool hay
//     khong - tieng Viet co dau ro nghia hon, khop voi cach model duoc
//     huan luyen (va khop voi ban that o system-prompt.js).
//   - USER_TEXT: mo phong cau hoi cua khach trong kich ban text mode. STT
//     that (gpt-4o-transcribe) luon tra ve chu CO dau, nen text khong dau o
//     day mo phong SAI thuc te (khong sat luong that: audio -> transcript
//     co dau -> model xu ly).
//   - TRANSCRIBE_PROMPT: dang lo nhat - day la cau "moi" giup model transcribe
//     dung chinh ta ten rieng/thuat ngu. Neu ban than prompt da sai chinh ta
//     (khong dau) thi kho ky vong no moi duoc model tra ve dung chinh ta.
// Da sua ca 3 sang co dau day du, khop van phong voi voice_bot/src/system-
// prompt.js (ban production that). File scripts/probe-tool-call.mjs GIU
// NGUYEN khong sua - file do da ghi ro "quan sat xong, khong sua nua" va
// log/fixture that (test/fixtures/tool-call-events.jsonl) da lay tu dung
// lan chay do, sua lai se lam code va log cu khong con khop nhau.

