// test/realtime-calls-api.test.mjs
//
// Giai doan 8 (xem docs/roadmap.md). Test src/integrations/realtime-calls-api.js
// bang cach GIA LAP globalThis.fetch - KHONG goi OpenAI that. Dung DUNG quy
// uoc test/tongdai-api.test.mjs da dat ra (mockFetchOnce, doi process.env
// giua cac test case).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { acceptCall, rejectCall, referCall, hangupCall } from "../src/integrations/realtime-calls-api.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

function mockFetchOnce({ status = 200, jsonBody = {}, rawText } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const text = rawText !== undefined ? rawText : JSON.stringify(jsonBody);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
  };
  return calls;
}

// ─── acceptCall ─────────────────────────────────────────────────────────────

test("acceptCall: goi DUNG URL/method, gan type:'realtime' + sessionFields vao body, tra ve CHINH body da gui", async () => {
  const calls = mockFetchOnce({ status: 200, rawText: "" });
  const sessionFields = { model: "gpt-realtime-2.1-mini", instructions: "xin chao", tools: [{ name: "get_bill" }] };

  const result = await acceptCall("call_abc123", sessionFields);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/realtime/calls/call_abc123/accept");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-test-key");
  const sentBody = JSON.parse(calls[0].opts.body);
  assert.equal(sentBody.type, "realtime");
  assert.equal(sentBody.model, "gpt-realtime-2.1-mini");
  assert.equal(sentBody.instructions, "xin chao");
  assert.deepEqual(result, sentBody, "tra ve CHINH body da gui (khong phai response cua OpenAI) - dung y ban cu, de logger phan tich prompt sau nay");
});

test("acceptCall: OpenAI tra ve loi (vd 400) - THROW (khac hangup/refer)", async () => {
  mockFetchOnce({ status: 400, rawText: "invalid session config" });
  await assert.rejects(
    () => acceptCall("call_xyz", { model: "gpt-realtime-2.1-mini" }),
    /Accept call failed 400/,
  );
});

// ─── rejectCall ─────────────────────────────────────────────────────────────

test("rejectCall: mac dinh status_code 486 (busy)", async () => {
  const calls = mockFetchOnce({ status: 200, rawText: "" });
  await rejectCall("call_abc123");
  const sentBody = JSON.parse(calls[0].opts.body);
  assert.equal(sentBody.status_code, 486);
  assert.equal(calls[0].url, "https://api.openai.com/v1/realtime/calls/call_abc123/reject");
});

test("rejectCall: status_code tuy chinh duoc truyen dung", async () => {
  const calls = mockFetchOnce({ status: 200, rawText: "" });
  await rejectCall("call_abc123", 503);
  const sentBody = JSON.parse(calls[0].opts.body);
  assert.equal(sentBody.status_code, 503);
});

test("rejectCall: OpenAI tra ve loi - THROW", async () => {
  mockFetchOnce({ status: 404, rawText: "call not found" });
  await assert.rejects(() => rejectCall("call_khong_ton_tai"), /Reject call failed 404/);
});

// ─── referCall ──────────────────────────────────────────────────────────────

test("referCall: goi NGAY (khong con setTimeout tre nhu ban cu), gui dung target_uri", async () => {
  const calls = mockFetchOnce({ status: 200, rawText: "" });
  const t0 = Date.now();
  const result = await referCall("call_abc123", "sip:200@asterisk_host");
  const elapsedMs = Date.now() - t0;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/realtime/calls/call_abc123/refer");
  const sentBody = JSON.parse(calls[0].opts.body);
  assert.equal(sentBody.target_uri, "sip:200@asterisk_host");
  assert.equal(result.success, true);
  assert.ok(elapsedMs < 500, `referCall phai goi NGAY, khong con do tre 2000ms cua ban cu (do duoc ${elapsedMs}ms)`);
});

test("referCall: that bai - KHONG throw, tra ve {success:false}", async () => {
  mockFetchOnce({ status: 500, rawText: "internal error" });
  const result = await referCall("call_abc123", "sip:200@asterisk_host");
  assert.equal(result.success, false);
  assert.equal(result.error_code, "HTTP_500");
});

test("referCall: loi mang (fetch throw) - KHONG throw ra ngoai, tra ve {success:false}", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNRESET"); };
  const result = await referCall("call_abc123", "sip:200@asterisk_host");
  assert.equal(result.success, false);
  assert.equal(result.error_code, "CONNECTION_ERROR");
});

// ─── hangupCall ─────────────────────────────────────────────────────────────

test("hangupCall: goi NGAY (khong con setTimeout tre 3000ms nhu ban cu)", async () => {
  const calls = mockFetchOnce({ status: 200, rawText: "" });
  const t0 = Date.now();
  const result = await hangupCall("call_abc123");
  const elapsedMs = Date.now() - t0;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/realtime/calls/call_abc123/hangup");
  assert.equal(result.success, true);
  assert.ok(elapsedMs < 500, `hangupCall phai goi NGAY, khong con do tre 3000ms cua ban cu (do duoc ${elapsedMs}ms)`);
});

test("hangupCall: HTTP 404 (cuoc goi da ket thuc truoc do) - coi nhu THANH CONG, dung y ban cu", async () => {
  mockFetchOnce({ status: 404, rawText: "call_id_not_found" });
  const result = await hangupCall("call_da_ket_thuc");
  assert.equal(result.success, true);
  assert.equal(result.alreadyEnded, true);
});

test("hangupCall: loi khac 404 - KHONG throw, tra ve {success:false}", async () => {
  mockFetchOnce({ status: 500, rawText: "internal error" });
  const result = await hangupCall("call_abc123");
  assert.equal(result.success, false);
  assert.equal(result.error_code, "HTTP_500");
});

test("hangupCall: loi mang (fetch throw) - KHONG throw ra ngoai, tra ve {success:false}", async () => {
  globalThis.fetch = async () => { throw new Error("timeout"); };
  const result = await hangupCall("call_abc123");
  assert.equal(result.success, false);
  assert.equal(result.error_code, "CONNECTION_ERROR");
});
