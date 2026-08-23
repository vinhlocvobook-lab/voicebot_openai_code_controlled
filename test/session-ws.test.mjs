// test/session-ws.test.mjs
//
// Giai doan 4 (xem docs/roadmap.md) - test createSessionWs() bang WS gia,
// KHONG can mang that/OPENAI_API_KEY. Module nay tu ghi ro "PHAN LOGIC
// THUAN - test duoc bang WS gia" nhung chua co file test - bo sung o day
// khi mo rong module cho Giai doan 6a (buildTurnDetectionConfig/setVadMode),
// tranh sua code khong co gi phu.
//
// [bo sung 23/08/2026, Giai doan 6a] Trong tam file nay: buildTurnDetectionConfig
// (mode "normal"/"digits") + setVadMode - phan MOI duy nhat cua session-ws.js
// o Giai doan 6a. handleRawMessage/turnController da duoc xac nhan gian
// tiep qua checkpoint-giai-doan-4.mjs/5a.mjs/5b.mjs chay that (khong lap
// lai test o day, chi thieu unit test cho phan THUAN chua tung viet).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionWs, buildTurnDetectionConfig } from "../src/session/session-ws.js";

function createMockWs() {
  const sent = [];
  return {
    sent,
    send(raw) {
      sent.push(JSON.parse(raw));
    },
  };
}

test("buildTurnDetectionConfig('normal') tra ve dung cau hinh semantic_vad da dung tu Giai doan 1-5", () => {
  assert.deepEqual(buildTurnDetectionConfig("normal"), {
    type: "semantic_vad",
    eagerness: "low",
    create_response: true,
    interrupt_response: true,
  });
});

test("buildTurnDetectionConfig('digits') tra ve dung tham so DA HIEU CHINH tu ban cu (server_vad, create_response:false)", () => {
  assert.deepEqual(buildTurnDetectionConfig("digits"), {
    type: "server_vad",
    threshold: 0.6,
    prefix_padding_ms: 500,
    silence_duration_ms: 2000,
    create_response: false,
    interrupt_response: true,
  });
});

test("buildTurnDetectionConfig('digits') nhan tham so tuy chinh qua opts (vd doi silence_duration_ms qua env o tang tren)", () => {
  const cfg = buildTurnDetectionConfig("digits", { threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 1500 });
  assert.equal(cfg.threshold, 0.5);
  assert.equal(cfg.prefix_padding_ms, 300);
  assert.equal(cfg.silence_duration_ms, 1500);
  assert.equal(cfg.create_response, false, "create_response luon false o mode digits, khong cho opts ghi de");
});

test("buildTurnDetectionConfig: mode khong hop le -> nem loi ro rang, khong tra ve undefined im lang", () => {
  assert.throws(() => buildTurnDetectionConfig("khong_ton_tai"), /mode khong hop le/);
});

test("setVadMode('digits') gui DUNG 1 session.update chi doi turn_detection, khong dung lai transcription/tools cu", () => {
  const ws = createMockWs();
  const { setVadMode } = createSessionWs({ ws });

  setVadMode("digits");

  assert.equal(ws.sent.length, 1);
  assert.deepEqual(ws.sent[0], {
    type: "session.update",
    session: {
      type: "realtime",
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.6,
            prefix_padding_ms: 500,
            silence_duration_ms: 2000,
            create_response: false,
            interrupt_response: true,
          },
        },
      },
    },
  });
});

test("setVadMode('normal') doi VAD ve dung cau hinh cu, va tra ve DUNG turn_detection vua gui (de log/doi chieu)", () => {
  const ws = createMockWs();
  const { setVadMode } = createSessionWs({ ws });

  const returned = setVadMode("normal");

  assert.deepEqual(returned, {
    type: "semantic_vad",
    eagerness: "low",
    create_response: true,
    interrupt_response: true,
  });
  assert.deepEqual(ws.sent[0].session.audio.input.turn_detection, returned);
});

test("setVadMode duoc log('out') dung nhu moi lan gui khac - checkpoint script tee() duoc, khong can sua rieng", () => {
  const ws = createMockWs();
  const logCalls = [];
  const { setVadMode } = createSessionWs({ ws, log: (level, payload) => logCalls.push({ level, payload }) });

  setVadMode("digits");

  const outLog = logCalls.find((c) => c.level === "out");
  assert.ok(outLog, "phai co dong log('out') cho session.update vua gui");
  assert.equal(outLog.payload.type, "session.update");
});

test("goi setVadMode nhieu lan lien tiep (digits -> normal -> digits) - moi lan gui dung 1 session.update rieng, khong tich luy/lan nhau", () => {
  const ws = createMockWs();
  const { setVadMode } = createSessionWs({ ws });

  setVadMode("digits");
  setVadMode("normal");
  setVadMode("digits");

  assert.equal(ws.sent.length, 3);
  assert.equal(ws.sent[0].session.audio.input.turn_detection.type, "server_vad");
  assert.equal(ws.sent[1].session.audio.input.turn_detection.type, "semantic_vad");
  assert.equal(ws.sent[2].session.audio.input.turn_detection.type, "server_vad");
});
