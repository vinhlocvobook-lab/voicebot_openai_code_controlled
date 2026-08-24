#!/usr/bin/env node
// scripts/checkpoint-giai-doan-6a.mjs
//
// Giai doan 6a (xem docs/roadmap.md). Checkpoint THAT dau-cuoi: noi TAT CA
// manh cua Giai doan 6a lai voi nhau qua 1 ket noi Realtime that + audio
// TTS that (scripts/gen-sample-6a.mjs) - danh-bo-flow.js, danh-bo-collect.js,
// danh-bo-confirm.js, resolve-danh-bo-ref.js, dispatch-tool-call.js
// (handleDanhBoFlowDone), tool-router.js/billing.js/tongdai-api.js that.
// Khung chung ke thua tu checkpoint-giai-doan-5b.mjs (connectRealtimeSession
// that + tee() log ra file + finish()/timeout an toan) - KHAC 5b o CACH
// DIEU KHIEN: 5b chi co 1 buoc (goi tool ngay), 6a co NHIEU BUOC TUAN TU
// (kich DANH_BO_MISSING -> doi arming/asking -> phat audio doc so -> doi
// confirming -> phat audio xac nhan -> doi done -> doi tra cuu lai xong) -
// nen viet dang 1 ham main() async/await ro rang, KHONG dang phan ung theo
// co (flag) rai rac nhu 5a/5b (5b don gian hon nen hop ly voi flag, 6a
// phuc tap hon nen ham tuan tu de doc/sua hon).
//
// [QUYET DINH THIET KE - kich DANH_BO_MISSING bang TEXT + tool_choice ep
// buoc, KHONG dung audio "6a_mo_dau_khong_danh_bo.wav" da tao san] Ly do:
// GET_BILL_TOOL (nguyen van tu system-prompt.js, xem duoi) co doan mo ta
// "Loi thoai de hoi so danh bo CHI dung khi... : 'Dạ, Quý Khách vui lòng
// cho em xin số danh bộ...'" - tuc schema nay tu no da HUONG DAN model
// TU HOI BANG LOI (khong goi tool) khi chua co danh bo, KHONG dam bao model
// se THAT SU goi get_bill (co the chi hoi lai bang giong noi, khong bao gio
// tao ra tin hieu tool-call-requested nao ca) - neu vay, toan bo co che
// danhBoFlow/DANH_BO_MISSING dang muon xac nhan se KHONG BAO GIO duoc kich
// hoat, checkpoint se "treo" cho mai khong ro nguyen nhan (loi thiet ke test
// hay loi code that). Bang chung THAT tu ban cu (fix_migrate_gpt_realtime_
// 21_20260730.md, dot "unlocked") cho thay model CO THE tu goi tool voi
// danh bo doan/thieu trong 1 so tinh huong - nhung KHONG chac chan luon xay
// ra, dac biet khi KHONG co chut chu so nao de "doan tu" (khac tinh huong
// dot do, luc do model da nghe 4/11 so). De checkpoint nay xac nhan DUNG
// pham vi Giai doan 6a (chuyen gi xay ra SAU KHI DANH_BO_MISSING, khong
// phai "model co chiu goi tool khong co danh bo hay khong" - cau hoi do
// thuoc ve system-prompt.js/tool schema, CHUA lam o Giai doan 6a), dung
// LAI ky thuat tu checkpoint-giai-doan-5b.mjs: bom 1 tin nhan text truc
// tiep (conversation.item.create) roi say({mode:"tool", toolChoice:
// "required"}) EP model PHAI goi 1 tool nao do - loai bo hoan toan su khong
// chac chan ve "model co chiu goi khong", tap trung 100% vao dieu THAT SU
// can xac nhan: dispatch-tool-call.js/danh-bo-flow.js co xu ly DUNG khi
//
// [sua 24/08/2026, PHAT HIEN THAT lan chay dau tien] Ban dau dung toolChoice:
// "get_bill" (ten ham cu the) - THAT BAI voi loi that tu chinh API: `Invalid
// value: 'get_bill'. Supported values are: 'auto', 'none', and 'required'.`
// (param "response.tool_choice"). Xac nhan: turn-controller.js#say({mode:
// "tool"}) truoc gio CHUA TUNG duoc goi API that kiem chung (thiet ke dua
// tren gia dinh tu ban cu, test cu chi dung WS gia nen khong bat duoc loi
// nay) - GPT-realtime-2.x KHONG cho ep goi 1 TEN HAM CU THE qua tool_choice,
// chi nhan 3 gia tri "auto"/"none"/"required". Sua thanh "required" - vi
// checkpoint nay CHI khai bao 1 tool duy nhat (GET_BILL_TOOL) nen "required"
// van ep model goi DUNG get_bill (khong con mo ho ten ham nao khac de chon).
// DANH_BO_MISSING that su xay ra hay khong. File "6a_mo_dau_khong_danh_bo.wav"
// van con trong samples/ - de danh cho 1 thi nghiem RIENG sau nay (khi co
// system-prompt.js that) kiem tra model co TU NHIEN goi get_bill tu giong
// noi khong co danh bo hay khong, KHONG phai viec cua checkpoint nay.
//
// 2 file audio THAT SU dung o day (samples/, tao boi gen-sample-6a.mjs):
//   - 6a_doc_so_22023251775.wav - phat SAU KHI danhBoFlow vao "asking"
//     (session-updated cua VAD "digits" da ve) - dung DUNG "cua so ho hong"
//     ma arming-state duoc thiet ke de chan (xem danh-bo-flow.js dau file).
//   - 6a_xac_nhan_dung.wav - phat SAU KHI danhBoFlow vao "confirming".
//
// CACH CHAY (tren may that, can OPENAI_API_KEY + TONGDAI_API_* trong .env,
// da chay scripts/gen-sample-6a.mjs truoc do de co 2 file audio tren):
//   node scripts/checkpoint-giai-doan-6a.mjs

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
  console.error("[checkpoint-6a] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}
if (!/^true$/i.test(process.env.TONGDAI_API_INSECURE_TLS || "")) {
  console.warn(
    "[checkpoint-6a] CANH BAO: TONGDAI_API_INSECURE_TLS khong phai 'true' - neu tunnel test dung cert tu ky " +
      "se loi DEPTH_ZERO_SELF_SIGNED_CERT ngay lan goi API dau tien. Bo qua canh bao nay neu tunnel dung cert hop le.",
  );
}

// Ma danh bo THAT, da xac nhan co du lieu billing trong moi truong test
// hien tai (giong checkpoint-giai-doan-5b.mjs) - phai KHOP voi so DA DOC
// trong file audio doc so dang dung (mac dinh
// samples/6a_doc_so_22023251775.wav, gen-sample-6a.mjs).
const MA_DANH_BO = "22023251775";

// [them 24/08/2026 #5, theo audit docs/fix/giai_doan_6a_audit_kich_ban_da_
// test_20260824.md - muc "Chua test o muc nay"] AUDIO_DOC_SO gio nhan
// duoc THEM 1 duong dan audio TUY CHON qua tham so dong lenh (argv[2]) -
// de tai su dung DUNG checkpoint nay (khong viet ban sao rieng) cho cac
// file doc so KHAC file "sach" mac dinh, vd samples/6_ngap_ngung.wav (doc
// ngap ngung, DA xac nhan qua probe-danh-bo-vad.mjs la CUNG ma danh bo
// 22023251775, chi khac cach doc - xem file audit). KHONG doi MA_DANH_BO/
// tieu chi PASS o day - CHI hop le khi file audio truyen vao van doc DUNG
// so 22023251775 (vd file "tap am" doc so KHAC se can 1 kich ban rieng,
// chua lam o day - xem ghi chu file audit).
//   node scripts/checkpoint-giai-doan-6a.mjs                       # mac dinh, file sach
//   node scripts/checkpoint-giai-doan-6a.mjs samples/6_ngap_ngung.wav  # doc ngap ngung
const AUDIO_DOC_SO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "samples", "6a_doc_so_22023251775.wav");
const AUDIO_XAC_NHAN_DUNG = path.join(__dirname, "..", "samples", "6a_xac_nhan_dung.wav");
for (const f of [AUDIO_DOC_SO, AUDIO_XAC_NHAN_DUNG]) {
  if (!fs.existsSync(f)) {
    console.error(`[checkpoint-6a] Thieu file audio ${f} - chay truoc: node scripts/gen-sample-6a.mjs (neu la file mac dinh)`);
    process.exit(1);
  }
}
console.log(`[checkpoint-6a] Dung file audio doc so: ${AUDIO_DOC_SO}`);

// Nguyen van tu voice_bot/src/system-prompt.js#TOOLS (get_bill), giong het
// checkpoint-giai-doan-5b.mjs - dung CUNG schema that de khong lech.
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

// KHONG doc danh bo - dung y (xem "QUYET DINH THIET KE" dau file), model se
// bi EP goi get_bill (tool_choice) du khong co danh bo trong cau nay.
const USER_TEXT_KHONG_DANH_BO = "Xin chào, cho tôi hỏi hóa đơn tiền nước tháng 8 năm 2026 với.";

// ── Log ra file, giong style checkpoint-giai-doan-5b.mjs ───────────────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint6a-${runTimestamp}.txt`);
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
const responses = new Map(); // responseId -> { started, ended, status }
let sawError = false;
let finished = false;
let sentPrecondition = false;
const getBillCalls = []; // moi phan tu la output THAT tra ve (spy quanh router.get_bill)
const sayCalls = []; // spy quanh turnController.say

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
    tee("[checkpoint-6a] tin hieu chuan hoa:", JSON.stringify(signal));

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
      tee("[checkpoint-6a] NHAN DUOC EVENT ERROR - xem chi tiet o dong <- error phia tren.");
    }

    // 2 module CHIA SE cung 1 luong tin hieu, DOC LAP nhau (dung kien truc
    // da thiet ke - xem ghi chu dau danh-bo-flow.js: "Ben goi tu wiring
    // handleSignal vao dung tin hieu"). Thu tu goi khong quan trong (khong
    // module nao doc state cua module kia trong CUNG 1 lan goi).
    dispatcher.handleSignal(signal).catch((err) => {
      tee("[checkpoint-6a] Dispatcher loi bat ngo (KHONG duoc xay ra):", err.message);
      finish(1);
    });
    danhBoFlow.handleSignal(signal, Date.now());

    // Kich DANH_BO_MISSING NGAY khi ket noi san sang (session-updated DAU
    // TIEN, truoc khi co bat ky setVadMode nao khac tu danhBoFlow) - dung
    // signal.kind === "session-updated" (turn-signal.js sua 24/08/2026,
    // KHONG con la "ignored"+rawType nhu checkpoint-giai-doan-5b.mjs cu -
    // 5b viet TRUOC ban sua do nen dong kiem tra cua no gio da LOI THOI,
    // xem chu y trong tin nhan bao cao cho chu du an).
    if (signal.kind === "session-updated" && !sentPrecondition) {
      sentPrecondition = true;
      tee("[checkpoint-6a] Ket noi san sang - bom tin nhan text KHONG danh bo + ep tool_choice:'get_bill'.");
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: USER_TEXT_KHONG_DANH_BO }] },
      });
      // "required" (KHONG PHAI ten ham cu the "get_bill" - xem "sua
      // 24/08/2026" dau file, loi that tu API) - van ep DUNG get_bill vi day
      // la tool DUY NHAT duoc khai bao (tools: [GET_BILL_TOOL]).
      turnController.say({ mode: "tool", toolChoice: "required" });
    }
  },
});

// callState RONG co y (KHAC checkpoint-giai-doan-5b.mjs) - day CHINH LA
// dieu can xac nhan: get_bill LAN DAU phai tra ve DANH_BO_MISSING that qua
// duong billing.js -> resolve-danh-bo-ref.js that (khong phai gia lap).
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

// Spy quanh get_bill - luu lai MOI lan goi (ca lan dau DANH_BO_MISSING lan
// lan goi LAI sau khi danhBoFlow xac nhan xong) de doi chieu o finish().
const handlers = {
  get_bill: async (args) => {
    const out = await router.get_bill(args);
    getBillCalls.push({ args, out });
    return out;
  },
};

// Circular reference co y: danhBoFlow.onDone can goi dispatcher.
// handleDanhBoFlowDone(), nhung dispatcher can danhBoFlow de tao (tham so
// factory) - khai bao `dispatcher` truoc (chua gan), closure cua onDone
// chi THUC SU doc gia tri `dispatcher` luc onDone duoc GOI (sau nay, luc
// do dispatcher chac chan da duoc gan) - mau hinh JS quen thuoc, khong loi.
let dispatcher;

const danhBoFlow = createDanhBoFlow({
  setVadMode,
  say: turnController.say,
  maxAttempts: 3,
  watchdogMs: 90000,
  log,
  onDone: async (result) => {
    tee("[checkpoint-6a] danhBoFlow.onDone:", JSON.stringify(result));
    // [sua 24/08/2026 #3, xem ghi chu "PHAT HIEN THAT" day du trong
    // dispatch-tool-call.js dau file] Ban dau setVadMode("normal") goi
    // TRUOC handleDanhBoFlowDone() (khong await) - gay bug THAT: chay that
    // lan 2 cho thay get_bill bi goi 3 LAN (1 lan hallucinate them do VAD
    // moi bat kich hoat response cua model trong luc handleDanhBoFlowDone()
    // con dang cho ket qua that tu tongdai-api.js). Sua: await XONG
    // handleDanhBoFlowDone() (dam bao say() verbatim cuoi cung da gui) roi
    // MOI setVadMode("normal") - dong dung thu tu vi du da cap nhat trong
    // dispatch-tool-call.js.
    if (result.ok) callState.danhBo = result.danhBo;
    await dispatcher.handleDanhBoFlowDone(result);
    setVadMode("normal");
  },
});

dispatcher = createToolDispatcher({ send, turnController, log, handlers, danhBoFlow, now: () => Date.now() });

// Spy quanh turnController.say - ghi lai MOI lan goi (danhBoFlow.askPrompt/
// confirmPrompt/giveUp CUNG di qua day, khong chi dispatch-tool-call.js).
const originalSay = turnController.say.bind(turnController);
turnController.say = (...args) => {
  sayCalls.push(args[0] ?? null);
  tee("[checkpoint-6a] turnController.say() duoc goi voi tham so:", JSON.stringify(args[0] ?? null));
  return originalSay(...args);
};

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[checkpoint-6a] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});
ws.on("error", (err) => {
  console.error("[checkpoint-6a] WS error:", err.message);
});
ws.on("close", (code, reason) => {
  tee(`[checkpoint-6a] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

// ── Tien ich stream audio (copy logic tu probe-danh-bo-vad.mjs, KHONG tu
// dong ket noi khi xong - chi resolve Promise de main() tiep tuc buoc sau) ──
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

// [QUAN TRONG - xem ghi chu gen-sample-6a.mjs] In ra DUNG sample rate that
// doc duoc tu file - neu KHAC 24000Hz can convert bang ffmpeg roi doi lai
// duong dan AUDIO_DOC_SO/AUDIO_XAC_NHAN_DUNG o tren, KHONG doan truoc.
async function streamAudioFile(filePath, label, trailingSilenceMs) {
  tee(`[checkpoint-6a] (${label}) Doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  tee(
    `[checkpoint-6a] (${label}) WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ` +
      `${(data.length / fmt.sampleRate / 2).toFixed(2)}s`,
  );
  if (fmt.sampleRate !== 24000) {
    tee(
      `[checkpoint-6a] (${label}) CANH BAO: sample rate KHONG phai 24000Hz - Realtime API co the hieu SAI toc do/cao do ` +
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
  tee(`[checkpoint-6a] (${label}) Da phat het file + ${trailingSilenceMs}ms im lang.`);
}

// silence_duration_ms cua "digits" mode la 2000ms (buildTurnDetectionConfig)
// - doi du DAI HON de chac chan server kip commit manh cuoi cung.
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

// Watchdog THAT - danh-bo-flow.js KHONG tu goi Date.now()/setTimeout (thuan,
// test duoc), ben goi (o day) tu dat interval that goi checkWatchdog(nowMs)
// dinh ky, dung nhu comment "Ben goi (lop tich hop that...)" trong module do.
const watchdogInterval = setInterval(() => danhBoFlow.checkWatchdog(Date.now()), 1000);

// ── main() - dieu khien TUAN TU ca kich ban, doi tung phase that ─────────
async function main() {
  await waitForPhase(["arming", "asking", "confirming", "done", "failed"], 20000, "cho DANH_BO_MISSING kich danhBoFlow.start()");
  tee("[checkpoint-6a] danhBoFlow da bat dau (roi khoi 'idle') - cho vao 'asking' (session-updated cua VAD 'digits')...");

  await waitForPhase(["asking", "confirming", "done", "failed"], 15000, "cho phase 'asking'");
  if (danhBoFlow.getPhase() !== "asking") {
    throw new Error(`Ky vong dang o 'asking' truoc khi phat audio doc so, nhung dang o '${danhBoFlow.getPhase()}'`);
  }
  tee("[checkpoint-6a] Dang o 'asking' - phat audio doc so " + MA_DANH_BO + "...");
  await streamAudioFile(AUDIO_DOC_SO, "doc-so", TRAILING_SILENCE_MS);

  await waitForPhase(["confirming", "done", "failed"], 15000, "cho phase 'confirming' sau khi doc so");
  if (danhBoFlow.getPhase() !== "confirming") {
    throw new Error(`Ky vong dang o 'confirming' sau khi doc du 11 so, nhung dang o '${danhBoFlow.getPhase()}'`);
  }
  const candidate = danhBoFlow.getCandidate();
  tee(`[checkpoint-6a] Dang o 'confirming', candidate thu thap duoc: ${candidate}`);
  if (candidate !== MA_DANH_BO) {
    tee(`[checkpoint-6a] CANH BAO: candidate (${candidate}) KHONG khop MA_DANH_BO ky vong (${MA_DANH_BO}) - transcript that co the da doc/nhan sai 1 vai chu so.`);
  }
  tee("[checkpoint-6a] Phat audio xac nhan 'dung roi'...");
  await streamAudioFile(AUDIO_XAC_NHAN_DUNG, "xac-nhan", TRAILING_SILENCE_MS);

  await waitForPhase(["done", "failed"], 15000, "cho danhBoFlow ket thuc (done/failed)");
  tee(`[checkpoint-6a] danhBoFlow ket thuc voi phase: ${danhBoFlow.getPhase()}`);

  // Doi them cho lan goi LAI get_bill (handleDanhBoFlowDone, co do tre mang
  // that toi tongdai-api.js - da do duoc ~2483ms o Giai doan 5b) + say()
  // verbatim doc ket qua kip xay ra truoc khi tong ket.
  await sleep(6000);

  finish(0);
}

main().catch((err) => {
  tee("[checkpoint-6a] main() loi:", err.message);
  finish(1);
});

function finish(exitCode) {
  if (finished) return;
  finished = true;
  clearInterval(watchdogInterval);
  setTimeout(() => {
    tee("\n[checkpoint-6a] ===== Tom tat =====");
    tee(`[checkpoint-6a] danhBoFlow.getPhase() cuoi cung: ${danhBoFlow.getPhase()}`);
    tee(`[checkpoint-6a] callState.danhBo cuoi cung: ${callState.danhBo ?? "(chua co)"}`);
    tee(`[checkpoint-6a] So lan goi get_bill (spy): ${getBillCalls.length}`);
    getBillCalls.forEach((c, i) => {
      tee(`[checkpoint-6a]   lan ${i + 1}: args=${JSON.stringify(c.args)} -> out=${JSON.stringify(c.out)}`);
    });
    tee(`[checkpoint-6a] So lan turnController.say() (spy): ${sayCalls.length}`);
    sayCalls.forEach((s, i) => tee(`[checkpoint-6a]   say() lan ${i + 1}: ${JSON.stringify(s)}`));
    tee(`[checkpoint-6a] co event error: ${sawError}`);

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

    tee(`[checkpoint-6a] (a) Lan dau get_bill tra ve DANH_BO_MISSING that: ${layDauMissing}`);
    tee(`[checkpoint-6a] (b) danhBoFlow ket thuc o 'done' (khong phai 'failed'): ${thuThapDungSo}`);
    tee(`[checkpoint-6a] (c) callState.danhBo dung bang ${MA_DANH_BO}: ${callStateDungSo}`);
    tee(`[checkpoint-6a] (d) Lan goi LAI get_bill (sau xac nhan) THANH CONG voi du lieu that: ${layLaiThanhCong}`);

    tee(`[checkpoint-6a] Log: ${txtPath}`);
    const ok = layDauMissing && thuThapDungSo && callStateDungSo && layLaiThanhCong && !sawError;
    tee(
      `[checkpoint-6a] KET QUA: ${
        ok
          ? "PASS - toan bo Giai doan 6a (danh-bo-flow.js/danh-bo-collect.js/danh-bo-confirm.js/" +
            "resolve-danh-bo-ref.js/dispatch-tool-call.js#handleDanhBoFlowDone) chay tron ven qua Realtime " +
            "API that + audio TTS that, thu thap DUNG so, tra cuu lai DUNG du lieu that."
          : "CAN XEM LAI - xem 4 dieu kien (a)-(d) o tren de biet dung o buoc nao."
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
    tee("[checkpoint-6a] TIMEOUT 90s - chua thay du dieu kien PASS, xem log de biet dung o buoc nao.");
    finish(1);
  }
}, 90000);

process.on("SIGINT", () => {
  console.log("\n[checkpoint-6a] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});
