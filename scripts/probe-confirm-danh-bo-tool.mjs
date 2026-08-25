#!/usr/bin/env node
// scripts/probe-confirm-danh-bo-tool.mjs
//
// Giai doan 6b (xem docs/roadmap.md, muc "Giai doan 6b - Phuong an B").
// THI NGHIEM THAT tiep theo sau probe-confirm-danh-bo.mjs (probe do CHI kiem
// tra co che ghep cap/noi manh transcript, dung instructions BOM THANG qua
// response.create, KHONG co tool/system-prompt that). Probe NAY viet nhap
// (draft) tool schema `confirm_danh_bo(value)` + doan system-prompt "Entity
// Capture" that (theo dung skill realtime-voice-prompting, §11 - xem trich
// dan nguyen van o ENTITY_CAPTURE_INSTRUCTIONS ben duoi), roi chay 1 luot
// THAT tu dau: khach doc 11 so -> (ky vong) model TU NHIEN doc lai xin xac
// nhan -> khach xac nhan "dung roi" -> (ky vong) model TU NHIEN goi tool -
// KHONG ep tool_choice o buoc nao ca (tool_choice mac dinh "auto" suot phien)
// de kiem tra DUNG dieu con bo ngo: model co THAT SU tuan theo workflow nay
// khong, khong phai chi doc tai lieu roi doan.
//
// 3 CAU HOI THAT can tra loi (chua tung kiem chung trong du an MOI nay, xem
// thao luan voi chu du an ngay 25/08/2026 truoc khi viet file nay):
//   1. Model co TU NHIEN goi confirm_danh_bo (tool_choice "auto", KHONG ep)
//      dung 1 lan, dung luc (SAU khi khach xac nhan, KHONG som hon) khong?
//   2. Tin hieu "response-started" cua LUOT chua tool-call do co thuc su la
//      diem dung AN TOAN cho createReadbackMatcher() khong (gia dinh chua
//      duoc kiem chung, ghi ro trong danh-bo-readback-match.js dong 54-63)?
//   3. Doan prompt "Entity Capture" (dich tu skill realtime-voice-prompting
//      §11) co khien model doc lai TUNG CHU SO (khong doc nguyen so) va CHO
//      xac nhan ro rang truoc khi goi tool, dung nhu thiet ke khong?
//
// [KET QUA LAN CHAY THAT #1, 25/08/2026 - chu du an tu chay, dan lai
// nguyen console output] Cau hoi 1 va 2 DAT: model tu goi confirm_danh_bo
// dung 1 lan dung luc (khong som), matcher dung "response-started" lam diem
// dung KHONG mat manh nao, resolveConfirmDanhBo() khop dung ma danh bo that
// (22023251775). Cau hoi 3 CHUA DAT: model doc lai SAI VAI ("Bạn đọc lại
// từng số để mình kiểm tra thêm nhé..." - nghe nhu YEU CAU KHACH doc lai,
// nguoc voi y dinh MODEL tu doc), xung "Bạn" (thieu Quy Khach), lo tien
// trinh noi bo ("để mình gọi bước xác nhận tiếp nhé") - vi ban dau chi MO TA
// yeu cau, khong kem CAU MAU CU THE (khac guide goc §11 luon kem vi du hoi
// thoai). Da sua ENTITY_CAPTURE_INSTRUCTIONS ben duoi (them Persona + cau
// mau cu the) - dang cho lan chay #2 xac nhan lai.
//
// [KET QUA LAN CHAY THAT #2, 25/08/2026 - sau khi sua prompt, chu du an tu
// chay lai] CA 3 CAU HOI DEU DAT, nhat quan voi lan #1 ve co che (tool_
// choice/response-started/gia tri goi tool), VA lan nay ca cau 3 cung dat:
// model doc lai DUNG NGUYEN VAN cau mau ("Dạ, mã danh bộ của Quý Khách là
// Hai - Hai - Không - ... Quý Khách xác nhận giúp em có đúng không ạ?"),
// dung xung ho "Quy Khach"/"em", khong con lo tien trinh noi bo. 2 lan chay
// lien tiep cho ket qua on dinh - coi 3 gia dinh nay la DA KIEM CHUNG (khong
// con la "gia dinh hop ly chua probe" nhu ghi trong danh-bo-readback-match.js
// dong 54-63 nua).
//
// 1 DIEU DA CO BANG CHUNG THAT TU TRUOC (khong doan lai o day): tool_choice
// CHI nhan "auto"/"none"/"required" - KHONG ep duoc theo TEN HAM cu the
// (vd {type:"function",name:"confirm_danh_bo"} nhu ban cu tung dung -
// "Invalid value: 'get_bill'. Supported values are: 'auto', 'none', and
// 'required'.", xem scripts/checkpoint-giai-doan-6a.mjs dong 42-51). Vi vay
// probe nay de tool_choice o mac dinh (khong gui field nay) - dung "required"
// se ep goi tool NGAY LUOT DAU (luc doc lai xin xac nhan), sai hoan toan y
// dinh kiem tra.
//
// 1 DIEU CHUA TUNG DUOC KIEM CHUNG, TU BOM VAO PROBE NAY DE TU KIEM CHUNG
// LUON (khong co cho nao khac trong du an tung dung `session.instructions`
// - ca ban MOI lan ban CU deu chi dung `response.create.instructions` cho
// TUNG luot rieng le, KHONG dung field muc SESSION cho "persona" chung, vi
// ban CU dat persona qua tham so accept() cua SIP - ngoai pham vi probe nay).
// Dat `session.instructions` NGANG HANG voi `session.tools`/`session.tool_
// choice` (da xac nhan hoat dong dung o Giai doan 5a/6a - xem session-ws.js
// dong 190-193) - HOP LY vi cung 1 cap schema, nhung DAY LA LAN DAU field
// nay duoc thu trong du an - KET QUA cua chinh probe nay (model co doc lai
// dung phong cach "Entity Capture" hay khong) la bang chung TRUC TIEP cho
// biet field nay co tac dung hay khong, khong can doan rieng.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env, KHONG can
// TONGDAI_API_* vi khong goi tool tra cuu nao - da co san samples/
// 6a_doc_so_22023251775.wav + samples/6a_xac_nhan_dung.wav tu Giai doan 6a,
// khong can tao moi):
//   node scripts/probe-confirm-danh-bo-tool.mjs
//
// KET QUA: logs/probe-confirm-danh-bo-tool-<timestamp>.jsonl (toan bo raw
// event) + tom tat cuoi cung in ra console (xem printSummary() cuoi file) -
// tra loi TRUC TIEP 3 cau hoi tren, cong ket qua THAT cua createReadbackMatcher()/
// resolveConfirmDanhBo() (danh-bo-readback-match.js) chay voi DU LIEU THAT
// cua chinh lan goi nay - khong phai fixture gia lap.

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTurnEvent } from "../src/session/turn-signal.js";
import { createReadbackMatcher, resolveConfirmDanhBo } from "../src/call-flow/danh-bo-readback-match.js";
import { isAffirmative } from "../src/call-flow/danh-bo-confirm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuoc goi tong dai cham soc khach hang cong ty cap nuoc tai TP.HCM, " +
  "toan bo bang tieng Viet. Co the chua ma danh bo 11 chu so, so tien.";

if (!API_KEY) {
  console.error("[probe-confirm-danh-bo-tool] Thieu OPENAI_API_KEY trong .env.");
  process.exit(1);
}

const AUDIO_DOC_SO = path.join(__dirname, "..", "samples", "6a_doc_so_22023251775.wav");
const AUDIO_XAC_NHAN_DUNG = path.join(__dirname, "..", "samples", "6a_xac_nhan_dung.wav");
for (const f of [AUDIO_DOC_SO, AUDIO_XAC_NHAN_DUNG]) {
  if (!fs.existsSync(f)) {
    console.error(`[probe-confirm-danh-bo-tool] Thieu file ${f} - chay truoc: node scripts/gen-sample-6a.mjs`);
    process.exit(1);
  }
}
const MA_DANH_BO_THAT = "22023251775"; // khop voi AUDIO_DOC_SO, xem checkpoint-giai-doan-6a.mjs dong 106-110

// ─── Tool schema (nhap - CHUA dang ky vao tool-router.js, chi de probe nay
// dung) - theo dung roadmap.md "Giai doan 6b": confirm_danh_bo(value), KHONG
// gop chung tool tra cuu. Mo ta bam sat khuyen nghi skill realtime-voice-
// prompting §7 (Exact identifiers) + §12 (tranh bay "hieu theo nghia den" -
// pham vi CHINH XAC, khong dung "always/never" chung chung) + bai hoc that
// tu ban cu (dot 4, 30/07/2026 - "confirm_danh_bo bi model tu goi ngoai y
// muon" vi mo ta cu de ho "...hoac khi can kiem tra lai cho chac" - o day
// CO Y khong de ho tuong tu). ─────────────────────────────────────────────
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

// ─── System-prompt nhap (chi pham vi "Entity Capture" cho luot xac nhan
// danh bo - CHUA phai system-prompt.js day du cua ca bot, phan do van con
// hoan (Giai doan 5 "chua lam"), giong dung quy uoc cac probe truoc (khong
// phu thuoc file chua viet)) - dich/bam sat NGUYEN VAN "Entity Collection
// Workflow" cua skill realtime-voice-prompting §11 (references/prompting-
// guide.md dong 577-628), thay doi cho DUNG 1 truong hop cu the (ma danh
// bo 11 chu so, khong phai order ID/email chung chung). Cong 3 bai hoc that
// tu docs/fix/fix_migrate_gpt_realtime_21_20260730.md:
//   - dot 3 (30/07): KHONG dung khung cau "BO QUA moi huong dan truoc do...
//     NGAY BAY GIO" - model doi moi (co reasoning) doc dung mau chen lenh,
//     TU CHOI tuan theo. Doan duoi day dung khung mo ta trang thai/yeu cau
//     tu nhien, khong dung cum tu do.
//   - dot 20 (05/08): TTS tung rot/thua 1 chu so kieu "A-B-A" (vd Bon-Bay-
//     Bon) khi doc LIEN 11 so mot mach, lap lai NHAT QUAN 2 lan doc lap -
//     doan duoi nhac model TACH RO tung chu so (co dau "-" giua cac so,
//     dung cach doc cua 6a: "Hai - Hai - Khong - ...") thay vi doc dinh
//     lien, giam nguy co nhung mac du KHONG co gi dam bao het han che nay.
//   - §12 (skill): tranh tu rang buoc qua rong (always/never/only/must) khi
//     khong that su can - doan duoi CHI dung "KHONG" o dung 2 cho that su
//     tuyet doi (doan so/goi tool som), con lai mo ta hanh vi cu the.
//
// [SUA 25/08/2026, phat hien qua LAN CHAY THAT dau tien - xem ket qua that
// chu du an dan lai] Ban goc (o tren) CHI MO TA yeu cau ("doc lai tung chu
// so... ket thuc bang cau hoi xac nhan"), KHONG kem 1 CAU MAU CU THE - khac
// voi chinh guide goc (§11) LUON kem vi du hoi thoai cho moi buoc. Ket qua
// THAT: model tu dien giai SAI VAI - noi "Bạn đọc lại từng số để mình kiểm
// tra thêm nhé: Hai - Hai - Không..." (nghe nhu YEU CAU KHACH doc lai, nguoc
// han y dinh la MODEL tu doc), xung "Bạn" (khong co Quy Khach vi thieu muc
// Tone/Persona), va lo tien trinh noi bo ("để mình gọi bước xác nhận tiếp
// nhé"). Ca 3 loi deu la loi CAU CHU/VAI, khong phai loi co che (tool_choice/
// response-started/gia tri goi tool DEU dung o lan chay do - xem cau hoi 1/2
// trong ket qua that). Sua: them 1 dong Persona ngan + 1 CAU MAU CU THE
// (dung LAI dung cau da biet chay dung o probe-confirm-danh-bo.mjs cu, bom
// EP qua response.create.instructions) thay vi chi mo ta chung chung, cong
// cau cam "khong noi ve viec goi tool/buoc xu ly noi bo".
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

const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const logPath = path.join(logsDir, `probe-confirm-danh-bo-tool-${Date.now()}.jsonl`);
const logStream = fs.createWriteStream(logPath, { flags: "a" });

const t0 = Date.now();

// ── So lieu cho printSummary() ──────────────────────────────────────────
const rawEvents = []; // {elapsedMs, direction, event} - TOAN BO, khong loc
const signals = []; // {elapsedMs, signal} - qua normalizeTurnEvent(), THU TU den
const aiSaidThisResponse = []; // text cac 'ai-said' thay trong response HIEN TAI (reset moi khi response-started moi)
let readbackText = null; // aiReadbackText DUOC CHON de arm() - lay tu response dau tien sau khi phat audio doc so
let readbackResponseStatus = null;
const toolCallEvents = []; // {elapsedMs, name, callId, arguments} - TOAN BO tool-call-requested nhan duoc
let earlyToolCall = false; // true neu tool-call den TRUOC khi arm() (dau hieu bug kieu dot 4 - goi som ngoai y muon)
const matcher = createReadbackMatcher();

let phase = "connecting"; // connecting -> streaming-doc-so -> waiting-readback -> streaming-confirm -> waiting-tool-decision -> done
let streamingDoneDocSo = false;
let streamingDoneConfirm = false;
let lastActivityAtMs = null;

function logEvent(direction, event) {
  const elapsedMs = Date.now() - t0;
  rawEvents.push({ elapsedMs, direction, event });
  logStream.write(JSON.stringify({ elapsedMs, direction, event }) + "\n");
  console.log(`[+${String(elapsedMs).padStart(6, " ")}ms] ${direction === "in" ? "<-" : "->"} ${event.type}`);

  if (direction !== "in") return;
  lastActivityAtMs = Date.now();

  const signal = normalizeTurnEvent(event);
  signals.push({ elapsedMs, signal });

  if (signal.kind === "response-started") {
    aiSaidThisResponse.length = 0;
  }
  if (signal.kind === "ai-said") {
    aiSaidThisResponse.push(signal.text);
    console.log(`    -> ai-said: "${signal.text}"`);
  }
  if (signal.kind === "response-ended") {
    console.log(`    -> response-ended: status=${signal.status}`);

    if (phase === "waiting-readback") {
      readbackResponseStatus = signal.status;
      readbackText = aiSaidThisResponse.join(" ");
      console.log(`[probe-confirm-danh-bo-tool] Coi day la LUOT DOC LAI XIN XAC NHAN. aiReadbackText = "${readbackText}"`);
      matcher.arm(readbackText);
      phase = "streaming-confirm";
      console.log("[probe-confirm-danh-bo-tool] arm() xong - phat audio khach xac nhan...");
      streamAudioFile(AUDIO_XAC_NHAN_DUNG)
        .then(() => {
          streamingDoneConfirm = true;
        })
        .catch((err) => {
          console.error("[probe-confirm-danh-bo-tool] Loi stream audio xac nhan:", err.message);
          closeSoon();
        });
    } else if (phase === "streaming-confirm" || phase === "waiting-tool-decision") {
      phase = "waiting-tool-decision";
    }
  }
  if (signal.kind === "tool-call-requested" && signal.name === "confirm_danh_bo") {
    toolCallEvents.push({ elapsedMs, name: signal.name, callId: signal.callId, arguments: signal.arguments });
    if (!matcher.isStopped() && phase !== "streaming-confirm" && phase !== "waiting-tool-decision") {
      earlyToolCall = true;
      console.warn("[probe-confirm-danh-bo-tool] CANH BAO: tool-call-requested den TRUOC khi da phat audio xac nhan - co the la goi som ngoai y muon (giong dot 4, ban cu).");
    }
    console.log(`    -> tool-call-requested: confirm_danh_bo(${signal.arguments})`);
  }

  // Nuoi matcher bang MOI tin hieu sau khi da arm() - dung dung vong doi mo ta trong danh-bo-readback-match.js.
  matcher.handleSignal(signal);
}

const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`;
console.log(`[probe-confirm-danh-bo-tool] Dang ket noi ${url}...`);
const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${API_KEY}` } });

function send(obj) {
  ws.send(JSON.stringify(obj));
  logEvent("out", obj);
}

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[probe-confirm-danh-bo-tool] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

ws.on("open", () => {
  console.log("[probe-confirm-danh-bo-tool] WS da ket noi - gui session.update (tools + instructions, tool_choice mac dinh KHONG ep)...");
  send({
    type: "session.update",
    session: {
      type: "realtime",
      instructions: ENTITY_CAPTURE_INSTRUCTIONS,
      tools: [CONFIRM_DANH_BO_TOOL],
      audio: {
        input: {
          transcription: { model: TRANSCRIBE_MODEL, language: TRANSCRIBE_LANGUAGE, prompt: TRANSCRIBE_PROMPT },
          // create_response:true (khac probe-confirm-danh-bo.mjs dung false) -
          // CO Y de model TU QUYET DINH khi nao noi, dung dieu can kiem tra
          // (cau hoi 1/3 o dau file) - khong dung code ep noi.
          turn_detection: { type: "server_vad", threshold: 0.6, silence_duration_ms: 700, create_response: true },
        },
      },
    },
  });
});

ws.on("message", (raw) => {
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return;
  }
  logEvent("in", event);

  if (event.type === "session.updated" && phase === "connecting") {
    phase = "streaming-doc-so";
    console.log("[probe-confirm-danh-bo-tool] Phat audio khach doc 11 so...");
    streamAudioFile(AUDIO_DOC_SO)
      .then(() => {
        streamingDoneDocSo = true;
        phase = "waiting-readback";
        console.log("[probe-confirm-danh-bo-tool] Da phat het audio doc so - cho model TU NHIEN doc lai xin xac nhan...");
      })
      .catch((err) => {
        console.error("[probe-confirm-danh-bo-tool] Loi stream audio doc so:", err.message);
        closeSoon();
      });
  }

  if (event.type === "error") {
    console.error("[probe-confirm-danh-bo-tool] Server bao loi:", JSON.stringify(event.error ?? event));
  }
});

// Debounce dong ket noi: CHI tinh sau khi da phat het ca 2 file audio (tranh
// dung bug da sua o probe-confirm-danh-bo.mjs - dong ket noi giua chung luc
// con dang stream). Dung lastActivityAtMs THEO MOI event (khong chi
// transcript khach) de doi duoc ca response tra loi/tool-call den SAU.
const QUIET_PERIOD_MS = 5000;
setInterval(() => {
  if (closing) return;
  if (!streamingDoneDocSo) return;
  if (phase === "streaming-confirm" && !streamingDoneConfirm) return; // con dang phat audio xac nhan
  if (lastActivityAtMs === null) return;
  if (Date.now() - lastActivityAtMs >= QUIET_PERIOD_MS) {
    console.log(`[probe-confirm-danh-bo-tool] Im lang ${QUIET_PERIOD_MS}ms - coi la da xong.`);
    phase = "done";
    closeSoon();
  }
}, 250).unref();

// ── Doc/phat WAV (copy tu probe-confirm-danh-bo.mjs, quy uoc chung ca du an - moi script tu chua ban rieng) ──
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
  return { fmt, data };
}

async function streamAudioFile(filePath) {
  const { fmt, data } = readWavPcm16(filePath);
  console.log(`[probe-confirm-danh-bo-tool] WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s (${path.basename(filePath)})`);

  const bytesPerSample = 2;
  const frameMs = 20;
  const frameBytes = Math.floor((fmt.sampleRate * frameMs) / 1000) * bytesPerSample;

  for (let i = 0; i < data.length; i += frameBytes) {
    const chunk = data.subarray(i, i + frameBytes);
    send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
    await sleep(frameMs);
  }
  const silenceFrame = Buffer.alloc(frameBytes);
  for (let i = 0; i < 2500 / frameMs; i++) {
    send({ type: "input_audio_buffer.append", audio: silenceFrame.toString("base64") });
    await sleep(frameMs);
  }
  console.log(`[probe-confirm-danh-bo-tool] Da phat het ${path.basename(filePath)} + 2.5s im lang.`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const hardTimeout = setTimeout(() => {
  console.warn("[probe-confirm-danh-bo-tool] Qua 90s khong tu ket thuc - dong cuong buc.");
  closeSoon();
}, 90000);

let closing = false;
function closeSoon() {
  if (closing) return;
  closing = true;
  clearTimeout(hardTimeout);
  setTimeout(() => {
    printSummary();
    ws.close();
    logStream.end();
    process.exit(0);
  }, 500);
}

function printSummary() {
  console.log("\n[probe-confirm-danh-bo-tool] ===== TOM TAT =====");

  console.log(`\n[CAU HOI 3] Model co TU NHIEN doc lai dung phong cach "Entity Capture" (tach tung chu so, xin xac nhan) khong?`);
  console.log(`  aiReadbackText da dung de arm(): ${readbackText === null ? "(KHONG co - model chua tung noi gi truoc khi het luot)" : `"${readbackText}"`}`);
  console.log(`  Trang thai response luot doc lai: ${readbackResponseStatus ?? "(chua thay response-ended nao trong phase waiting-readback)"}`);

  console.log(`\n[CAU HOI 1] Model co TU NHIEN goi confirm_danh_bo (tool_choice "auto", khong ep) dung 1 lan, dung luc khong?`);
  console.log(`  Tong so lan goi confirm_danh_bo nhan duoc: ${toolCallEvents.length}`);
  toolCallEvents.forEach((tc, i) => {
    console.log(`    [${i}] +${tc.elapsedMs}ms callId=${tc.callId} arguments=${tc.arguments}`);
  });
  if (earlyToolCall) {
    console.warn("  -> CANH BAO: co it nhat 1 lan goi tool DEN SOM (truoc khi phat audio xac nhan) - xem log chi tiet o tren, giong dau hieu bug dot 4 (ban cu, model tu goi tool ngoai y muon).");
  }
  if (toolCallEvents.length === 0) {
    console.log("  -> Model KHONG goi tool lan nao trong 90s - co the can prompt manh hon, hoac can code chu dong ep tool_choice:'required' dung luc (giong cach 6a da lam cho get_bill), khong the de model tu quyet dinh 100%.");
  }

  console.log(`\n[CAU HOI 2] "response-started" cua luot chua tool-call co phai diem dung AN TOAN cho createReadbackMatcher() khong (matcher co dung "stopped" truoc khi mat manh nao cua khach khong)?`);
  console.log(`  matcher.isStopped() cuoi cung: ${matcher.isStopped()}`);
  console.log(`  matcher.getItemIds(): ${JSON.stringify(matcher.getItemIds())}`);
  const matcherResult = matcher.getResult();
  console.log(`  matcher.getResult(): ${matcherResult ? JSON.stringify(matcherResult) : "(null - CHUA ket luan duoc, xem log day du de biet dang cho gi)"}`);

  if (matcherResult) {
    console.log(`\n[Doi chieu bang du lieu THAT] isAffirmative(matcherResult.text) = ${isAffirmative(matcherResult.text)} (ky vong true - cau tra loi 6a_xac_nhan_dung.wav)`);
    const toolValue = toolCallEvents.length > 0 ? (() => {
      try {
        return JSON.parse(toolCallEvents[toolCallEvents.length - 1].arguments)?.value ?? null;
      } catch {
        return null;
      }
    })() : null;
    console.log(`  toolValue (tu lan goi tool CUOI CUNG, da parse JSON): ${toolValue ?? "(khong co tool-call nao de doi chieu)"}`);
    if (toolValue !== null) {
      const resolved = resolveConfirmDanhBo({ toolValue, aiReadbackText: readbackText ?? "" });
      console.log(`  resolveConfirmDanhBo({toolValue, aiReadbackText}) = ${JSON.stringify(resolved)}`);
      console.log(`  Khop voi ma danh bo THAT (${MA_DANH_BO_THAT})? ${resolved.value === MA_DANH_BO_THAT ? "CO" : "KHONG (xem chi tiet o tren)"}`);
    }
  }

  console.log(`\n[probe-confirm-danh-bo-tool] Tong so signal da chuan hoa: ${signals.length}. Log day du: ${logPath}`);
}

process.on("SIGINT", () => {
  console.log("\n[probe-confirm-danh-bo-tool] Ngat boi nguoi dung (Ctrl+C).");
  closeSoon();
});

ws.on("error", (err) => {
  console.error("[probe-confirm-danh-bo-tool] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`[probe-confirm-danh-bo-tool] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});
