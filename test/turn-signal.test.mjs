// test/turn-signal.test.mjs
//
// Giai doan 2: test normalizeTurnEvent() bang cach REPLAY fixture (khong
// goi OpenAI that). Fixture o dang giong het log .jsonl that cua
// scripts/probe-realtime.mjs (Giai doan 1): moi dong 1 event, co field
// `direction` ("in" | "out") va `event` (nguyen van goi tin). Chi cac
// dong `direction:"in"` moi di qua normalizeTurnEvent - dong "out" la
// nhung gi TA gui di, khong phai tin hieu tu server can chuan hoa.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTurnEvent } from "../src/session/turn-signal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  const filePath = path.join(__dirname, "fixtures", name);
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  return lines.map((line) => JSON.parse(line));
}

test("cac event tho don le duoc chuan hoa dung field", () => {
  assert.deepEqual(
    normalizeTurnEvent({ type: "input_audio_buffer.speech_started", audio_start_ms: 1164 }),
    { kind: "speech-started", atMs: 1164 },
  );

  assert.deepEqual(
    normalizeTurnEvent({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 3260 }),
    { kind: "speech-stopped", atMs: 3260 },
  );

  assert.deepEqual(
    normalizeTurnEvent({ type: "input_audio_buffer.committed", item_id: "item_1", previous_item_id: null }),
    { kind: "buffer-committed", itemId: "item_1", previousItemId: null },
  );

  assert.deepEqual(
    normalizeTurnEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_1",
      transcript: "Hai hai",
    }),
    { kind: "transcript-ready", itemId: "item_1", text: "Hai hai" },
  );

  assert.deepEqual(
    normalizeTurnEvent({ type: "response.created", response: { id: "resp_1" } }),
    { kind: "response-started", responseId: "resp_1" },
  );

  assert.deepEqual(
    normalizeTurnEvent({ type: "response.done", response: { id: "resp_1", status: "cancelled" } }),
    { kind: "response-ended", responseId: "resp_1", status: "cancelled" },
  );

  assert.deepEqual(
    normalizeTurnEvent({ type: "error", error: { message: "loi mau" } }),
    { kind: "error", raw: { message: "loi mau" } },
  );
});

test("event chua biet toi roi vao nhanh ignored, khong crash", () => {
  assert.deepEqual(
    normalizeTurnEvent({ type: "session.created" }),
    { kind: "ignored", rawType: "session.created" },
  );
  assert.deepEqual(normalizeTurnEvent(null), { kind: "ignored", rawType: undefined });
  assert.deepEqual(normalizeTurnEvent({}), { kind: "ignored", rawType: undefined });
});

test("buffer-committed giu previousItemId de xau chuoi nhieu manh cung 1 luot (Giai doan 1: VAD tach luot noi)", () => {
  const raw = loadFixture("turn-signal-events.jsonl");
  const committedSignals = raw
    .filter((row) => row.direction === "in" && row.event.type === "input_audio_buffer.committed")
    .map((row) => normalizeTurnEvent(row.event));

  assert.equal(committedSignals.length, 2);
  assert.deepEqual(committedSignals[0], { kind: "buffer-committed", itemId: "item_AAA111", previousItemId: null });
  assert.deepEqual(committedSignals[1], { kind: "buffer-committed", itemId: "item_BBB222", previousItemId: "item_AAA111" });
});

test("replay toan bo fixture: dem dung so luong tin hieu theo kind, khong lam rot event nao", () => {
  const raw = loadFixture("turn-signal-events.jsonl");
  const incoming = raw.filter((row) => row.direction === "in");
  const signals = incoming.map((row) => normalizeTurnEvent(row.event));

  assert.equal(signals.length, incoming.length, "moi event 'in' phai cho ra dung 1 tin hieu, khong duoc rot");

  const tally = {};
  for (const s of signals) tally[s.kind] = (tally[s.kind] ?? 0) + 1;

  assert.deepEqual(tally, {
    ignored: 2, // session.created, session.updated
    "speech-started": 3, // 2 luot binh thuong + 1 luot barge-in truoc khi response bi cancel
    "speech-stopped": 2,
    "buffer-committed": 2,
    "transcript-ready": 2,
    "response-started": 2,
    "response-ended": 2,
    error: 1,
  });
});

test("ghep transcript qua nhieu manh (mo phong logic Giai doan 6 se can) cho ra dung cau goc", () => {
  const raw = loadFixture("turn-signal-events.jsonl");
  const transcripts = raw
    .filter((row) => row.direction === "in" && row.event.type === "conversation.item.input_audio_transcription.completed")
    .map((row) => normalizeTurnEvent(row.event).text);

  assert.equal(transcripts.join(" "), "Hai hai Khong tam");
});
