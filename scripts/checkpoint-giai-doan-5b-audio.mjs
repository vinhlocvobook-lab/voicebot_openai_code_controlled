#!/usr/bin/env node
// scripts/checkpoint-giai-doan-5b-audio.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Ban AUDIO cua checkpoint-giai-doan-
// 5b.mjs (ban text) - CUNG doi tuong xac nhan (tool-router.js/billing.js/
// tongdai-api.js THAT noi vao 1 cuoc goi Realtime that), nhung input la
// audio WAV mau thay vi conversation.item.create + say() bang text. Khung
// stream audio + doc WAV giu NGUYEN tu checkpoint-giai-doan-5a-audio.mjs
// (readWavPcm16/streamAudioFile - da xac nhan dung, khong sua lai).
//
// LY DO CAN BAN RIENG NAY (giong ly do 5a co ban audio rieng): response
// chua tool-call o day co the la response SERVER TU TAO qua semantic_vad
// (KHONG qua say()) - khac voi ban text dung say() de tao response. Ban
// audio nay xac nhan "response tu tao qua VAD" + "tool-call goi handler
// THAT (khong con gia lap)" ket hop co on khong.
//
// Mau WAV: dung file do scripts/gen-sample-5b.mjs tao (TTS that, doc danh
// bo 22023251775 - CO du lieu that, KHAC han mau cu cua 5a-audio dung danh
// bo 22082351775 la CUSTOMER_NOT_FOUND trong moi truong test hien tai).
// Mac dinh doc samples/5b_hoi_tien_nuoc_22023251775_24k.wav, co the truyen
// duong dan khac qua argv[2].
//
// CACH CHAY (tren may that, can OPENAI_API_KEY + TONGDAI_API_* trong .env -
// xem checkpoint-giai-doan-5b.mjs de biet chi tiet bien moi truong):
//   node scripts/gen-sample-5b.mjs                       # (1 lan, tao mau)
//   node scripts/checkpoint-giai-doan-5b-audio.mjs        # (dung mau mac dinh)
//   node scripts/checkpoint-giai-doan-5b-audio.mjs duong/dan/khac.wav

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectRealtimeSession } from "../src/session/session-ws.js";
import { createToolDispatcher } from "../src/call-flow/dispatch-tool-call.js";
import { createToolRouter } from "../src/domain/tool-router.js";
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
  console.error("[checkpoint-5b-audio] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}
if (!/^true$/i.test(process.env.TONGDAI_API_INSECURE_TLS || "")) {
  console.warn(
    "[checkpoint-5b-audio] CANH BAO: TONGDAI_API_INSECURE_TLS khong phai 'true' - neu tunnel test dung cert tu " +
      "ky se loi DEPTH_ZERO_SELF_SIGNED_CERT ngay lan goi API dau tien. Bo qua canh bao nay neu tunnel dung cert hop le.",
  );
}

const MA_DANH_BO = "22023251775";

const audioFilePath =
  process.argv[2] || path.join(__dirname, "..", "samples", "5b_hoi_tien_nuoc_22023251775_24k.wav");
if (!fs.existsSync(audioFilePath)) {
  console.error(`[checkpoint-5b-audio] Khong thay file WAV mau: ${audioFilePath}`);
  console.error("[checkpoint-5b-audio] Chay 'node scripts/gen-sample-5b.mjs' truoc de tao mau, hoac truyen duong dan khac qua argv[2].");
  process.exit(1);
}

// Nguyen van tu voice_bot/src/system-prompt.js#TOOLS (get_bill) - giong het
// checkpoint-giai-doan-5b.mjs (ban text).
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

// ── Log ra file, giong style checkpoint-giai-doan-5b.mjs/5a-audio.mjs ─────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const audioSlug = path.basename(audioFilePath, path.extname(audioFilePath)).replace(/[^a-zA-Z0-9_-]+/g, "-");
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint5b-audio-${audioSlug}-${runTimestamp}.txt`);
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
let toolCallInfo = null;
let functionOutputSent = false;
let sawError = false;
let streamed = false;
let finished = false;

// [sua 23/08/2026, sau 2 lan chay that - xem giai thich day du o
// checkpoint-giai-doan-5b.mjs] Ban dau copy 3 tu 5a, nhung 1 vong tool-call
// binh thuong (kha ca duong audio+VAD) chi co DUNG 2 response - sua ve 2.
const RESPONSES_ENDED_FOR_PASS = 2;

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
    tee("[checkpoint-5b-audio] tin hieu chuan hoa:", JSON.stringify(signal));

    if (signal.kind === "ignored" && signal.rawType === "session.updated" && !streamed) {
      streamed = true;
      streamAudioFile(audioFilePath).catch((err) => {
        console.error("[checkpoint-5b-audio] Loi khi stream audio:", err.message);
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
        "[checkpoint-5b-audio] CHU Y - diem can quan sat: response chua tool-call co the la response SERVER " +
          "TU TAO qua VAD (khong qua say()). Dispatcher se goi tool-router.js -> billing.js -> tongdai-api.js " +
          "THAT - xem dong 'tongdai-api: -> GET .../<- 200' de thay yeu cau/tra loi that.",
      );
    }

    dispatcher
      .handleSignal(signal)
      .then(() => {
        if (signal.kind === "tool-call-requested") {
          functionOutputSent = true;
          tee("[checkpoint-5b-audio] Dispatcher da gui function_call_output (say() con hoan lai).");
          maybeFinish();
        }
      })
      .catch((err) => {
        tee("[checkpoint-5b-audio] Dispatcher loi bat ngo (KHONG duoc xay ra, dispatcher phai tu bat loi):", err.message);
        finish(1);
      });

    if (signal.kind === "error") {
      sawError = true;
      tee("[checkpoint-5b-audio] NHAN DUOC EVENT ERROR - xem chi tiet o dong <- error phia tren.");
    }
  },
});

// [sua 24/08/2026, Giai doan 6a] resolveDanhBoRef doi sang ban THAT - chi
// tin callState.danhBo, bo qua hoan toan rawArg model truyen vao (xem ghi
// chu day du trong scripts/checkpoint-giai-doan-5b.mjs va src/domain/
// resolve-danh-bo-ref.js). Gan truoc o day de MO PHONG "danh bo DA duoc
// danh-bo-flow.js xac nhan tu truoc" - vi vay tu lan chay nay tro di,
// checkpoint se KHONG con tai hien duoc phat hien "model nghe dung nhung
// viet lai sai 1 so" da ghi trong docs/roadmap.md (Giai doan 5b) - dung y
// muon: chinh Giai doan 6a duoc dung ra de xoa bo hoan toan duong hong do
// (model khong con co co hoi lam sai lech du lieu tra cuu nua, bat ke nghe
// dung hay sai). Muon tai hien lai phat hien cu (chi de doi chieu lich su,
// KHONG con phan anh hanh vi that cua he thong sau Giai doan 6a) thi doi
// dong nay lai thanh `const callState = {};`.
const callState = { danhBo: MA_DANH_BO };
const router = createToolRouter({
  getTrangThaiTT,
  getSoSanhTangGiam,
  getThongBaoCupNuoc,
  baoSuCo,
  getAvailableAgents,
  callState,
  log,
});

let lastGetBillOutput = null;
const handlers = {
  get_bill: async (args) => {
    const out = await router.get_bill(args);
    lastGetBillOutput = out;
    return out;
  },
};

const sayCalls = [];
const originalSay = turnController.say.bind(turnController);
turnController.say = (...args) => {
  sayCalls.push(args[0] ?? null);
  tee(`[checkpoint-5b-audio] turnController.say() duoc goi voi tham so:`, JSON.stringify(args[0] ?? null));
  return originalSay(...args);
};

const dispatcher = createToolDispatcher({ send, turnController, log, handlers });

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[checkpoint-5b-audio] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

ws.on("error", (err) => {
  console.error("[checkpoint-5b-audio] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  tee(`[checkpoint-5b-audio] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

// ── Doc + phat WAV (giu NGUYEN tu checkpoint-giai-doan-5a-audio.mjs, da xac
// nhan dung o do - khong sua lai) ──────────────────────────────────────────
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
  tee(`[checkpoint-5b-audio] Doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  tee(`[checkpoint-5b-audio] WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s`);
  if (fmt.sampleRate !== 24000 || fmt.numChannels !== 1) {
    tee(
      "[checkpoint-5b-audio] CANH BAO: file KHONG phai 24000Hz mono - Realtime API khong tu resample, ket qua " +
        "co the khong dung. Convert bang: ffmpeg -i " + filePath + " -ar 24000 -ac 1 -sample_fmt s16 <file_moi>.wav",
    );
  }

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
  tee("[checkpoint-5b-audio] Da phat het file + 1.5s im lang - cho server tu phat hien ket thuc luot noi + tu tao response (create_response:true).");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maybeFinish() {
  const endedCount = [...responses.values()].filter((r) => r.ended).length;
  if (toolCallInfo && functionOutputSent && endedCount >= RESPONSES_ENDED_FOR_PASS) {
    finish(sawError ? 1 : 0);
  }
}

function finish(exitCode) {
  if (finished) return;
  finished = true;
  setTimeout(() => {
    tee("\n[checkpoint-5b-audio] ===== Tom tat =====");
    tee(`[checkpoint-5b-audio] tool-call-requested da thay: ${!!toolCallInfo}` + (toolCallInfo ? ` (name=${toolCallInfo.name}, callId=${toolCallInfo.callId})` : ""));
    tee(`[checkpoint-5b-audio] function_call_output da gui: ${functionOutputSent}`);
    tee(`[checkpoint-5b-audio] So response da ket thuc: ${[...responses.values()].filter((r) => r.ended).length} / ${responses.size} da bat dau`);
    for (const [id, r] of responses.entries()) {
      tee(`[checkpoint-5b-audio]   responseId=${id} started=${r.started} ended=${r.ended} status=${r.status}`);
    }
    tee(`[checkpoint-5b-audio] co event error: ${sawError}`);
    tee(`[checkpoint-5b-audio] isResponseActive() cuoi cung: ${turnController.isResponseActive()}`);

    const gotRealData =
      !!lastGetBillOutput && lastGetBillOutput.success === true &&
      Array.isArray(lastGetBillOutput.data) && lastGetBillOutput.data.length > 0;
    tee(`[checkpoint-5b-audio] get_bill output that (spy):`, JSON.stringify(lastGetBillOutput));
    tee(`[checkpoint-5b-audio] co du lieu hoa don that (success:true + data khong rong): ${gotRealData}`);

    const sayLooksAuto = sayCalls.length > 0 && !sayCalls[sayCalls.length - 1];
    tee(`[checkpoint-5b-audio] say() duoc goi ${sayCalls.length} lan, danh sach tham so:`, JSON.stringify(sayCalls));
    tee(`[checkpoint-5b-audio] lan say() cuoi la mode "auto" (tham so rong, dung ky vong): ${sayLooksAuto}`);

    tee(`[checkpoint-5b-audio] Log: ${txtPath}`);
    const ok =
      !!toolCallInfo &&
      functionOutputSent &&
      !sawError &&
      [...responses.values()].filter((r) => r.ended).length >= RESPONSES_ENDED_FOR_PASS &&
      gotRealData &&
      sayLooksAuto;
    tee(
      `[checkpoint-5b-audio] KET QUA: ${
        ok
          ? "PASS - vong doi tool-call THAT chay tron ven qua duong audio+VAD that, du lieu hoa don la du lieu " +
            "THAT, va say() di dung nhanh mode auto."
          : "CAN XEM LAI"
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
    tee("[checkpoint-5b-audio] TIMEOUT 35s - chua thay du dieu kien PASS, xem log de biet dung o buoc nao.");
    finish(1);
  }
}, 35000);

process.on("SIGINT", () => {
  console.log("\n[checkpoint-5b-audio] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});
