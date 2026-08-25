#!/usr/bin/env node
// scripts/checkpoint-giai-doan-6b.mjs
//
// Giai doan 6b, "Phuong an B" (xem docs/roadmap.md). Checkpoint THAT dau-cuoi
// KE TIEP sau scripts/probe-confirm-danh-bo-tool.mjs - probe do CHI kiem tra
// matcher/resolver THUAN (createReadbackMatcher/resolveConfirmDanhBo goi tay
// tu file probe, KHONG di qua tool-router.js/dispatch-tool-call.js that).
// Checkpoint nay noi DAY DU duong day SAN XUAT that: session-ws.js
// (connectRealtimeSession that) -> dispatch-tool-call.js (createToolDispatcher
// that) -> tool-router.js (createToolRouter that, dung DUNG property
// confirm_danh_bo/handleSignal moi noi 25/08/2026) -> danh-bo-confirm-tool-
// flow.js (lop tich hop that). Khung chung ke thua checkpoint-giai-doan-6a.mjs
// (log ra file bang tee(), spy quanh handler, finish()/timeout an toan,
// main() async/await tuan tu) nhung KHAC O DIEM COT LOI: 6a dung danh-bo-
// flow.js de CODE chu dong dieu khien luot (VAD "digits", say() verbatim ep
// buoc) - 6b (Phuong an B) de MODEL tu quyet dinh khi nao doc lai/hoi xac
// nhan/goi tool, code o day CHI quan sat qua router.handleSignal() + doi
// chieu qua router.confirm_danh_bo(), KHONG dieu khien VAD/loi noi cua model
// (giong triet ly ghi trong danh-bo-confirm-tool-flow.js dau file nguon).
//
// [QUYET DINH THIET KE - KHONG dung "digits" mode san co cua session-ws.js
// cho luot khach doc 11 so] "digits" mode (buildTurnDetectionConfig) khoa
// create_response:false CUNG THEO PHAN CUNG - sai voi Phuong an B (model can
// TU tra loi/doc lai ngay sau khi khach doc xong, khong doi CODE goi say()).
// Dung LAI CHINH XAC cau hinh server_vad da duoc probe-confirm-danh-bo-
// tool.mjs CHUNG MINH THAT hoat dong dung (threshold 0.6, silence_duration_ms
// 700, create_response:true) - KHONG doan lai/dung "normal" (semantic_vad)
// mac dinh cua connectRealtimeSession() vi giong nhu ly do "digits" mode ra
// doi o Giai doan 6a, semantic_vad/eagerness low CHUA duoc kiem chung voi
// kich ban khach doc lien 11 chu so, se la 1 BIEN CHUA KIEM CHUNG THEM lam
// nhieu ket qua checkpoint (dang nham xac nhan tool-router.js/dispatch-tool-
// call.js noi day dung, khong phai xac nhan lai VAD). Vi connectRealtimeSession()
// CHUA ho tro truyen `instructions` (chi tools/toolChoice - xem session-ws.js
// dong 139-158), VA CHUA ho tro turn_detection tuy chinh ngoai "normal"/
// "digits" - checkpoint nay tu gui 1 session.update THEO SAU (dung `send()`
// nhu 6a da lam voi conversation.item.create, KHONG sua session-ws.js) de
// lop them `instructions` + turn_detection dung cau hinh da probe, SAU KHI
// da nhan session-updated DAU TIEN (cua chinh connectRealtimeSession()).
//
// [QUYET DINH THIET KE #2 - KHONG dung tongdai-api.js that] Kich ban nay CHI
// test confirm_danh_bo (xac nhan mot minh, KHONG tra cuu hoa don/su co gi ca -
// dung tinh than probe-confirm-danh-bo-tool.mjs "KHONG can TONGDAI_API_* vi
// khong goi tool tra cuu nao"). createToolRouter() van doi du 5 tham so
// getTrangThaiTT/getSoSanhTangGiam/getThongBaoCupNuoc/baoSuCo/getAvailableAgents
// (billing/outages/tickets/call-control deu duoc dung, du checkpoint nay
// KHONG goi toi) - truyen ham gia LUON THROW neu lo bi goi (an toan hon
// truyen undefined im lang neu co bug wiring khien 1 tool khac bi goi nham).
//
// CACH CHAY (tren may that, chi can OPENAI_API_KEY trong .env, KHONG can
// TONGDAI_API_* - xem quyet dinh #2 tren; da co san samples/
// 6a_doc_so_22023251775.wav + samples/6a_xac_nhan_dung.wav tu Giai doan 6a,
// khong can tao moi):
//   node scripts/checkpoint-giai-doan-6b.mjs
//
// KET QUA: logs/checkpoint6b-<timestamp>.txt (toan bo log) + tom tat PASS/
// CAN XEM LAI in cuoi console, doi chieu voi callState.danhBo/router.
// confirm_danh_bo THAT (khong phai fixture gia lap nhu test/*.test.mjs).

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectRealtimeSession } from "../src/session/session-ws.js";
import { createToolDispatcher } from "../src/call-flow/dispatch-tool-call.js";
import { createToolRouter } from "../src/domain/tool-router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuộc gọi tổng đài chăm sóc khách hàng công ty cấp nước tại TP.HCM, " +
  "toàn bộ bằng tiếng Việt. Có thể chứa mã danh bộ 11 chữ số, số tiền.";

if (!API_KEY) {
  console.error("[checkpoint-6b] Thieu OPENAI_API_KEY trong .env - copy tu .env.example roi dien key that.");
  process.exit(1);
}

// Ma danh bo THAT, khop voi AUDIO_DOC_SO mac dinh - dung LAI 2 file audio da
// co san tu Giai doan 6a (khong ghi am moi), giong probe-confirm-danh-bo-
// tool.mjs.
const MA_DANH_BO_THAT = "22023251775";
const AUDIO_DOC_SO = path.join(__dirname, "..", "samples", "6a_doc_so_22023251775.wav");
const AUDIO_XAC_NHAN_DUNG = path.join(__dirname, "..", "samples", "6a_xac_nhan_dung.wav");
for (const f of [AUDIO_DOC_SO, AUDIO_XAC_NHAN_DUNG]) {
  if (!fs.existsSync(f)) {
    console.error(`[checkpoint-6b] Thieu file audio ${f} - chay truoc: node scripts/gen-sample-6a.mjs`);
    process.exit(1);
  }
}

// ─── Tool schema + system-prompt - COPY NGUYEN VAN tu scripts/probe-confirm-
// danh-bo-tool.mjs (DA duoc probe THAT xac nhan qua 2 lan chay, xem chu
// thich/ket qua that trong file do) - CO Y trung lap thay vi import chung
// (dung quy uoc "moi probe/checkpoint tu chua ban rieng, khong phu thuoc
// file chua viet" da ap dung xuyen suot du an). CHUA dang ky vao 1 system-
// prompt.js that cua ca bot (file do chua ton tai, hoan theo Giai doan 5). ──
const CONFIRM_DANH_BO_TOOL = {
  type: "function",
  name: "confirm_danh_bo",
  description:
    "Goi tool nay CHI NGAY SAU KHI khach da xac nhan bang loi (vi du noi " +
    "'dung', 'dung roi', 'phai') cho DUNG ma danh bo em vua doc lai tung " +
    "chu so xin xac nhan. Khong goi tool nay de tra cuu du lieu - tool tra " +
    "cuu hoa don la tool khac, rieng biet. Khong tu goi tool nay khi khach " +
    "chua xac nhan, khi khach noi mot ma danh bo khac hoac muon sua lai, " +
    "hoac chi vi muon kiem tra/chac an them.",
  parameters: {
    type: "object",
    properties: {
      value: {
        type: "string",
        description:
          "Dung 11 chu so cua ma danh bo, dung y het chuoi em vua doc lai " +
          "cho khach nghe (chi gom chu so, khong dau cach/gach ngang). " +
          "Vi du: '22023251775'.",
      },
    },
    required: ["value"],
  },
};

const ENTITY_CAPTURE_INSTRUCTIONS = `# Vai tro va giong dieu
Ban la "em" - tong dai vien ao cua Cap nuoc Trung An, dang xac nhan lai ma danh bo khach vua doc qua dien thoai. Goi khach hang la "Quy Khach", xung "em", giong lich su tu nhien nhu tong dai CSKH that.

# Entity Capture - Ma danh bo (11 chu so)
Khach vua doc mot chuoi so cho ma danh bo. Lam theo dung quy trinh sau:

1. Chuan hoa nhung gi nghe RO thanh 1 chuoi 11 chu so lien tuc. Khong doan phan nghe khong ro.
2. TU MINH doc lai (khong yeu cau khach doc lai) TUNG CHU SO mot cho khach nghe, co ngan cach ro giua cac so, roi hoi khach xac nhan - dung dung mau cau nay (thay dung so vua chuan hoa, giu nguyen cau truc, khong them noi dung ve viec sap goi tool/buoc xu ly noi bo):
   "Dạ, mã danh bộ của Quý Khách là Hai - Hai - Không - Hai - Ba - Hai - Năm - Một - Bảy - Bảy - Năm. Quý Khách xác nhận giúp em có đúng không ạ?"
3. Cho khach xac nhan ro rang truoc khi lam buoc tiep theo.
4. Chi sau khi khach xac nhan dung, goi tool confirm_danh_bo voi value la dung 11 chu so vua doc lai - khong goi som hon, khong goi khi khach chua xac nhan.
5. Neu khach noi so do sai hoac muon sua: hoi lai so dung, doc lai TOAN BO so da sua (khong chi phan vua sua), roi xin xac nhan lai tu dau truoc khi goi tool.

Khong bao gio goi confirm_danh_bo voi gia tri doan, chua doc lai, hoac chua duoc khach xac nhan ro rang. Khong noi ve viec sap goi tool hay cac buoc xu ly noi bo - chi hoi xac nhan tu nhien nhu cau mau tren.`;

// ── Log ra file, giong style checkpoint-giai-doan-6a.mjs ───────────────────
const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const runTimestamp = Date.now();
const txtPath = path.join(logsDir, `checkpoint6b-${runTimestamp}.txt`);
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
let sessionUpdatedCount = 0; // 1 = cua chinh connectRealtimeSession(), 2 = follow-up instructions+turn_detection cua checkpoint nay
let phase = "connecting"; // connecting -> streaming-doc-so -> waiting-readback -> streaming-confirm -> waiting-tool-decision -> done
let readbackResponseCount = 0; // dem response-ended TRONG luc phase === "waiting-readback"
let capturedReadbackText = null; // ghep tu cac 'ai-said' cua CHINH response readback - chi de BAO CAO, KHONG dung lam nguon that (router.handleSignal() moi la nguon that)
let aiSaidThisResponse = [];
const confirmDanhBoCalls = []; // spy quanh router.confirm_danh_bo - { args, out }

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
  tools: [CONFIRM_DANH_BO_TOOL],
  WebSocketImpl: WebSocket,
  log,
  onSignal(signal) {
    tee("[checkpoint-6b] tin hieu chuan hoa:", JSON.stringify(signal));

    if (signal.kind === "response-started") {
      aiSaidThisResponse = [];
    }
    if (signal.kind === "ai-said") {
      aiSaidThisResponse.push(signal.text);
    }
    if (signal.kind === "response-ended" && phase === "waiting-readback") {
      readbackResponseCount++;
      capturedReadbackText = aiSaidThisResponse.join(" ");
    }
    if (signal.kind === "error") {
      sawError = true;
      tee("[checkpoint-6b] NHAN DUOC EVENT ERROR - xem chi tiet o dong <- error phia tren.");
    }
    if (signal.kind === "session-updated") {
      sessionUpdatedCount++;
    }

    // 2 module CHIA SE cung 1 luong tin hieu, DOC LAP nhau - dung tinh than
    // checkpoint-giai-doan-6a.mjs (dispatcher.handleSignal + danhBoFlow.
    // handleSignal). O day: dispatcher.handleSignal (goi tool that khi model
    // yeu cau) + router.handleSignal (nuoi danh-bo-confirm-tool-flow.js -
    // KHONG PHAI ten tool, xem chu thich tool-router.js).
    dispatcher.handleSignal(signal).catch((err) => {
      tee("[checkpoint-6b] Dispatcher loi bat ngo (KHONG duoc xay ra):", err.message);
      finish(1);
    });
    router.handleSignal(signal);
  },
});

// callState RONG - confirm_danh_bo.resolveToolCall() la noi DUY NHAT ghi
// callState.danhBo (dung hop dong danh-bo-confirm-tool-flow.js).
const callState = {};

// Quyet dinh thiet ke #2 (xem dau file) - ham gia LUON throw neu lo bi goi.
function notUsedStub(fnName) {
  return async () => {
    throw new Error(
      `checkpoint-6b: "${fnName}" duoc goi nhung KICH BAN NAY khong ky vong goi toi (chi test confirm_danh_bo) - kiem tra lai wiring neu thay loi nay.`,
    );
  };
}

const router = createToolRouter({
  getTrangThaiTT: notUsedStub("getTrangThaiTT"),
  getSoSanhTangGiam: notUsedStub("getSoSanhTangGiam"),
  getThongBaoCupNuoc: notUsedStub("getThongBaoCupNuoc"),
  baoSuCo: notUsedStub("baoSuCo"),
  getAvailableAgents: notUsedStub("getAvailableAgents"),
  callState,
  log,
});

// Spy quanh confirm_danh_bo - luu lai MOI lan goi de doi chieu o finish().
const handlers = {
  confirm_danh_bo: (args) => {
    const out = router.confirm_danh_bo(args);
    confirmDanhBoCalls.push({ args, out });
    return out;
  },
};

const dispatcher = createToolDispatcher({ send, turnController, log, handlers, now: () => Date.now() });

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[checkpoint-6b] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});
ws.on("error", (err) => {
  console.error("[checkpoint-6b] WS error:", err.message);
});
ws.on("close", (code, reason) => {
  tee(`[checkpoint-6b] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});

// ── Tien ich stream audio (copy tu checkpoint-giai-doan-6a.mjs) ────────────
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
  tee(`[checkpoint-6b] (${label}) Doc file ${filePath}`);
  const { fmt, data } = readWavPcm16(filePath);
  tee(
    `[checkpoint-6b] (${label}) WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ` +
      `${(data.length / fmt.sampleRate / 2).toFixed(2)}s`,
  );
  if (fmt.sampleRate !== 24000) {
    tee(
      `[checkpoint-6b] (${label}) CANH BAO: sample rate KHONG phai 24000Hz - Realtime API co the hieu SAI toc do/cao do ` +
        `am thanh, dan toi transcript sai.`,
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
  tee(`[checkpoint-6b] (${label}) Da phat het file + ${trailingSilenceMs}ms im lang.`);
}

// silence_duration_ms cua turn_detection o day la 700ms (xem session.update
// theo sau, "QUYET DINH THIET KE" dau file) - doi du DAI HON de chac chan
// server kip commit manh cuoi cung.
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

// ── main() - dieu khien TUAN TU ca kich ban, doi tung buoc that ──────────
async function main() {
  await waitForCondition(() => sessionUpdatedCount >= 1, 15000, "cho session-updated DAU TIEN (cua connectRealtimeSession)");
  tee(
    "[checkpoint-6b] Da nhan session-updated dau tien - gui THEM 1 session.update lop instructions (Entity Capture) " +
      "+ turn_detection (server_vad, cau hinh DA PROBE, khong dung 'normal'/'digits' mac dinh - xem 'QUYET DINH THIET KE' dau file).",
  );
  send({
    type: "session.update",
    session: {
      type: "realtime",
      instructions: ENTITY_CAPTURE_INSTRUCTIONS,
      audio: {
        input: {
          turn_detection: { type: "server_vad", threshold: 0.6, silence_duration_ms: 700, create_response: true },
        },
      },
    },
  });

  await waitForCondition(() => sessionUpdatedCount >= 2, 10000, "cho session-updated THU HAI (instructions+turn_detection da ap dung)");
  tee("[checkpoint-6b] session da san sang - phat audio khach doc " + MA_DANH_BO_THAT + "...");

  phase = "streaming-doc-so";
  await streamAudioFile(AUDIO_DOC_SO, "doc-so", TRAILING_SILENCE_MS);

  phase = "waiting-readback";
  tee("[checkpoint-6b] Dang cho model TU NHIEN doc lai xin xac nhan...");
  await waitForCondition(() => readbackResponseCount >= 1, 20000, "cho model doc lai xin xac nhan (response-ended dau tien)");
  tee(`[checkpoint-6b] Model da doc lai (response hoan tat). capturedReadbackText = "${capturedReadbackText}"`);

  phase = "streaming-confirm";
  tee("[checkpoint-6b] Phat audio khach xac nhan 'dung roi'...");
  await streamAudioFile(AUDIO_XAC_NHAN_DUNG, "xac-nhan", TRAILING_SILENCE_MS);

  phase = "waiting-tool-decision";
  tee("[checkpoint-6b] Dang cho model TU NHIEN goi confirm_danh_bo qua duong day that (dispatcher/tool-router)...");
  await waitForCondition(() => confirmDanhBoCalls.length >= 1, 20000, "cho confirm_danh_bo duoc goi qua dispatcher that");

  // Doi them 1 khoang ngan cho model noi cau tra loi cuoi (function_call_
  // output -> turnController.say() mode "auto") kip gui/hoan tat - KHONG can
  // dai nhu checkpoint-giai-doan-6a.mjs (18000ms, do do tre mang toi
  // tongdai-api.js that) vi confirm_danh_bo KHONG goi API mang ngoai nao ca.
  await sleep(5000);

  phase = "done";
  finish(0);
}

main().catch((err) => {
  tee("[checkpoint-6b] main() loi:", err.message);
  finish(1);
});

function finish(exitCode) {
  if (finished) return;
  finished = true;
  setTimeout(() => {
    tee("\n[checkpoint-6b] ===== Tom tat =====");
    tee(`[checkpoint-6b] phase cuoi cung: ${phase}`);
    tee(`[checkpoint-6b] capturedReadbackText: ${capturedReadbackText ?? "(khong co)"}`);
    tee(`[checkpoint-6b] callState.danhBo cuoi cung: ${callState.danhBo ?? "(chua co)"}`);
    tee(`[checkpoint-6b] So lan goi confirm_danh_bo qua dispatcher that (spy): ${confirmDanhBoCalls.length}`);
    confirmDanhBoCalls.forEach((c, i) => {
      tee(`[checkpoint-6b]   lan ${i + 1}: args=${JSON.stringify(c.args)} -> out=${JSON.stringify(c.out)}`);
    });
    tee(`[checkpoint-6b] co event error: ${sawError}`);

    const modelDocLaiXinXacNhan = capturedReadbackText !== null && capturedReadbackText.trim().length > 0;
    const goiToolDungMotLan = confirmDanhBoCalls.length === 1;
    const toolThanhCong = confirmDanhBoCalls.length >= 1 && confirmDanhBoCalls[confirmDanhBoCalls.length - 1].out?.success === true;
    const callStateDungSo = callState.danhBo === MA_DANH_BO_THAT;

    tee(`[checkpoint-6b] (a) Model TU NHIEN doc lai xin xac nhan (khong ep): ${modelDocLaiXinXacNhan}`);
    tee(`[checkpoint-6b] (b) confirm_danh_bo duoc goi DUNG 1 lan qua dispatcher that (khong som/khong lap lai): ${goiToolDungMotLan}${confirmDanhBoCalls.length > 1 ? " [CANH BAO: goi NHIEU HON 1 lan, xem chi tiet o tren]" : ""}`);
    tee(`[checkpoint-6b] (c) Lan goi (cuoi cung) tra ve success:true qua duong day that: ${toolThanhCong}`);
    tee(`[checkpoint-6b] (d) callState.danhBo dung bang ${MA_DANH_BO_THAT} (ghi qua router.confirm_danh_bo that): ${callStateDungSo}`);

    tee(`[checkpoint-6b] Log: ${txtPath}`);
    const ok = modelDocLaiXinXacNhan && goiToolDungMotLan && toolThanhCong && callStateDungSo && !sawError;
    tee(
      `[checkpoint-6b] KET QUA: ${
        ok
          ? "PASS - toan bo duong day Giai doan 6b (session-ws.js/dispatch-tool-call.js/tool-router.js/" +
            "danh-bo-confirm-tool-flow.js/danh-bo-readback-match.js) chay tron ven qua Realtime API that + " +
            "audio TTS that, model TU QUYET DINH doc lai/goi tool, callState.danhBo duoc ghi DUNG qua duong " +
            "day SAN XUAT (khong phai goi tay tu script probe nhu truoc do)."
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
    tee("[checkpoint-6b] TIMEOUT 90s - chua thay du dieu kien PASS, xem log de biet dung o buoc nao.");
    finish(1);
  }
}, 90000);

process.on("SIGINT", () => {
  console.log("\n[checkpoint-6b] Ngat boi nguoi dung (Ctrl+C).");
  finish(1);
});
