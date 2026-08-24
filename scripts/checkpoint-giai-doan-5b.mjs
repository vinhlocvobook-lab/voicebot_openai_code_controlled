#!/usr/bin/env node
// scripts/checkpoint-giai-doan-5b.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Ban TEXT - khung y HET checkpoint-
// giai-doan-5a.mjs (connectRealtimeSession + createToolDispatcher noi that
// voi nhau, tee() log ra file, responses Map theo responseId,
// RESPONSES_ENDED_FOR_PASS, maybeFinish()/finish(), timeout an toan) -
// KHONG doi lai phan da xac nhan dung o 5a. Khac 5a o DUNG 4 cho:
//
//   1. handler get_bill KHONG con la gia lap - dung THANG createToolRouter
//      (tool-router.js, Giai doan 5b) voi 5 ham that cua tongdai-api.js
//      (Giai doan 5) tiem vao - nghia la lan nay di THAT qua duong
//      tool-router.js -> billing.js -> tongdai-api.js -> API that cua
//      Tong dai CNTA, khong con la handler viet tay o ngay trong script.
//   2. GET_BILL_TOOL lay NGUYEN VAN tu voice_bot/src/system-prompt.js
//      (ban production that, KHONG rut gon nhu 5a) - tranh lech schema so
//      voi ban da kiem chung, vi lan nay muon xac nhan CA schema that.
//   3. Ma danh bo hardcode 22023251775 (KHAC 22082351775 cua ban 5a) - da
//      xac nhan CO du lieu that (billing/outages/agent) trong moi truong
//      test hien tai qua terminal cua chu du an, xem docs/roadmap.md#5b.
//   4. Tieu chi PASS THEM 2 lop moi ma 5a khong co (5a chi xac nhan vong
//      doi giao thuc chay tron, khong xac nhan NOI DUNG dung):
//        a. "spy" quanh router.get_bill - luu lai OUTPUT that cuoi cung,
//           doi chieu la du lieu THAT (co san_luong/tong_tien/... tu API,
//           KHONG phai con so gia 185000/14 nhu 5a) chu khong chi "co goi
//           tool" chung chung.
//        b. "spy" quanh turnController.say - luu lai moi lan goi + tham so
//           - get_bill KHONG co action/doc_cho_khach nen ky vong say()
//           duoc goi it nhat 1 lan VOI THAM SO RONG (mode "auto" mac
//           dinh, xem dispatch-tool-call.js#sayForOutput) - xac nhan fix
//           23/08/2026 (doc action/doc_cho_khach) KHONG lam sai lech
//           duong "khong co ca 2 field" nay.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY + cau hinh TONGDAI_API_*
// trong .env - dac biet TONGDAI_API_INSECURE_TLS=true neu tunnel test dung
// cert tu ky, xem docs/roadmap.md#5b de biet cach xac nhan):
//   node scripts/checkpoint-giai-doan-5b.mjs

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
  console.error("[checkpoint-5b] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}
if (!/^true$/i.test(process.env.TONGDAI_API_INSECURE_TLS || "")) {
  console.warn(
    "[checkpoint-5b] CANH BAO: TONGDAI_API_INSECURE_TLS khong phai 'true' - neu tunnel test dung cert tu ky " +
      "se loi DEPTH_ZERO_SELF_SIGNED_CERT ngay lan goi API dau tien. Bo qua canh bao nay neu tunnel dung cert hop le.",
  );
}

// [3] Ma danh bo THAT, da xac nhan co du lieu billing trong moi truong test
// hien tai (xem docs/roadmap.md#5b) - KHAC voi 22082351775 cua checkpoint-
// giai-doan-5a.mjs (danh bo do CUSTOMER_NOT_FOUND trong moi truong nay).
const MA_DANH_BO = "22023251775";

// [2] Nguyen van tu voice_bot/src/system-prompt.js#TOOLS (get_bill) - KHONG
// rut gon nhu ban 5a, de xac nhan ca schema that hoat dong dung voi model.
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

const USER_TEXT =
  `Xin chào, cho tôi hỏi hóa đơn tiền nước tháng này với. Mã danh bộ của tôi là ${MA_DANH_BO}.`;

// ── Log ra file, giong style checkpoint-giai-doan-5a.mjs ───────────────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint5b-${runTimestamp}.txt`);
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

// Dung CHUNG 1 ham log() cho ca dispatcher/turn-controller LAN cho
// tongdai-api.js (setApiLogger) - moi request/response That toi API CNTA
// (dong "-> GET ..."/"<- 200 (...)") duoc tee vao CUNG 1 file log, khong
// can doc 2 noi rieng biet.
setApiLogger(log);

// ── Trang thai quan sat ─────────────────────────────────────────────────
const responses = new Map(); // responseId -> { started, ended, status }
let toolCallInfo = null;
let functionOutputSent = false;
let sawError = false;
let sentText = false;
let finished = false;

// [sua 23/08/2026, sau 2 lan chay that] Copy ban dau tu checkpoint-giai-
// doan-5a.mjs la 3, nhung du lieu that (logs/checkpoint5b-1787507906845.txt)
// cho thay 1 vong tool-call BINH THUONG chi co DUNG 2 response: response 1
// (hoi + goi tool - ket thuc NGAY sau khi model phat xong loi goi ham,
// KHONG doi tool chay xong) va response 2 (do say() tao ra de doc ket
// qua) - khong co response thu 3 nao ca. Bar "3" la sai (thuoc ve tieu chi
// cua checkpoint nay, khong phai loi code) - sua ve 2 cho khop thuc te.
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
    tee("[checkpoint-5b] tin hieu chuan hoa:", JSON.stringify(signal));

    if (signal.kind === "ignored" && signal.rawType === "session.updated" && !sentText) {
      sentText = true;
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: USER_TEXT }] },
      });
      turnController.say();
      tee("[checkpoint-5b] Da gui cau hoi text + say() - cho model xin goi tool.");
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
        "[checkpoint-5b] CHU Y - diem can quan sat: dispatcher se goi tool-router.js -> billing.js -> " +
          "tongdai-api.js THAT (khong con handler gia lap) - xem dong 'tongdai-api: -> GET .../<- 200' phia " +
          "duoi de thay yeu cau/tra loi that toi API CNTA, va dong 'dispatch-tool-call: tool \"get_bill\" ... " +
          "tra ve:' de thay du lieu that (khong phai 185000/14 nhu checkpoint 5a).",
      );
    }

    dispatcher
      .handleSignal(signal)
      .then(() => {
        if (signal.kind === "tool-call-requested") {
          functionOutputSent = true;
          tee("[checkpoint-5b] Dispatcher da gui function_call_output (say() con hoan lai).");
          maybeFinish();
        }
      })
      .catch((err) => {
        tee("[checkpoint-5b] Dispatcher loi bat ngo (KHONG duoc xay ra, dispatcher phai tu bat loi):", err.message);
        finish(1);
      });

    if (signal.kind === "error") {
      sawError = true;
      tee("[checkpoint-5b] NHAN DUOC EVENT ERROR - xem chi tiet o dong <- error phia tren.");
    }
  },
});

// [1] callState 1 lan cho CA "cuoc goi" nay - dung y he thong that (server.js
// sau nay se tao callState MOI cho MOI cuoc goi that).
//
// [sua 24/08/2026, Giai doan 6a] resolveDanhBoRef (src/domain/resolve-
// danh-bo-ref.js) doi tu stub "tin thang rawArg model" sang ban THAT "chi
// tin callState.danhBo, bo qua hoan toan rawArg" - neu khong gan o day,
// checkpoint nay se LUON nhan DANH_BO_MISSING (dung nhu thiet ke, xem ghi
// chu trong resolve-danh-bo-ref.js), khong con test duoc phan billing.js/
// tool-router.js ma checkpoint 5b nay dung de xac nhan. Gan truoc o day de
// MO PHONG dung tinh huong "danh bo DA duoc danh-bo-flow.js (Giai doan 6a)
// xac nhan tu truoc trong cuoc goi" - checkpoint nay khong nham xac nhan
// luong thu thap qua VAD (viec do la scripts/checkpoint-giai-doan-6a*.mjs,
// chua viet), chi tiep tuc xac nhan billing.js/tool-router.js nhu cu.
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

// [4a] Spy quanh get_bill - luu lai OUTPUT that cuoi cung de doi chieu o
// finish(), KHONG doi hanh vi (van goi router.get_bill nguyen ven).
let lastGetBillOutput = null;
const handlers = {
  get_bill: async (args) => {
    const out = await router.get_bill(args);
    lastGetBillOutput = out;
    return out;
  },
};

// [4b] Spy quanh turnController.say - ghi lai MOI lan goi + tham so, de xac
// nhan get_bill (khong co action/doc_cho_khach) di dung nhanh say() mode
// "auto" mac dinh (tham so rong) - khong bi anh huong boi fix 23/08/2026.
const sayCalls = [];
const originalSay = turnController.say.bind(turnController);
turnController.say = (...args) => {
  sayCalls.push(args[0] ?? null);
  tee(`[checkpoint-5b] turnController.say() duoc goi voi tham so:`, JSON.stringify(args[0] ?? null));
  return originalSay(...args);
};

const dispatcher = createToolDispatcher({ send, turnController, log, handlers });

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[checkpoint-5b] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

ws.on("error", (err) => {
  console.error("[checkpoint-5b] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  tee(`[checkpoint-5b] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

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
    tee("\n[checkpoint-5b] ===== Tom tat =====");
    tee(`[checkpoint-5b] tool-call-requested da thay: ${!!toolCallInfo}` + (toolCallInfo ? ` (name=${toolCallInfo.name}, callId=${toolCallInfo.callId})` : ""));
    tee(`[checkpoint-5b] function_call_output da gui: ${functionOutputSent}`);
    tee(`[checkpoint-5b] So response da ket thuc: ${[...responses.values()].filter((r) => r.ended).length} / ${responses.size} da bat dau`);
    for (const [id, r] of responses.entries()) {
      tee(`[checkpoint-5b]   responseId=${id} started=${r.started} ended=${r.ended} status=${r.status}`);
    }
    tee(`[checkpoint-5b] co event error: ${sawError}`);
    tee(`[checkpoint-5b] isResponseActive() cuoi cung: ${turnController.isResponseActive()}`);

    // [4a] Doi chieu du lieu THAT - phai co success:true VA it nhat 1 dong
    // du lieu (khac han PASS chung chung cua 5a).
    const gotRealData =
      !!lastGetBillOutput && lastGetBillOutput.success === true &&
      Array.isArray(lastGetBillOutput.data) && lastGetBillOutput.data.length > 0;
    tee(`[checkpoint-5b] get_bill output that (spy):`, JSON.stringify(lastGetBillOutput));
    tee(`[checkpoint-5b] co du lieu hoa don that (success:true + data khong rong): ${gotRealData}`);

    // [4b] Doi chieu say() - it nhat 1 lan goi, LAN CUOI voi tham so rong
    // (mode auto - khong bi doc_cho_khach/no_reply chi phoi vi get_bill
    // khong tra 2 field do).
    const sayLooksAuto = sayCalls.length > 0 && !sayCalls[sayCalls.length - 1];
    tee(`[checkpoint-5b] say() duoc goi ${sayCalls.length} lan, danh sach tham so:`, JSON.stringify(sayCalls));
    tee(`[checkpoint-5b] lan say() cuoi la mode "auto" (tham so rong, dung ky vong): ${sayLooksAuto}`);

    tee(`[checkpoint-5b] Log: ${txtPath}`);
    const ok =
      !!toolCallInfo &&
      functionOutputSent &&
      !sawError &&
      [...responses.values()].filter((r) => r.ended).length >= RESPONSES_ENDED_FOR_PASS &&
      gotRealData &&
      sayLooksAuto;
    tee(
      `[checkpoint-5b] KET QUA: ${
        ok
          ? "PASS - tool-router.js/billing.js/tongdai-api.js THAT chay tron ven qua duong Realtime that, " +
            "du lieu hoa don la du lieu THAT, va say() di dung nhanh mode auto."
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
    tee("[checkpoint-5b] TIMEOUT 30s - chua thay du dieu kien PASS, xem log de biet dung o buoc nao.");
    finish(1);
  }
}, 30000);

process.on("SIGINT", () => {
  console.log("\n[checkpoint-5b] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});
