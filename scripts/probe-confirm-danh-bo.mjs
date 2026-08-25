#!/usr/bin/env node
// scripts/probe-confirm-danh-bo.mjs
//
// Giai doan 6b (xem docs/roadmap.md, muc "Giai doan 6b - Phuong an B").
// THI NGHIEM THAT - CAU HOI DUY NHAT can tra loi TRUOC khi viet bat ky
// matcher/tool-handler nao cho 6b (rà soát thiết kế 24/08/2026 với chủ dự
// án đã xác nhận giữ nguyên thiết kế 21/08, nhưng phát hiện 1 lỗ hổng kỹ
// thuật lúc rà soát): buoc 1 cua thiet ke ("Khop cap ... dung previous_
// item_id/thu tu item de khop DUNG CAP") DOI HOI tin hieu server gui ve
// khi KHACH tra loi (conversation.item.input_audio_transcription.completed)
// phai co field previous_item_id TRO DUNG ve item cua chinh cau MODEL vua
// doc lai xin xac nhan - nhung:
//   1. turn-signal.js#normalizeTurnEvent HIEN TAI chi chuan hoa
//      previous_item_id cho "input_audio_buffer.committed" (dung de noi cac
//      manh VAD cua CUNG 1 luot khach noi, xem danh-bo-collect.js) - KHONG
//      chuan hoa cho "conversation.item.input_audio_transcription.completed".
//   2. CHUA CO bang chung THAT nao xac nhan raw event do CO mang previous_
//      item_id hay khong, VA neu co thi gia tri co THAT SU tro ve item cua
//      MODEL (khac vai/role) hay chi tro ve item TRUOC DO cua CHINH khach
//      (cung vai, nhu cach dung o buffer-committed) - 2 kha nang nay HOAN
//      TOAN khac nhau ve y nghia, khong the doan.
//
// Script nay: bat model NOI 1 cau doc lai so + hoi xac nhan (dung text
// injection + response.create, KHONG can system-prompt.js that cua 6b -
// chi can mo phong DUNG HINH DANG 1 luot "model doc lai xin xac nhan"), roi
// phat NGAY audio khach xac nhan that (mac dinh samples/6a_xac_nhan_dung.wav,
// da co san, da qua kiem tra bang tai) - ghi lai TOAN BO raw event (khong chi
// normalize) de doi chieu truc tiep item id cua ca 2 phia.
//
// [them 25/08/2026] CAU HOI THEM tu chu du an, sau khi thay createReadback
// Matcher() (danh-bo-readback-match.js) chi lay manh user-item-added DAU
// TIEN: neu khach TRA LOI XAC NHAN cung bi VAD tach thanh NHIEU manh (khach
// "noi ngat quang", khac voi "noi lien tuc" da thu o lan chay dau
// 24/08/2026), thi:
//   1. Co bao nhieu input_audio_buffer.committed / conversation.item.added
//      (role:"user") / conversation.item.input_audio_transcription.completed
//      xay ra cho MOT cau tra loi cua khach?
//   2. previous_item_id tren input_audio_buffer.committed (DA co bang chung
//      That noi CHUNG tu Giai doan 1 - xem docs/fix/giai_doan_1_quan_sat_
//      event_that_20260820.md dong 288-291) CO noi dung cac manh nay lai
//      voi nhau trong TINH HUONG CU THE nay (cau tra loi xac nhan NGAN,
//      khac voi cau doc 11 chu so DAI da kiem chung o Giai doan 1) khong?
//   3. conversation.item.added CO field previous_item_id o CAP TOP-LEVEL
//      (khac voi cap `item` da xac nhan KHONG co o lan chay truoc) khong -
//      va gia tri co khop voi item truoc do cua CHINH khach (chuoi cung vai)
//      khong?
// Sua script de nhan DUONG DAN FILE AUDIO KHACH tu CLI arg (mac dinh giu
// nguyen hanh vi cu neu khong truyen) va THEO DOI TOAN BO cac manh (khong
// dong lai o manh DAU TIEN nhu truoc) - xem CLI_AUDIO_PATH/committedEvents/
// customerTranscriptEvents duoi day.
//
// CACH CHAY (tren may that, can OPENAI_API_KEY trong .env):
//   node scripts/probe-confirm-danh-bo.mjs                                    # cau tra loi LIEN TUC (mac dinh, giong lan chay 24/08/2026)
//   node scripts/probe-confirm-danh-bo.mjs samples/6b_xac_nhan_ngat_quang.wav # cau tra loi NGAT QUANG (chay gen-sample-confirm-ngat-quang.mjs truoc)
//
// KET QUA: logs/probe-confirm-danh-bo-<timestamp>.jsonl (toan bo event tho)
// + tom tat cuoi cung in ra console (xem printSummary() cuoi file) - tra
// loi TRUC TIEP cau hoi o tren, khong suy doan.

import "dotenv/config";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_LANGUAGE = "vi";
const TRANSCRIBE_PROMPT = "Cuoc goi tong dai cham soc khach hang cong ty cap nuoc tai TP.HCM, " +
  "toan bo bang tieng Viet. Co the chua ma danh bo 11 chu so, so tien.";

if (!API_KEY) {
  console.error("[probe-confirm-danh-bo] Thieu OPENAI_API_KEY trong .env.");
  process.exit(1);
}

// [them 25/08/2026] Cho phep truyen duong dan audio khach qua CLI arg (xem
// vi du chay o dau file) - mac dinh giu NGUYEN file cu (cau tra loi lien
// tuc) de khong pha vo kha nang chay lai doi chung voi ket qua 24/08/2026.
const CLI_AUDIO_ARG = process.argv[2];
const AUDIO_XAC_NHAN_DUNG = CLI_AUDIO_ARG
  ? path.resolve(process.cwd(), CLI_AUDIO_ARG)
  : path.join(__dirname, "..", "samples", "6a_xac_nhan_dung.wav");
if (!fs.existsSync(AUDIO_XAC_NHAN_DUNG)) {
  console.error(`[probe-confirm-danh-bo] Thieu file ${AUDIO_XAC_NHAN_DUNG} - chay truoc: node scripts/gen-sample-6a.mjs (hoac gen-sample-confirm-ngat-quang.mjs).`);
  process.exit(1);
}

// Bat model NOI cau nay NGUYEN VAN (mode "tool" khong dung duoc o day vi
// khong can tool - dung 1 tin nhan user + response.create BINH THUONG,
// nhung ep noi dung qua instructions truc tiep trong response.create de
// khoi phu thuoc he thong prompt CHUA viet cua 6b).
const READBACK_INSTRUCTIONS =
  "Đọc lại nguyên văn, chậm rãi, tách từng chữ số: " +
  "'Dạ, mã danh bộ của Quý Khách là Hai - Hai - Không - Hai - Ba - Hai - Năm - Một - Bảy - Bảy - Năm. " +
  "Quý Khách xác nhận giúp em có đúng không ạ?' - không nói gì thêm, không thêm bớt.";

const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });
const logPath = path.join(logsDir, `probe-confirm-danh-bo-${Date.now()}.jsonl`);
const logStream = fs.createWriteStream(logPath, { flags: "a" });

const t0 = Date.now();

// ── So lieu cho printSummary() ──────────────────────────────────────────
let aiItemId = null; // item_id cua CAU MODEL doc lai (tu response.output_audio_transcript.done)
let aiResponseId = null;
const conversationItemsRaw = []; // {source: "added"|"done", item} - TOAN BO conversation.item.* THAT nhan duoc, KHONG loc
// [them 25/08/2026] Doi tu 1 bien don (customerTranscriptEvent) sang MANG -
// khach co the tra loi NGAT QUANG, VAD co the tach thanh NHIEU manh, moi
// manh la 1 event rieng. KHONG con dung "co transcript dau tien" lam dieu
// kien dung nua (xem hardTimeout/quiet-period logic ben duoi).
const customerTranscriptEvents = []; // [{...raw event}]
const committedEvents = []; // [{itemId, previousItemId, elapsedMs}] - tu input_audio_buffer.committed
let responseDoneSeen = false;
let lastCustomerActivityAtMs = null; // debounce: dong ket noi sau 1 khoang IM LANG kem theo, khong dong ngay khi thay manh DAU TIEN

function logEvent(direction, event) {
  const elapsedMs = Date.now() - t0;
  logStream.write(JSON.stringify({ elapsedMs, direction, event }) + "\n");
  console.log(`[+${String(elapsedMs).padStart(6, " ")}ms] ${direction === "in" ? "<-" : "->"} ${event.type}`);

  if (direction !== "in") return;

  if (event.type === "response.output_audio_transcript.done") {
    aiItemId = event.item_id ?? null;
    aiResponseId = event.response_id ?? null;
    console.log(`    -> item_id CUA CAU MODEL doc lai: ${aiItemId} (response_id=${aiResponseId})`);
    console.log(`    -> transcript: "${event.transcript}"`);
  }
  if (event.type === "response.done") {
    responseDoneSeen = true;
  }
  // [them 25/08/2026] input_audio_buffer.committed - da co bang chung That
  // (Giai doan 1) la co previous_item_id, dung de noi cac manh VAD tach cua
  // CUNG 1 luot noi. Ghi lai TOAN BO (khong chi 1 manh) de xem co xay ra
  // NHIEU LAN cho 1 cau tra loi xac nhan hay khong (CHUA kiem chung rieng
  // cho tinh huong nay - xem chu thich dau file).
  if (event.type === "input_audio_buffer.committed") {
    committedEvents.push({ itemId: event.item_id ?? null, previousItemId: event.previous_item_id ?? null, elapsedMs });
    console.log(`    -> committed: item_id=${event.item_id} previous_item_id=${event.previous_item_id ?? "(null)"}`);
  }
  if (event.type === "conversation.item.added" || event.type === "conversation.item.done") {
    // Ghi lai TOAN BO item object THAT server gui - KHONG doan truoc field
    // nao co/khong co, in het ra de doc bang mat. Giu ca previous_item_id
    // CAP TOP-LEVEL cua event (khac voi cap `item` - lan chay truoc da xac
    // nhan `item` KHONG co field nay, nhung CHUA kiem tra rieng cap top-level
    // cho item CUA KHACH khi bi VAD tach nhieu manh).
    conversationItemsRaw.push({
      source: event.type,
      previousItemIdTopLevel: event.previous_item_id ?? null,
      item: event.item ?? null,
    });
  }
  if (event.type === "conversation.item.input_audio_transcription.completed") {
    customerTranscriptEvents.push(event);
    lastCustomerActivityAtMs = Date.now();
    console.log(`    -> KHACH noi (manh #${customerTranscriptEvents.length}): "${event.transcript}" (item_id=${event.item_id})`);
    console.log(`    -> RAW EVENT DAY DU: ${JSON.stringify(event)}`);
  }
}

const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`;
console.log(`[probe-confirm-danh-bo] Dang ket noi ${url}...`);
const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${API_KEY}` } });

function send(obj) {
  ws.send(JSON.stringify(obj));
  logEvent("out", obj);
}

ws.on("unexpected-response", (_req, res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    console.error(`[probe-confirm-danh-bo] Handshake bi tu choi: HTTP ${res.statusCode} | ${body.slice(0, 500)}`);
    process.exit(1);
  });
});

let phase = "connecting"; // connecting -> asking-readback -> waiting-response-done -> streaming-customer-reply -> done

ws.on("open", () => {
  console.log("[probe-confirm-danh-bo] WS da ket noi - gui session.update ('normal', KHONG can 'digits')...");
  send({
    type: "session.update",
    session: {
      type: "realtime",
      audio: {
        input: {
          transcription: { model: TRANSCRIBE_MODEL, language: TRANSCRIBE_LANGUAGE, prompt: TRANSCRIBE_PROMPT },
          turn_detection: { type: "server_vad", threshold: 0.6, silence_duration_ms: 700, create_response: false },
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
    phase = "asking-readback";
    console.log("[probe-confirm-danh-bo] Ep model doc lai cau xac nhan (response.create voi instructions truc tiep)...");
    send({ type: "response.create", response: { instructions: READBACK_INSTRUCTIONS } });
  }

  if (event.type === "response.done" && phase === "asking-readback") {
    phase = "streaming-customer-reply";
    console.log("[probe-confirm-danh-bo] Model da noi xong (response.done) - phat NGAY audio khach xac nhan...");
    streamAudioFile(AUDIO_XAC_NHAN_DUNG).catch((err) => {
      console.error("[probe-confirm-danh-bo] Loi khi stream audio:", err.message);
      closeSoon();
    });
  }

  if (event.type === "error") {
    console.error("[probe-confirm-danh-bo] Server bao loi:", JSON.stringify(event.error ?? event));
  }
});

// [them 25/08/2026] THAY THE "dong ngay khi thay manh dau tien" (cu) bang
// debounce theo THOI GIAN IM LANG - can cho HET cac manh neu khach tra loi
// ngat quang (nhieu manh lien tiep), khong duoc dong som sau manh DAU TIEN
// (se lam mat du lieu cac manh sau, dung CHINH cai bug dang can kiem chung).
// 4000ms chon RONG hon nhieu so voi khoang ngung giua cac cum da do THAT o
// Giai doan 1 (~416-1348ms, xem docs/fix/giai_doan_1_...) - danh du bien do
// an toan, KHONG doan thap hon se bi cat manh cuoi.
const QUIET_PERIOD_MS = 4000;
setInterval(() => {
  if (closing) return;
  if (phase !== "streaming-customer-reply" && phase !== "done") return;
  if (lastCustomerActivityAtMs === null) return;
  if (Date.now() - lastCustomerActivityAtMs >= QUIET_PERIOD_MS) {
    console.log(`[probe-confirm-danh-bo] Da im lang ${QUIET_PERIOD_MS}ms sau manh transcript cuoi cung - coi la KHACH da noi xong.`);
    phase = "done";
    closeSoon();
  }
}, 250).unref();

// ── Doc WAV toi gian (copy tu probe-danh-bo-vad.mjs) ──────────────────────
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
  console.log(`[probe-confirm-danh-bo] WAV: ${fmt.sampleRate}Hz, ${fmt.numChannels} kenh, ${fmt.bitsPerSample}-bit, ${(data.length / fmt.sampleRate / 2).toFixed(2)}s`);

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
  console.log("[probe-confirm-danh-bo] Da phat het audio khach + 2.5s im lang - cho transcript...");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const hardTimeout = setTimeout(() => {
  console.warn("[probe-confirm-danh-bo] Qua 60s khong tu ket thuc - dong cuong buc.");
  closeSoon();
}, 60000);

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
  console.log("\n[probe-confirm-danh-bo] ===== TOM TAT =====");
  console.log(`\nFile audio khach dung lan chay nay: ${AUDIO_XAC_NHAN_DUNG}`);
  console.log(`item_id cua CAU MODEL doc lai xac nhan: ${aiItemId ?? "(KHONG bat duoc - xem log day du)"}`);
  console.log(`response.done cua luot model: ${responseDoneSeen}`);

  console.log(`\nconversation.item.added/done THAT nhan duoc (${conversationItemsRaw.length} entry) - IN NGUYEN item object + previous_item_id CAP TOP-LEVEL:`);
  conversationItemsRaw.forEach((entry, i) => {
    console.log(`  [${i}] (${entry.source}) previous_item_id(top-level)=${entry.previousItemIdTopLevel ?? "(null)"} item=${JSON.stringify(entry.item)}`);
  });

  console.log(`\ninput_audio_buffer.committed THAT nhan duoc (${committedEvents.length} entry) - previous_item_id da chuan hoa san o turn-signal.js (buffer-committed.previousItemId):`);
  committedEvents.forEach((c, i) => {
    console.log(`  [${i}] +${c.elapsedMs}ms item_id=${c.itemId} previous_item_id=${c.previousItemId ?? "(null)"}`);
  });

  console.log(`\nconversation.item.input_audio_transcription.completed cua KHACH (${customerTranscriptEvents.length} manh):`);
  if (customerTranscriptEvents.length === 0) {
    console.log("  -> KHONG nhan duoc manh nao (het thoi gian cho hoac loi mang - xem log day du).");
  } else {
    customerTranscriptEvents.forEach((ev, i) => {
      const hasPreviousItemId = Object.prototype.hasOwnProperty.call(ev, "previous_item_id");
      console.log(`  [${i}] item_id=${ev.item_id} previous_item_id=${hasPreviousItemId ? (ev.previous_item_id ?? "(null)") : "(KHONG CO FIELD NAY)"} transcript="${ev.transcript}"`);
    });

    console.log(`\n[CAU HOI 1] Ghep TOAN BO cac manh theo dung thu tu den (${customerTranscriptEvents.length} manh) co ra cau tra loi hop ly khong?`);
    console.log(`  Ghep lai: "${customerTranscriptEvents.map((e) => e.transcript).join(" | ")}"`);

    console.log(`\n[CAU HOI 2] previous_item_id tren input_audio_buffer.committed co NOI dung cac manh cua KHACH voi nhau khong (moi manh sau tro ve item_id cua manh truoc, CUNG vai)?`);
    if (committedEvents.length <= 1) {
      console.log(`  -> Chi co ${committedEvents.length} committed event - KHONG co gi de noi (khach tra loi 1 manh duy nhat trong lan chay nay).`);
    } else {
      for (let i = 1; i < committedEvents.length; i++) {
        const prev = committedEvents[i - 1];
        const cur = committedEvents[i];
        const khop = cur.previousItemId === prev.itemId;
        console.log(`  committed[${i}].previous_item_id ("${cur.previousItemId}") so voi committed[${i - 1}].item_id ("${prev.itemId}"): ${khop ? "KHOP DUNG - previous_item_id NOI DUNG 2 manh nay" : "KHONG KHOP"}`);
      }
    }

    console.log(`\n[CAU HOI 3] conversation.item.added CO previous_item_id CAP TOP-LEVEL cho item CUA KHACH khong, va co dung de noi cac manh cua khach voi nhau (khac vai tro voi cau hoi lan truoc - lan truoc chi kiem tra khong co field nay tren CHINH transcription.completed)?`);
    const userItems = conversationItemsRaw.filter((e) => e.source === "conversation.item.added" && e.item?.role === "user");
    if (userItems.length === 0) {
      console.log("  -> KHONG co conversation.item.added nao role:\"user\" trong log nay.");
    } else {
      userItems.forEach((e, i) => {
        console.log(`  user-item[${i}] item.id=${e.item?.id} previous_item_id(top-level)=${e.previousItemIdTopLevel ?? "(null)"}`);
      });
    }
  }

  console.log(`\n[probe-confirm-danh-bo] Log day du: ${logPath}`);
}

process.on("SIGINT", () => {
  console.log("\n[probe-confirm-danh-bo] Ngat boi nguoi dung (Ctrl+C).");
  closeSoon();
});

ws.on("error", (err) => {
  console.error("[probe-confirm-danh-bo] WS error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`[probe-confirm-danh-bo] WS dong (code=${code}, reason=${reason?.toString() || ""})`);
});
