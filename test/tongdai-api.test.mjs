// test/tongdai-api.test.mjs
//
// Giai doan 5 (xem docs/roadmap.md). Test src/integrations/tongdai-api.js
// bang cach GIA LAP globalThis.fetch - KHONG goi API that. Dung dung quy
// uoc test da co san o ban cu (api.js chi dung undici.fetch khi THUC SU
// can dispatcher rieng, con lai dung fetch toan cuc - de test mock duoc).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getThongTinKhachHang,
  verifyCustomer,
  getTienNuoc,
  getSoSanhTangGiam,
  baoSuCo,
  getTrangThaiTT,
} from "../src/integrations/tongdai-api.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.TONGDAI_API_BASE = "http://test-api.local/api.php";
  process.env.TONGDAI_API_KEY = "";
  process.env.TONGDAI_API_INSECURE_TLS = "false";
  process.env.TONGDAI_API_TIMEOUT_MS = "15000";
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
    return {
      status,
      text: async () => text,
    };
  };
  return calls;
}

test("getTienNuoc: build dung URL + query string, chi gom tham so co gia tri", async () => {
  const calls = mockFetchOnce({
    jsonBody: { success: true, data: { success: true, data: [{ Ky: 7, Nam: 2026, TongTien: 100000 }] } },
  });

  await getTienNuoc("22082351775", 7, null);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "http://test-api.local/api.php/tien-nuoc");
  assert.equal(url.searchParams.get("danhba"), "22082351775");
  assert.equal(url.searchParams.get("ky"), "7");
  assert.equal(url.searchParams.has("nam"), false, "nam=null khong duoc dua vao query string");
});

test("callApi: unwrap dung lop trong (data.success) khi co", async () => {
  mockFetchOnce({
    jsonBody: { success: true, http_code: 200, data: { success: true, data: [{ Ky: 7, Nam: 2026 }] } },
  });

  const r = await getTienNuoc("22082351775");

  assert.equal(r.success, true);
  assert.deepEqual(r.data, [{ Ky: 7, Nam: 2026 }]);
});

test("callApi: outer.success=false kem outer.error -> gan vao inner.message neu inner chua co message", async () => {
  mockFetchOnce({
    jsonBody: { success: false, error: "Unauthorized", data: null },
  });

  const r = await getTienNuoc("22082351775");

  assert.equal(r.success, false);
  assert.equal(r.message, "Unauthorized");
});

test("callApi: JSON hong -> INVALID_RESPONSE, khong throw", async () => {
  mockFetchOnce({ status: 200, rawText: "<html>loi 502</html>" });

  const r = await getTienNuoc("22082351775");

  assert.equal(r.success, false);
  assert.equal(r.error_code, "INVALID_RESPONSE");
});

test("callApi: fetch nem loi mang -> CONNECTION_ERROR, khong throw ra ngoai", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };

  const r = await getTienNuoc("22082351775");

  assert.equal(r.success, false);
  assert.equal(r.error_code, "CONNECTION_ERROR");
});

test("callApi: AbortError (timeout) -> error_code TIMEOUT", async () => {
  globalThis.fetch = async () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    throw err;
  };

  const r = await getTienNuoc("22082351775");

  assert.equal(r.success, false);
  assert.equal(r.error_code, "TIMEOUT");
});

test("verifyCustomer: co danh sach khach hang -> valid true, lay customer dau tien", async () => {
  mockFetchOnce({
    jsonBody: { success: true, data: { success: true, data: [{ danhBa: "22082351775", hoTen: "Nguyen Van A" }] } },
  });

  const r = await verifyCustomer("22082351775");

  assert.equal(r.valid, true);
  assert.equal(r.customer.hoTen, "Nguyen Van A");
});

test("verifyCustomer: khong co du lieu -> valid false", async () => {
  mockFetchOnce({
    jsonBody: { success: true, data: { success: true, data: [] } },
  });

  const r = await verifyCustomer("22082351775");

  assert.equal(r.valid, false);
});

test("baoSuCo: gui POST dung method + body dung hinh dang", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true, data: { success: true } } });

  await baoSuCo("22082351775", "Rò rỉ vỉa hè", "0909123456");

  assert.equal(calls[0].opts.method, "POST");
  const sentBody = JSON.parse(calls[0].opts.body);
  assert.deepEqual(sentBody, { danhba: "22082351775", noidung: "Rò rỉ vỉa hè", tel: "0909123456" });
});

test("callApi: co TONGDAI_API_KEY -> gui header Authorization Bearer", async () => {
  process.env.TONGDAI_API_KEY = "secret-key-123";
  const calls = mockFetchOnce({ jsonBody: { success: true, data: { success: true, data: [] } } });

  await getThongTinKhachHang("22082351775");

  assert.equal(calls[0].opts.headers["Authorization"], "Bearer secret-key-123");
});

test("callApi: KHONG co TONGDAI_API_KEY -> khong gui header Authorization", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true, data: { success: true, data: [] } } });

  await getThongTinKhachHang("22082351775");

  assert.equal(calls[0].opts.headers["Authorization"], undefined);
});

test("getSoSanhTangGiam: goi dung duong dan endpoint", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true, data: { success: true, data: {} } } });

  await getSoSanhTangGiam("22082351775", 7, 2026);

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api.php/so-sanh-tang-giam");
});

test("getTrangThaiTT: goi dung duong dan endpoint", async () => {
  const calls = mockFetchOnce({ jsonBody: { success: true, data: { success: true, data: [] } } });

  await getTrangThaiTT("22082351775");

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api.php/trang-thai-thanh-toan");
});
