// src/session/session-ws.js
//
// Giai doan 4 (xem docs/roadmap.md). Orchestrator MONG: noi turn-signal.js
// (Giai doan 2) va turn-controller.js (Giai doan 3) voi MOT ket noi
// WebSocket that toi OpenAI Realtime API. KHONG co nghiep vu o day (Giai
// doan 5 se dua nghiep vu vao lop rieng src/call-flow/, src/domain/).
//
// QUAN TRONG - khong tu gui audio: o ban SAN XUAT, Node KHONG BAO GIO tu
// goi input_audio_buffer.append/.commit - audio den truc tiep tu SIP
// (xem "Rang buoc kien truc" trong docs/roadmap.md, xac nhan 21/08/2026).
// Module nay vi vay CHI xu ly PHAN NHAN: nhan event tho -> chuan hoa ->
// feed turn-controller. Viec day audio VAO (neu can, CHI de TEST truoc
// khi co SIP that o Giai doan 8) la trach nhiem cua script goi module
// nay (vd scripts/checkpoint-giai-doan-4.mjs), khong phai cua module nay.
//
// [21/08/2026] turn-controller.js van GIU NGUYEN nhu Giai doan 3 - response
// server tu tao (create_response:true, khong qua say()) hien CHUA duoc
// turn-controller track la active (hang doi rong -> bi bo qua co y, xem
// canh bao trong turn-controller.js). Da ban voi chu du an: KHONG doan
// truoc cach xu ly dung (huy duoc hay khong, luc nao, noi dung co phu hop
// de cat khong) - de danh lam thi nghiem that khi thuc su can (vd Giai
// doan 7 - ngat loi). Giai doan 4 chi can xac nhan luong event chay qua
// dung, chua dung isResponseActive() de quyet dinh gi ca.
//
// Tach lam 2 ham co y:
//   - createSessionWs({ws, log}): nhan mot doi tuong `ws` bat ky (chi can
//     co .send(str)) - PHAN LOGIC THUAN, test duoc bang WS gia, khong can
//     mang that. Day la ham nen dung khi viet test.
//   - connectRealtimeSession(opts): MO KET NOI THAT (can truyen vao class
//     WebSocket that, vd thu vien "ws"), gui session.update, roi goi
//     createSessionWs() ben trong. Ham nay KHONG co unit test (vi can
//     mang that) - chi duoc xac nhan qua checkpoint chay that
//     (scripts/checkpoint-giai-doan-4.mjs).
//
// [bo sung 23/08/2026, Giai doan 6a] Truoc day turn_detection ("normal" -
// semantic_vad/eagerness low/create_response:true) hardcode CO DINH, khong
// co cach doi giua chung 1 cuoc goi. Giai doan 6a (thu danh bo qua giong
// noi) can 1 mode THU HAI ("digits" - server_vad, create_response:false)
// de model KHONG tu tra loi trong luc khach doc so (xem docs/roadmap.md
// Giai doan 6a + doi chieu ban cu voi agent con - toan bo tham so
// threshold/prefix_padding_ms/silence_duration_ms la gia tri DA HIEU CHINH
// qua production that cua ban cu, khong phai so moi doan). Them
// `buildTurnDetectionConfig(mode, opts)` (ham thuan, xuat rieng de test
// khong can WS) + `setVadMode(mode, opts)` (gui session.update MOI voi
// turn_detection tuong ung - CHI doi field nay, khong dung lai
// transcription/tools da cau hinh tu dau, dung dinh dang OpenAI cho phep
// session.update TUNG PHAN). `connectRealtimeSession` cung dung LAI dung
// `buildTurnDetectionConfig("normal")` cho session.update DAU TIEN - tranh
// 2 noi dinh nghia trung lap cau hinh "normal" (1 luc xay dung, 1 luc doi
// ve) roi lech nhau qua thoi gian.
import { normalizeTurnEvent } from "./turn-signal.js";
import { createTurnController } from "./turn-controller.js";

// Xac nhan tham so tu voice_bot/src/session-ws.js ban cu (_setVadMode,
// _VAD_DIGITS_THRESHOLD/_VAD_DIGITS_SILENCE_MS) - KHONG doan:
//   - "digits": server_vad (KHONG phai semantic_vad - semantic_vad chot
//     luot theo NGU NGHIA, khach ngat hoi giua cac cum so bi coi la noi
//     xong, tao response giua chung - dung nguyen nhan sinh ra loi that
//     rtc_u2_E5eDfB96UnJE6iDWfPbRX cua ban cu). threshold 0.6/
//     prefix_padding_ms 500/silence_duration_ms 2000 la gia tri DA HIEU
//     CHINH qua nhieu cuoc goi that, khong phai mac dinh cua OpenAI.
//     create_response:false - model KHONG duoc tu tra loi, CODE
//     (danh-bo-collect.js, Giai doan 6a) tu quyet dinh khi nao noi.
//   - "normal": semantic_vad/eagerness low/create_response:true - dung
//     HET cau hinh cu (Giai doan 1-5) cua che do hoi dap tu do.
export function buildTurnDetectionConfig(mode, opts = {}) {
  if (mode === "digits") {
    return {
      type: "server_vad",
      threshold: opts.threshold ?? 0.6,
      prefix_padding_ms: opts.prefixPaddingMs ?? 500,
      silence_duration_ms: opts.silenceDurationMs ?? 2000,
      create_response: false,
      interrupt_response: true,
    };
  }
  if (mode === "normal") {
    return {
      type: "semantic_vad",
      eagerness: "low",
      create_response: true,
      interrupt_response: true,
    };
  }
  throw new Error(`session-ws: turn_detection mode khong hop le: "${mode}" (chi nhan "normal" hoac "digits")`);
}

// PHAN LOGIC THUAN - nhan `ws` (chi can co .send(string)), tra ve cac ham
// de xu ly message nhan duoc. Khong tu mo ket noi, khong tu dong gi ca.
export function createSessionWs({ ws, log = () => {} } = {}) {
  const turnController = createTurnController(ws, { log });

  // Goi ham nay moi khi nhan duoc 1 message tho tu WebSocket (dang string
  // hoac Buffer - deu duoc, se tu convert). Tra ve tin hieu DA CHUAN HOA
  // (huu ich cho test/quan sat), hoac undefined neu message khong parse
  // duoc (loi da duoc log, khong throw - 1 message hong khong duoc lam
  // sap ca phien).
  function handleRawMessage(raw) {
    let rawEvent;
    try {
      rawEvent = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch (err) {
      log("error", `session-ws: khong parse duoc message (${err.message})`);
      return undefined;
    }
    log("in", rawEvent);

    const signal = normalizeTurnEvent(rawEvent);
    turnController.handleSignal(signal);
    return signal;
  }

  // [bo sung 23/08/2026, Giai doan 6a] Doi turn_detection giua chung 1
  // cuoc goi - xem ghi chu dau file. Tra ve DUNG object turn_detection da
  // gui (tien ich cho test/log doi chieu), khong tu luu state "dang o mode
  // nao" o day (ben goi - danh-bo-collect.js - tu quan ly state do, module
  // nay CHI la "ong dan" gui session.update).
  function setVadMode(mode, opts) {
    const turn_detection = buildTurnDetectionConfig(mode, opts);
    const sessionUpdate = {
      type: "session.update",
      session: { type: "realtime", audio: { input: { turn_detection } } },
    };
    ws.send(JSON.stringify(sessionUpdate));
    log("out", sessionUpdate);
    return turn_detection;
  }

  return { turnController, handleRawMessage, setVadMode };
}

// KET NOI THAT toi OpenAI Realtime API + gui session.update dung DUNG cau
// hinh da xac nhan o Giai doan 1 cho kich ban "hoi dap tu do": semantic_vad,
// eagerness low, create_response:true (server tu tao response, code o day
// KHONG goi say() - Giai doan 4 chua co nghiep vu can dinh huong cau tra
// loi). `WebSocketImpl` phai duoc truyen vao tu ben ngoai (thu vien "ws")
// - module nay khong tu import de giu phan logic thuan (createSessionWs)
// khong phu thuoc thu vien mang, de test duoc ma khong can no.
export function connectRealtimeSession({
  apiKey,
  model,
  // [them 25/08/2026, Giai doan 8] callId: THAY THE cho `model` khi ket noi
  // qua SIP that (OpenAI Realtime Calls API) - loai tru lan nhau, chi truyen
  // DUNG 1 trong 2. Xac nhan bang doc lai voice_bot/src/session-ws.js (ban
  // cu) ham openSessionWebSocket(): URL doi thanh
  // wss://api.openai.com/v1/realtime?call_id={callId} (khac ?model=...), va
  // model/instructions/tools/reasoning/audio.output.voice/audio.input.
  // transcription DA duoc gui qua REST accept() TRUOC khi mo WS nay (xem
  // src/integrations/realtime-calls-api.js#acceptCall) - session.update gui
  // luc WS "open" o nhanh callId vi vay CHI con doi turn_detection (accept()
  // body khong co truong nay), KHONG gui lai transcription/tools/voice nhu
  // nhanh model (se de lai 2 noi dinh nghia trung lap, co the lech nhau qua
  // thoi gian).
  callId,
  transcribeModel,
  transcribeLanguage,
  transcribePrompt,
  // [Giai doan 5a, 22/08/2026] tools/toolChoice: TUY CHON, mac dinh
  // khong truyen (giu nguyen hanh vi Giai doan 4 - khong tool nao ca).
  // Xac nhan bang du lieu that o scripts/probe-tool-call.mjs: tool-call
  // KHONG phai 1 lifecycle rieng, chi la them field `tools` vao
  // session.update - khong can sua gi khac o day.
  // [Giai doan 8] O nhanh callId, tools/toolChoice KHONG duoc dung o day
  // (da gui qua REST accept() roi) - chi con y nghia cho nhanh model.
  tools,
  toolChoice,
  log = () => {},
  onSignal,
  WebSocketImpl,
} = {}) {
  if (!apiKey) throw new Error("session-ws: thieu apiKey");
  if (!model && !callId) throw new Error("session-ws: can truyen 1 trong 2: model (ket noi truc tiep, Giai doan 1-7) hoac callId (SIP that qua Realtime Calls API, Giai doan 8)");
  if (model && callId) throw new Error("session-ws: chi duoc truyen 1 trong 2 model/callId, khong duoc truyen ca hai");
  if (!WebSocketImpl) throw new Error("session-ws: thieu WebSocketImpl (truyen vao thu vien 'ws')");

  const url = callId
    ? `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`
    : `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const ws = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const sessionWs = createSessionWs({ ws, log });

  ws.on("message", (raw) => {
    const signal = sessionWs.handleRawMessage(raw);
    if (signal && onSignal) onSignal(signal);
  });

  ws.on("open", () => {
    // [them 25/08/2026, Giai doan 8] Nhanh callId (SIP that) - xem ghi chu
    // dai o tham so `callId` phia tren. Chi 1 session.update RIENG, CHI doi
    // turn_detection - dung lai buildTurnDetectionConfig("normal") giong
    // het nhanh model, tranh 2 noi dinh nghia "normal" lech nhau.
    if (callId) {
      const sessionUpdate = {
        type: "session.update",
        session: { type: "realtime", audio: { input: { turn_detection: buildTurnDetectionConfig("normal") } } },
      };
      ws.send(JSON.stringify(sessionUpdate));
      log("out", sessionUpdate);
      return;
    }

    const sessionUpdate = {
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            transcription: {
              model: transcribeModel,
              language: transcribeLanguage,
              prompt: transcribePrompt,
            },
            // [sua 23/08/2026, Giai doan 6a] Dung lai buildTurnDetectionConfig
            // thay vi hardcode rieng o day - tranh 2 noi dinh nghia "normal"
            // (o day luc xay session dau tien, o setVadMode luc doi ve) roi
            // lech nhau qua thoi gian sua doi sau nay.
            turn_detection: buildTurnDetectionConfig("normal"),
          },
        },
      },
    };
    // Chi them field khi THUC SU truyen vao - khong gui `tools: undefined`
    // (giu nguyen payload y het Giai doan 4 khi khong ai truyen tools).
    if (tools) sessionUpdate.session.tools = tools;
    if (toolChoice) sessionUpdate.session.tool_choice = toolChoice;
    ws.send(JSON.stringify(sessionUpdate));
    log("out", sessionUpdate);
  });

  return { ws, turnController: sessionWs.turnController, setVadMode: sessionWs.setVadMode };
}
