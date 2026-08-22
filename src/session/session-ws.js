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

import { normalizeTurnEvent } from "./turn-signal.js";
import { createTurnController } from "./turn-controller.js";

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

  return { turnController, handleRawMessage };
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
  transcribeModel,
  transcribeLanguage,
  transcribePrompt,
  log = () => {},
  onSignal,
  WebSocketImpl,
} = {}) {
  if (!apiKey) throw new Error("session-ws: thieu apiKey");
  if (!model) throw new Error("session-ws: thieu model");
  if (!WebSocketImpl) throw new Error("session-ws: thieu WebSocketImpl (truyen vao thu vien 'ws')");

  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const ws = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const sessionWs = createSessionWs({ ws, log });

  ws.on("message", (raw) => {
    const signal = sessionWs.handleRawMessage(raw);
    if (signal && onSignal) onSignal(signal);
  });

  ws.on("open", () => {
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
            turn_detection: {
              type: "semantic_vad",
              eagerness: "low",
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    };
    ws.send(JSON.stringify(sessionUpdate));
    log("out", sessionUpdate);
  });

  return { ws, turnController: sessionWs.turnController };
}
