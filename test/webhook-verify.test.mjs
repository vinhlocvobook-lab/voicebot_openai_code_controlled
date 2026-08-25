// test/webhook-verify.test.mjs
//
// Giai doan 8 (xem docs/roadmap.md). Test src/webhook-verify.js bang cach
// TU KY 1 chu ky hop le voi CUNG cong thuc Svix (khong co du lieu that tu
// OpenAI de doi chieu - day la cach kiem tra chuan cho ham xac minh HMAC:
// tu tao 1 request "hop le" theo dung tai lieu, kiem tra ham chap nhan no
// VA tu choi moi bien the sai). Cong thuc (tai lieu Svix, doc lai truc
// tiep trong code khi port, khong doan): secret dang "whsec_<base64>",
// signing string "{msg_id}.{msg_timestamp}.{body}", HMAC-SHA256 roi
// base64, header dang "v1,<base64>".

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyWebhookSignature } from "../src/webhook-verify.js";

const ORIGINAL_ENV = { ...process.env };
const SECRET_BASE64 = Buffer.from("test-webhook-secret-32-bytes-ok").toString("base64");
const SECRET = `whsec_${SECRET_BASE64}`;

beforeEach(() => {
  process.env.OPENAI_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function signValid({ msgId = "msg_123", msgTimestamp = String(Math.floor(Date.now() / 1000)), body = '{"type":"realtime.call.incoming"}' } = {}) {
  const secretBytes = Buffer.from(SECRET_BASE64, "base64");
  const toSign = `${msgId}.${msgTimestamp}.${body}`;
  const sig = "v1," + crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");
  return {
    body,
    headers: { "webhook-id": msgId, "webhook-timestamp": msgTimestamp, "webhook-signature": sig },
  };
}

test("chu ky hop le, dung dinh dang Svix - CHAP NHAN", () => {
  const { body, headers } = signValid();
  assert.equal(verifyWebhookSignature(Buffer.from(body), headers), true);
});

test("chu ky hop le nhung body bi doi (giong tampering that su) - TU CHOI", () => {
  const { headers } = signValid({ body: '{"type":"realtime.call.incoming"}' });
  const tamperedBody = '{"type":"realtime.call.incoming","evil":true}';
  assert.equal(verifyWebhookSignature(Buffer.from(tamperedBody), headers), false);
});

test("chu ky sai hoan toan (vd ky bang secret khac) - TU CHOI", () => {
  const { body, headers } = signValid();
  headers["webhook-signature"] = "v1,khong-phai-chu-ky-that";
  assert.equal(verifyWebhookSignature(Buffer.from(body), headers), false);
});

test("thieu 1 trong 3 header bat buoc - TU CHOI (khong throw)", () => {
  const { body, headers } = signValid();
  const { "webhook-id": _drop, ...rest } = headers;
  assert.equal(verifyWebhookSignature(Buffer.from(body), rest), false);
});

test("timestamp qua cu (qua 5 phut, giong replay attack) - TU CHOI", () => {
  const oldTimestamp = String(Math.floor(Date.now() / 1000) - 301);
  const { body, headers } = signValid({ msgTimestamp: oldTimestamp });
  assert.equal(verifyWebhookSignature(Buffer.from(body), headers), false);
});

test("timestamp trong nguong 5 phut (vd 299s) - CHAP NHAN", () => {
  const okTimestamp = String(Math.floor(Date.now() / 1000) - 299);
  const { body, headers } = signValid({ msgTimestamp: okTimestamp });
  assert.equal(verifyWebhookSignature(Buffer.from(body), headers), true);
});

test("header co NHIEU chu ky cach nhau boi dau cach (xoay secret) - KHOP 1 cai la du", () => {
  const { body, headers } = signValid();
  headers["webhook-signature"] = `v1,chu-ky-cu-sai ${headers["webhook-signature"]}`;
  assert.equal(verifyWebhookSignature(Buffer.from(body), headers), true);
});

test("khong cau hinh OPENAI_WEBHOOK_SECRET (moi truong dev) - CHO QUA, khong throw", () => {
  delete process.env.OPENAI_WEBHOOK_SECRET;
  const { body, headers } = signValid();
  assert.equal(verifyWebhookSignature(Buffer.from(body), headers), true, "dev mode: khong co secret thi cho qua, dung y ban cu");
});

test("rawBody truyen vao dang string (khong phai Buffer) - van hoat dong dung (toString() an toan)", () => {
  const { body, headers } = signValid();
  assert.equal(verifyWebhookSignature(body, headers), true);
});
