#!/usr/bin/env node
// scripts/checkpoint-giai-doan-6a-xac-nhan-sai.mjs
//
// Giai doan 6a (xem docs/roadmap.md). Checkpoint THAT rieng cho kich ban
// "xac nhan SAI qua audio that" - viec uu tien con lai cuoi cung trong 4
// viec da thong nhat voi chu du an (xem docs/fix/giai_doan_6a_audit_kich_
// ban_da_test_20260824.md, "Kịch bản CHƯA được test o muc 1": "xac nhan SAI
// roi doc lai"). KE THUA GAN NHU TOAN BO khung/wiring tu checkpoint-giai-
// doan-6a.mjs (KHONG import lai file do - copy co y, giong quan he 5a/5b da
// co, tranh 1 file thay doi lam hong file kia ma khong ai de y) - CHI khac
// o main() (them 2 buoc: phat audio "sai roi" GIUA luc dang "confirming",
// doi danh-bo-flow.js tu quay lai "asking", roi phat lai audio doc so +
// audio "dung" nhu binh thuong).
//
// MUC DICH THUC NGHIEM (CAN CU THUC NGHIEM, khong doan): xac nhan nhanh
// isNegative() cua src/call-flow/danh-bo-confirm.js hoat dong DUNG khi noi
// qua giong noi that (khong phai tu viet text nhu 18 test cua danh-bo-
// flow.test.mjs) - cu the la handleSignal() phase "confirming" cua danh-
// bo-flow.js: reset session, tang attempts, quay lai "asking", tu goi lai
// askPrompt() - RỒI CÓ THE doc lai so + xac nhan DUNG de hoan tat binh
// thuong (khong bi giveUp() vi moi dung 1/3 luot thu).
//
// Audio dung (tao boi scripts/gen-sample-6a.mjs, xem "them 24/08/2026 #10"
// dau file do):
//   - 6a_doc_so_22023251775.wav - PHAT 2 LAN (lan dau, va lan doc lai sau
//     khi bao SAI - dung LAI CHINH so dung, vi muc dich o day la kiem tra
//     nhanh TU CHOI cua danh-bo-flow.js, KHONG PHAI kiem tra STT nghe sai
//     so nao - da co rieng cac file tap am/ngap ngung cho muc dich do).
//   - 6a_xac_nhan_sai.wav - "Dạ, sai rồi ạ." - PHAT khi dang "confirming"
//     lan 1, kich isNegative() that.
//   - 6a_xac_nhan_dung.wav - PHAT khi dang "confirming" lan 2 (sau khi doc
//     lai), hoan tat luong.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY + TONGDAI_API_* trong .env,
// da chay scripts/gen-sample-6a.mjs de co 3 file audio tren):
//   node scripts/checkpoint-giai-doan-6a-xac-nhan-sai.mjs
//   node scripts/checkpoint-giai-doan-6a-xac-nhan-sai.mjs samples/6_ngap_ngung.wav  # doi file doc so (van phai doc DUNG 22023251775)

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectRealtimeSession } from "../src/session/session-ws.js";
import { createToolDispatcher } from "../src/call-flow/dispatch-tool-call.js";
import { createToolRouter } from "../src/domain/tool-router.js";
import { createDanhBoFlow } from "../src/call-flow/danh-bo-flow.js";
import {
  getTrangThaiTT,
  getSoSanhTangGiam,
  getThongBaoCupNuoc,
  baoSuCo,
  getAvailableAgents,
  setApiLogger,
} from "../src/integrations/tongdai-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuộc gọi tổng đài chăm sóc khách hàng công ty cấp nước tại TP.HCM, " +
  "toàn bộ bằng tiếng Việt. Có thể chứa mã danh bộ 11 chữ số, số tiền, " +
  "tên thủ tục: định mức nước, lắp đặt đồng hồ, sang tên, nâng đời đồng hồ.";

if (!API_KEY) {
  console.error("[checkpoint-6a-sai] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}
if (!/^true$/i.test(process.env.TONGDAI_API_INSECURE_TLS || "")) {
  console.warn(
    "[checkpoint-6a-sai] CANH BAO: TONGDAI_API_INSECURE_TLS khong phai 'true' - neu tunnel test dung cert tu ky " +
      "se loi DEPTH_ZERO_SELF_SIGNED_CERT ngay lan goi API dau tien. Bo qua canh bao nay neu tunnel dung cert hop le.",
  );
}

// Ma danh bo THAT, da xac nhan co du lieu billing (giong checkpoint-giai-
// doan-6a.mjs) - phai KHOP voi so DA DOC trong file audio doc so dang dung.
const MA_DANH_BO = "22023251775";

const AUDIO_DOC_SO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "samples", "6a_doc_so_22023251775.wav");
const AUDIO_XAC_NHAN_SAI = path.join(__dirname, "..", "samples", "6a_xac_nhan_sai.wav");
const AUDIO_XAC_NHAN_DUNG = path.join(__dirname, "..", "samples", "6a_xac_nhan_dung.wav");
for (const f of [AUDIO_DOC_SO, AUDIO_XAC_NHAN_SAI, AUDIO_XAC_NHAN_DUNG]) {
  if (!fs.existsSync(f)) {
    console.error(`[checkpoint-6a-sai] Thieu file audio ${f} - chay truoc: node scripts/gen-sample-6a.mjs`);
    process.exit(1);
  }
}
console.log(`[checkpoint-6a-sai] Dung file audio doc so: ${AUDIO_DOC_SO}`);

// Nguyen van tu voice_bot/src/system-prompt.js#TOOLS (get_bill), giong het
// checkpoint-giai-doan-6a.mjs - dung CUNG schema that de khong lech.
const GET_BILL_TOOL = {
  type: "function",
  name: "get_bill",
  description: `
    Mục đích :
      - Tra cứu tiền nước, trạng thái thanh toán (đã đóng hay chưa, ngày thanh toán), và sản lượng nước sử dụng của khách hàng — CẢ BA thông tin có trong MỘT lần gọi tool này. Khách hỏi bất kỳ thông tin nào trong 3 thứ trên đều gọi tool này, rồi đọc đúng phần khách hỏi (không cần đọc hết cả 3 nếu khách chỉ hỏi 1 thứ, nhưng không cần gọi lại tool nếu khách hỏi tiếp 1 trong 2 thứ còn lại — dữ liệu đã có sẵn trong kết quả).
    Lời thoại để hỏi số danh bộ CHỈ dùng khi ngữ cảnh cuộc gọi thực sự CHƯA có mã danh bộ nào (không có phần "Thông tin từ hệ thống" gợi ý danh bộ) : "Dạ, Quý Khách vui lòng cho em xin số danh bộ để kiểm tra ạ". Nếu ngữ cảnh ĐÃ có mã (tra theo SĐT hoặc lịch sử), đọc lại xin xác nhận theo mục "Thu thập mã danh bộ" — KHÔNG dùng câu này.`,
  parameters: {
    type: "object",
    properties: {
      ma_danh_bo: { type: "string", description: "mã danh bộ" },
      ky: {
        type: "integer",
        description:
          "Kỳ (tháng) cần tra cứu, tùy chọn. CHỈ điền khi khách nói RÕ tháng/kỳ cụ thể. " +
          "Khách nói mơ hồ kiểu 'tháng này', 'gần đây', 'hiện tại', hoặc không nói gì thì BỎ TRỐNG " +
          "field này (đừng tự suy ra từ ngày hiện tại) — hệ thống sẽ tự trả về kỳ gần nhất có dữ liệu.",
      },
      nam: {
        type: "integer",
        description:
          "Năm cần tra cứu, tùy chọn. Cùng quy tắc như ky — chỉ điền khi khách nói rõ, không thì bỏ trống.",
      },
    },
    required: ["ma_danh_bo"],
  },
};

// KHONG doc danh bo - dung y (xem checkpoint-giai-doan-6a.mjs), model se bi
// EP goi get_bill (tool_choice) du khong co danh bo trong cau nay.
const USER_TEXT_KHONG_DANH_BO = "Xin chào, cho tôi hỏi hóa đơn tiền nước tháng 8 năm 2026 với.";

// ── Log ra file, giong style checkpoint-giai-doan-6a.mjs ───────────────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint6a-sai-${runTimestamp}.txt`);
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
setApiLogger(log);

// ── Trang thai quan sat ─────────────────────────────────────────────────
const responses = new Map();
let sawError = false;
let finished = false;
let sentPrecondition = false;
const getBillCalls = [];
const sayCalls = [];

function send(obj) {
  ws.send(JSON.stringify(obj));
  log("out", obj);
}

const { ws, turnController, setVadMode } = connectRealtimeSession({
  apiKey: API_KEY,
  model: MODEL,
  transcribeModel: TRANSCRIBE_MODEL,
  transcribeLanguage: TRANSCRIBE_LANGUAGE,
  transcribePrompt: TRANSCRIBE_PROMPT,
  tools: [GET_BILL_TOOL],
  WebSocketImpl: WebSocket,
  log,
  onSignal(signal) {
    tee("[checkpoint-6a-sai] tin hieu chuan hoa:", JSON.stringify(signal));

    if (signal.kind === "response-started") {
      responses.set(signal.responseId, { started: true, ended: false, status: null });
    }
    if (signal.kind === "response-ended") {
      const r = responses.get(signal.responseId) || { started: true };
      r.ended = true;
      r.status = signal.status;
      responses.set(signal.responseId, r);
    }
    if (signal.kind === "error") {
      sawError = true;
      tee("[checkpoint-6a-sai] NHAN DUOC EVENT ERROR - xem chi tiet o dong <- error phia tren.");
    }

    dispatcher.handleSignal(signal).catch((err) => {
      tee("[checkpoint-6a-sai] Dispatcher loi bat ngo (KHONG duoc xay ra):", err.message);
      finish(1);
    });
    danhBoFlow.handleSignal(signal, Date.now());

    if (signal.kind === "session-updated" && !sentPrecondition) {
      sentPrecondition = true;
      tee("[checkpoint-6a-sai] Ket noi san sang - bom tin nhan text KHONG danh bo + ep tool_choice:'required'.");
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: USER_TEXT_KHONG_DANH_BO }] },
      });
      turnController.say({ mode: "tool", toolChoice: "required" });
    }
  },
});

const callState = {};
const router = createToolRouter({
  getTrangThaiTT,
  getSoSanhTangGiam,
  getThongBaoCupNuoc,
  baoSuCo,
  getAvailableAgents,
  callState,
  log,
});

const handlers = {
  get_bill: async (args) => {
    const out = await router.get_bill(args);
    getBillCalls.push({ args, out });
    return out;
  },
};

let dispatcher;

const danhBoFlow = createDanhBoFlow({
  setVadMode,
  // [sua 24/08/2026 #11, PHAT HIEN THAT khi chay checkpoint nay lan dau -
  // xem giai thich day du trong checkpoint-giai-doan-6a.mjs cung dong sua]
  // KHONG duoc truyen thang `turnController.say` (chot gia tri ham ngay luc
  // nay, TRUOC khi spy ben duoi gan lai property) - dung ham indirection tra
  // cuu LAI property moi lan goi, neu khong askCount/confirmCount o finish()
  // se LUON la 0 du hanh vi that van dung (chi la spy bo sot).
  say: (...args) => turnController.say(...args),
  maxAttempts: 3,
  watchdogMs: 90000,
  log,
  onDone: async (result) => {
    tee("[checkpoint-6a-sai] danhBoFlow.onDone:", JSON.stringify(result));
    if (result.ok) callState.danhBo = result.danhBo;
    await dispatcher.handleDanhBoFlowDone(result);
    setVadMode("normal");
  },
});

dispatcher = createToolDispatcher({ send, turnController, log, handlers, danhBoFlow, now: () => Date.now() });

const originalSay = turnController.say.bind(turnController);
turnController.say = (...args) => {
  sayCalls.push(args[0] ?? null);
  tee("[checkpoint-6a-sai] turnController.say() duoc goi voi tham so:", JSON.stringify(args[0] ?? null));
  return originalSay(...args);
};

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[checkpoint-6a-sai] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});
ws.on("error", (err) => {
  console.error("[checkpoint-6a-sai] WS error:", err.message);
});
ws.on("close", (code, reason) => {
  tee(`[checkpoint-6a-sai] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

// ── Tien ich stream audio (copy y het checkpoint-giai-doan-6a.mjs) ────────
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
  tee(`[checkpoint-6a-sai] (${label}) Doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  tee(
    `[checkpoint-6a-sai] (${label}) WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ` +
      `${(data.length / fmt.sampleRate / 2).toFixed(2)}s`,
  );
  if (fmt.sampleRate !== 24000) {
    tee(
      `[checkpoint-6a-sai] (${label}) CANH BAO: sample rate KHONG phai 24000Hz - Realtime API co the hieu SAI toc do/cao do ` +
        `am thanh, dan toi transcript sai. Neu ket qua checkpoint la CAN XEM LAI, thu convert file nay bang: ` +
        `ffmpeg -i ${filePath} -ar 24000 -ac 1 -sample_fmt s16 ${filePath.replace(".wav", "_24k.wav")}`,
    );
  }

  const bytesPerSample = 2;
  const frameMs = 20;
  const frameBytes = Math.floor((fmt.sampleRate * frameMs) / 1000) * bytesPerSample;

  for (let i = 0; i < data.length; i += frameBytes) {
    const chunk = data.subarray(i, i + frameBytes);
    send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
    await sleep(frameMs);
  }

  const silenceFrame = Buffer.alloc(frameBytes);
  for (let i = 0; i < trailingSilenceMs / frameMs; i++) {
    send({ type: "input_audio_buffer.append", audio: silenceFrame.toString("base64") });
    await sleep(frameMs);
  }
  tee(`[checkpoint-6a-sai] (${label}) Da phat het file + ${trailingSilenceMs}ms im lang.`);
}

const TRAILING_SILENCE_MS = 2500;

function waitForPhase(targetPhases, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const phase = danhBoFlow.getPhase();
      if (targetPhases.includes(phase)) {
        clearInterval(iv);
        resolve(phase);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`Timeout (${label}) cho doi phase [${targetPhases.join("/")}], hien dang o "${phase}"`));
      }
    }, 200);
  });
}

const watchdogInterval = setInterval(() => danhBoFlow.checkWatchdog(Date.now()), 1000);

// ── main() - THEM 2 buoc so voi checkpoint-giai-doan-6a.mjs: phat audio SAI
// giua luc "confirming" lan 1, doi quay lai "asking", roi lam lai y het luot
// dau (doc so + xac nhan, lan nay DUNG) ─────────────────────────────────
async function main() {
  await waitForPhase(["arming", "asking", "confirming", "done", "failed"], 20000, "cho DANH_BO_MISSING kich danhBoFlow.start()");
  tee("[checkpoint-6a-sai] danhBoFlow da bat dau (roi khoi 'idle') - cho vao 'asking' (session-updated cua VAD 'digits')...");

  await waitForPhase(["asking", "confirming", "done", "failed"], 15000, "cho phase 'asking' (lan 1)");
  if (danhBoFlow.getPhase() !== "asking") {
    throw new Error(`Ky vong dang o 'asking' (lan 1) truoc khi phat audio doc so, nhung dang o '${danhBoFlow.getPhase()}'`);
  }
  tee("[checkpoint-6a-sai] Dang o 'asking' (lan 1) - phat audio doc so " + MA_DANH_BO + "...");
  await streamAudioFile(AUDIO_DOC_SO, "doc-so-lan-1", TRAILING_SILENCE_MS);

  await waitForPhase(["confirming", "done", "failed"], 15000, "cho phase 'confirming' (lan 1)");
  if (danhBoFlow.getPhase() !== "confirming") {
    throw new Error(`Ky vong dang o 'confirming' (lan 1) sau khi doc du 11 so, nhung dang o '${danhBoFlow.getPhase()}'`);
  }
  const candidate1 = danhBoFlow.getCandidate();
  tee(`[checkpoint-6a-sai] Dang o 'confirming' (lan 1), candidate thu thap duoc: ${candidate1}`);
  if (candidate1 !== MA_DANH_BO) {
    tee(`[checkpoint-6a-sai] CANH BAO: candidate lan 1 (${candidate1}) KHONG khop MA_DANH_BO ky vong (${MA_DANH_BO}).`);
  }
  tee("[checkpoint-6a-sai] Phat audio xac nhan 'sai roi' (kich isNegative() that)...");
  await streamAudioFile(AUDIO_XAC_NHAN_SAI, "xac-nhan-sai", TRAILING_SILENCE_MS);

  // [them 24/08/2026 #10] Sau khi isNegative() true, danh-bo-flow.js#handle
  // Signal() reset session + chuyen phase="asking" + tu goi askPrompt() NGAY
  // TRONG CUNG 1 lan xu ly tin hieu (dong bo, khong cho gi ca) - cho lai
  // "asking" o day chi de PHONG THU (vd do tre nao do giua cac module), va
  // DE CHAC CHAN khong con dang "confirming" (bang chung phong thu that su
  // la ktra .getPhase() === "asking" ngay duoi day).
  await waitForPhase(["asking", "confirming", "done", "failed"], 15000, "cho quay lai 'asking' sau khi bao SAI");
  if (danhBoFlow.getPhase() !== "asking") {
    throw new Error(
      `Ky vong QUAY LAI 'asking' ngay sau khi bao SAI (isNegative() reset session), nhung dang o '${danhBoFlow.getPhase()}' - ` +
        `neu la 'confirming' co the isNegative() KHONG nhan dung audio 'sai roi' la tu choi (xem transcript that trong log).`,
    );
  }
  tee("[checkpoint-6a-sai] Da quay lai 'asking' sau khi bao SAI - phat LAI audio doc so (lan 2, DUNG so nhu cu)...");
  await streamAudioFile(AUDIO_DOC_SO, "doc-so-lan-2", TRAILING_SILENCE_MS);

  await waitForPhase(["confirming", "done", "failed"], 15000, "cho phase 'confirming' (lan 2)");
  if (danhBoFlow.getPhase() !== "confirming") {
    throw new Error(`Ky vong dang o 'confirming' (lan 2) sau khi doc lai du 11 so, nhung dang o '${danhBoFlow.getPhase()}'`);
  }
  const candidate2 = danhBoFlow.getCandidate();
  tee(`[checkpoint-6a-sai] Dang o 'confirming' (lan 2), candidate thu thap duoc: ${candidate2}`);
  if (candidate2 !== MA_DANH_BO) {
    tee(`[checkpoint-6a-sai] CANH BAO: candidate lan 2 (${candidate2}) KHONG khop MA_DANH_BO ky vong (${MA_DANH_BO}).`);
  }
  tee("[checkpoint-6a-sai] Phat audio xac nhan 'dung roi'...");
  await streamAudioFile(AUDIO_XAC_NHAN_DUNG, "xac-nhan-dung", TRAILING_SILENCE_MS);

  await waitForPhase(["done", "failed"], 15000, "cho danhBoFlow ket thuc (done/failed)");
  tee(`[checkpoint-6a-sai] danhBoFlow ket thuc voi phase: ${danhBoFlow.getPhase()}`);

  // [sua 24/08/2026 #9, xem checkpoint-giai-doan-6a.mjs] 18000ms - khop
  // TONGDAI_API_TIMEOUT_MS that (mac dinh 15000ms) + du de request that su
  // xong + say() verbatim kip gui, tranh checkpoint bao "CAN XEM LAI" gia
  // (thuc chat chi la CHUA KIP xong) nhu da tung xay ra that.
  await sleep(18000);

  finish(0);
}

main().catch((err) => {
  tee("[checkpoint-6a-sai] main() loi:", err.message);
  finish(1);
});

function finish(exitCode) {
  if (finished) return;
  finished = true;
  clearInterval(watchdogInterval);
  setTimeout(() => {
    tee("\n[checkpoint-6a-sai] ===== Tom tat =====");
    tee(`[checkpoint-6a-sai] danhBoFlow.getPhase() cuoi cung: ${danhBoFlow.getPhase()}`);
    tee(`[checkpoint-6a-sai] callState.danhBo cuoi cung: ${callState.danhBo ?? "(chua co)"}`);
    tee(`[checkpoint-6a-sai] So lan goi get_bill (spy): ${getBillCalls.length}`);
    getBillCalls.forEach((c, i) => {
      tee(`[checkpoint-6a-sai]   lan ${i + 1}: args=${JSON.stringify(c.args)} -> out=${JSON.stringify(c.out)}`);
    });
    tee(`[checkpoint-6a-sai] So lan turnController.say() (spy): ${sayCalls.length}`);
    sayCalls.forEach((s, i) => tee(`[checkpoint-6a-sai]   say() lan ${i + 1}: ${JSON.stringify(s)}`));
    tee(`[checkpoint-6a-sai] co event error: ${sawError}`);

    // [them 24/08/2026 #10] So dem 2 cau noi CO Y cua danh-bo-flow.js dua
    // vao DOAN VAN BAN ON DINH lay THANG tu nguon (ASK_PROMPT/buildConfirm
    // Prompt trong src/call-flow/danh-bo-flow.js) - khong so khop CA CAU (de
    // vo tinh gay do neu wording doi 1 chut khong lien quan hanh vi), chi so
    // khop 1 doan dam bao la CHINH cau do, khong phai cau nao khac.
    const askCount = sayCalls.filter(
      (s) => s?.mode === "verbatim" && typeof s.text === "string" && s.text.includes("11 chữ số"),
    ).length;
    const confirmCount = sayCalls.filter(
      (s) => s?.mode === "verbatim" && typeof s.text === "string" && s.text.includes("xác nhận giúp em có đúng không"),
    ).length;
    tee(`[checkpoint-6a-sai] So lan hoi doc so (askPrompt-like): ${askCount} (ky vong 2 - lan dau + lan doc lai sau khi bao SAI)`);
    tee(`[checkpoint-6a-sai] So lan doc lai xin xac nhan (confirmPrompt-like): ${confirmCount} (ky vong 2 - lan bi tu choi + lan duoc xac nhan)`);

    const layDauMissing =
      getBillCalls.length >= 1 &&
      getBillCalls[0].out?.success === false &&
      getBillCalls[0].out?.error_code === "DANH_BO_MISSING";
    const thuThapDungSo = danhBoFlow.getPhase() === "done";
    const callStateDungSo = callState.danhBo === MA_DANH_BO;
    const layLaiThanhCong =
      getBillCalls.length >= 2 &&
      getBillCalls[getBillCalls.length - 1].out?.success === true &&
      Array.isArray(getBillCalls[getBillCalls.length - 1].out?.data) &&
      getBillCalls[getBillCalls.length - 1].out.data.length > 0;
    const dungMotLuotHoiLai = askCount === 2;
    const dungMotLuotXacNhanLai = confirmCount === 2;

    tee(`[checkpoint-6a-sai] (a) Lan dau get_bill tra ve DANH_BO_MISSING that: ${layDauMissing}`);
    tee(`[checkpoint-6a-sai] (b) danhBoFlow ket thuc o 'done' (khong phai 'failed'): ${thuThapDungSo}`);
    tee(`[checkpoint-6a-sai] (c) callState.danhBo dung bang ${MA_DANH_BO}: ${callStateDungSo}`);
    tee(`[checkpoint-6a-sai] (d) Lan goi LAI get_bill (sau xac nhan) THANH CONG voi du lieu that: ${layLaiThanhCong}`);
    tee(`[checkpoint-6a-sai] (e) Dung 1 luot hoi lai so sau khi bao SAI (askCount===2): ${dungMotLuotHoiLai}`);
    tee(`[checkpoint-6a-sai] (f) Dung 1 luot xac nhan lai sau khi bao SAI (confirmCount===2): ${dungMotLuotXacNhanLai}`);

    tee(`[checkpoint-6a-sai] Log: ${txtPath}`);
    const ok =
      layDauMissing &&
      thuThapDungSo &&
      callStateDungSo &&
      layLaiThanhCong &&
      dungMotLuotHoiLai &&
      dungMotLuotXacNhanLai &&
      !sawError;
    tee(
      `[checkpoint-6a-sai] KET QUA: ${
        ok
          ? "PASS - nhanh isNegative() cua danh-bo-flow.js (kich ban 'xac nhan SAI qua audio that') chay tron ven qua " +
            "Realtime API that + audio TTS that: khach bao SAI 1 lan, bot tu hoi lai/doc lai DUNG 1 lan, roi hoan tat " +
            "voi du lieu that."
          : "CAN XEM LAI - xem 6 dieu kien (a)-(f) o tren de biet dung o buoc nao."
      }`,
    );
    ws.close();
    txtStream.end(() => {
      process.exit(ok ? 0 : (exitCode || 1));
    });
  }, 500);
}

setTimeout(() => {
  if (!finished) {
    tee("[checkpoint-6a-sai] TIMEOUT 110s - chua thay du dieu kien PASS, xem log de biet dung o buoc nao.");
    finish(1);
  }
}, 110000);

process.on("SIGINT", () => {
  console.log("\n[checkpoint-6a-sai] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});
