// test/session-ws.test.mjs
//
// Giai doan 4 (xem docs/roadmap.md). Chi test createSessionWs() - phan
// LOGIC THUAN (nhan message tho -> chuan hoa -> feed turn-controller).
// KHONG test connectRealtimeSession() o day - ham do can ket noi mang
// that toi OpenAI, duoc xac nhan rieng qua checkpoint chay that
// (scripts/checkpoint-giai-doan-4.mjs), khong phai bang node:test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionWs } from "../src/session/session-ws.js";

function createMockWs() {
  const sent = [];
  return {
    sent,
    send(raw) {
      sent.push(JSON.parse(raw));
    },
  };
}

test("handleRawMessage: parse event tho, tra ve tin hieu da chuan hoa dung nhu turn-signal.js", () => {
  const ws = createMockWs();
  const { handleRawMessage } = createSessionWs({ ws });

  const signal = handleRawMessage(
    JSON.stringify({ type: "input_audio_buffer.speech_started", audio_start_ms: 1234 })
  );

  assert.deepEqual(signal, { kind: "speech-started", atMs: 1234 });
});

test("handleRawMessage: nhan Buffer (nhu ws that gui ve) chu khong chi string", () => {
  const ws = createMockWs();
  const { handleRawMessage } = createSessionWs({ ws });

  const raw = Buffer.from(JSON.stringify({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 5678 }));
  const signal = handleRawMessage(raw);

  assert.deepEqual(signal, { kind: "speech-stopped", atMs: 5678 });
});

test("handleRawMessage: JSON hong -> tra ve undefined, KHONG throw, khong lam sap phien", () => {
  const ws = createMockWs();
  const errors = [];
  const { handleRawMessage } = createSessionWs({
    ws,
    log: (level, msg) => {
      if (level === "error") errors.push(msg);
    },
  });

  const signal = handleRawMessage("{ day khong phai json hop le");

  assert.equal(signal, undefined);
  assert.equal(errors.length, 1, "phai log 1 loi");
});

test("handleRawMessage: event khong quen -> chuan hoa thanh ignored, khong crash", () => {
  const ws = createMockWs();
  const { handleRawMessage } = createSessionWs({ ws });

  const signal = handleRawMessage(JSON.stringify({ type: "output_audio_buffer.started" }));

  assert.deepEqual(signal, { kind: "ignored", rawType: "output_audio_buffer.started" });
});

test("handleRawMessage: feed dung vao turn-controller - say() truoc, response.created khop -> active", () => {
  const ws = createMockWs();
  const { turnController, handleRawMessage } = createSessionWs({ ws });

  assert.equal(turnController.isResponseActive(), false);
  turnController.say({ mode: "auto" });
  assert.equal(turnController.isResponseActive(), true);

  handleRawMessage(JSON.stringify({ type: "response.created", response: { id: "resp_XYZ" } }));
  assert.equal(turnController.isResponseActive(), true, "van active, da co id that");

  handleRawMessage(JSON.stringify({ type: "response.done", response: { id: "resp_XYZ", status: "completed" } }));
  assert.equal(turnController.isResponseActive(), false, "ket thuc sach, tro ve idle");
});

test("handleRawMessage: response.created MA KHONG QUA say() (server tu tao, create_response:true) - khong crash, turnController tu bo qua co y (hanh vi da biet tu Giai doan 3, chua doi o Giai doan 4)", () => {
  const ws = createMockWs();
  const warnings = [];
  const { turnController, handleRawMessage } = createSessionWs({
    ws,
    log: (level, msg) => {
      if (level === "warn") warnings.push(msg);
    },
  });

  // Khong goi say() truoc - mo phong dung kich ban Giai doan 4: server tu
  // tao response vi create_response:true, code khong chu dong goi.
  const signal = handleRawMessage(JSON.stringify({ type: "response.created", response: { id: "resp_AUTO" } }));

  assert.deepEqual(signal, { kind: "response-started", responseId: "resp_AUTO" });
  assert.equal(warnings.length, 1, "turn-controller phai canh bao hang doi rong (hanh vi da biet, xem ghi chu dau file)");
  assert.equal(
    turnController.isResponseActive(),
    false,
    "CHUA duoc track la active - day la gioi han da biet cua Giai doan 4, khong phai bug moi"
  );
});

test("handleRawMessage: nhieu message lien tiep dung thu tu, khong lam rot event nao", () => {
  const ws = createMockWs();
  const seen = [];
  const { handleRawMessage } = createSessionWs({ ws });

  const rawEvents = [
    { type: "session.updated" },
    { type: "input_audio_buffer.speech_started", audio_start_ms: 0 },
    { type: "input_audio_buffer.speech_stopped", audio_end_ms: 2000 },
    { type: "input_audio_buffer.committed", item_id: "item_1", previous_item_id: null },
    { type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "Xin chao" },
    { type: "response.created", response: { id: "resp_1" } },
    { type: "response.done", response: { id: "resp_1", status: "completed" } },
  ];

  for (const e of rawEvents) {
    seen.push(handleRawMessage(JSON.stringify(e)));
  }

  assert.equal(seen.length, rawEvents.length);
  assert.deepEqual(
    seen.map((s) => s.kind),
    ["ignored", "speech-started", "speech-stopped", "buffer-committed", "transcript-ready", "response-started", "response-ended"]
  );
});
