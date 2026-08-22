// test/calllog-api.test.mjs
//
// Giai doan 5 (xem docs/roadmap.md). Test src/integrations/calllog-api.js
// bang cach gia lap globalThis.fetch - KHONG goi API that. Trong tam:
// xac nhan nguyen tac "loi ghi log khong duoc lam sap cuoc goi" - moi ham
// khong bao gio throw, ke ca khi fetch loi/tra JSON hong.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isLogApiEnabled,
  insertCallStub,
  finalizeCallLog,
  insertTicket,
  getDanhBoHistory,
  closeDb,
} from "../src/integrations/calllog-api.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.LOG_API_BASE = "http://test-log-api.local";
  process.env.LOG_API_KEY = "test-key";
  process.env.LOG_API_INSECURE_TLS = "false";
  process.env.LOG_API_TIMEOUT_MS = "15000";
  process.env.VOICEBOT_LOG_FOLDER_ON_API_SERVER = "";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

function mockFetchOnce({ status = 200, jsonBody, rawText } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const text = rawText !== undefined ? rawText : JSON.stringify(jsonBody);
    return { status, text: async () => text };
  };
  return calls;
}

test("isLogApiEnabled: false khi LOG_API_BASE trong, true khi da cau hinh", () => {
  process.env.LOG_API_BASE = "";
  assert.equal(isLogApiEnabled(), false);
  process.env.LOG_API_BASE = "http://test-log-api.local";
  assert.equal(isLogApiEnabled(), true);
});

test("insertCallStub: LOG_API_BASE trong -> khong goi fetch, khong throw", async () => {
  process.env.LOG_API_BASE = "";
  const calls = mockFetchOnce({ jsonBody: { success: true } });

  await assert.doesNotReject(() => insertCallStub({ callId: "call_1" }));
  assert.equal(calls.length, 0);
});

test("insertCallStub: khong co callId -> khong goi fetch, khong throw", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true } });
  await assert.doesNotReject(() => insertCallStub({}));
  assert.equal(calls.length, 0);
});

test("insertCallStub: goi dung POST /calls voi body dung hinh dang", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true } });

  await insertCallStub({ callId: "call_1", customerTel: "0909123456", uniqueid: "u1" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, "POST");
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/calls");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.callId, "call_1");
  assert.equal(body.customerTel, "0909123456");
  assert.equal(body.recordPath, null, "field khong truyen phai mac dinh null, khong phai undefined bi rot");
});

test("finalizeCallLog: khong co document.meta.callId -> khong goi fetch, khong throw", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true } });
  await assert.doesNotReject(() => finalizeCallLog({ meta: {} }));
  assert.equal(calls.length, 0);
});

test("finalizeCallLog: goi PUT /calls/{callId} kem json_log_filepath", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true, data: { tool_calls_written: 2, tool_calls_total: 2 } } });

  await finalizeCallLog({ meta: { callId: "call_9" }, stats: {} }, "/tmp/call_9.json");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, "PUT");
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/calls/call_9");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.json_log_filepath, "/tmp/call_9.json");
  assert.equal(body.log_file_root_folder, undefined, "khong duoc gui field nay khi thieu relativeLogPath/env");
});

test("finalizeCallLog: co VOICEBOT_LOG_FOLDER_ON_API_SERVER + relativeLogPath -> gui kem 2 field", async () => {
  process.env.VOICEBOT_LOG_FOLDER_ON_API_SERVER = "/data/voicebot-logs";
  const calls = mockFetchOnce({ jsonBody: { success: true, data: {} } });

  await finalizeCallLog({ meta: { callId: "call_9" } }, "/tmp/call_9.json", "2026/08/22/call_9.json");

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.log_file_root_folder, "/data/voicebot-logs");
  assert.equal(body.log_file_relative_path, "2026/08/22/call_9.json");
});

test("insertTicket: goi dung POST /tickets voi body dung hinh dang", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true } });

  await insertTicket({ callId: "call_1", args: { ma_danh_bo: "22082351775" }, output: { success: true } });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/tickets");
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.args, { ma_danh_bo: "22082351775" });
});

test("getDanhBoHistory: thanh cong -> tra ve mang candidates", async () => {
  mockFetchOnce({ jsonBody: { success: true, data: { candidates: [{ ma_danh_bo: "22082351775", outcome: "confirmed" }] } } });

  const r = await getDanhBoHistory("0909123456");

  assert.equal(r.length, 1);
  assert.equal(r[0].ma_danh_bo, "22082351775");
});

test("getDanhBoHistory: khong co tel -> tra ve mang rong, khong goi fetch", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true, data: { candidates: [] } } });
  const r = await getDanhBoHistory(null);
  assert.deepEqual(r, []);
  assert.equal(calls.length, 0);
});

test("getDanhBoHistory: fetch loi mang -> tra ve mang rong, KHONG throw (loi ghi/doc log khong duoc lam sap cuoc goi)", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };

  const r = await getDanhBoHistory("0909123456");

  assert.deepEqual(r, []);
});

test("insertCallStub: fetch loi mang -> KHONG throw (nguyen tac fire-and-forget an toan)", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.doesNotReject(() => insertCallStub({ callId: "call_1" }));
});

test("finalizeCallLog: JSON tra ve hong -> KHONG throw", async () => {
  mockFetchOnce({ status: 200, rawText: "<html>502</html>" });
  await assert.doesNotReject(() => finalizeCallLog({ meta: { callId: "call_1" } }));
});

test("insertTicket: khong co callId -> khong goi fetch, khong throw", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true } });
  await assert.doesNotReject(() => insertTicket({}));
  assert.equal(calls.length, 0);
});

test("closeDb: no-op, resolve binh thuong khong loi", async () => {
  await assert.doesNotReject(() => closeDb());
});
