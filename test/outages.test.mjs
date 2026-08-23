// test/outages.test.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Test src/domain/outages.js bang HAM
// GIA cho getThongBaoCupNuoc/resolveDanhBoRef - KHONG goi mang that (giong
// quy uoc test/billing.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutagesHandlers } from "../src/domain/outages.js";

function makeFakes({ getThongBaoCupNuoc, resolveValue = "22082351775" } = {}) {
  const logCalls = [];
  const resolveDanhBoRef = (rawArg) => {
    if (resolveValue === null) {
      return { ok: false, error: { success: false, error_code: "DANH_BO_MISSING", message: "thieu ma danh bo" } };
    }
    return { ok: true, value: resolveValue };
  };
  const handlers = createOutagesHandlers({
    getThongBaoCupNuoc,
    resolveDanhBoRef,
    log: (level, msg) => logCalls.push({ level, msg }),
  });
  return { handlers, logCalls };
}

test("handleGetOutages: resolveDanhBoRef that bai -> tra ve dung object error, khong goi API", async () => {
  let called = false;
  const { handlers } = makeFakes({
    resolveValue: null,
    getThongBaoCupNuoc: async () => {
      called = true;
      return { success: true, data: {} };
    },
  });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "" }, {});
  assert.equal(called, false);
  assert.deepEqual(out, { success: false, error_code: "DANH_BO_MISSING", message: "thieu ma danh bo" });
});

test("handleGetOutages: API tra success:false -> tra ve object loi voi message tu API", async () => {
  const { handlers } = makeFakes({
    getThongBaoCupNuoc: async () => ({ success: false, message: "Không tra cứu được." }),
  });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "22082351775" }, {});
  assert.deepEqual(out, { success: false, message: "Không tra cứu được." });
});

test("handleGetOutages: khong co su co (coSuCo falsy) -> van success:true, doc thongBao", async () => {
  const { handlers } = makeFakes({
    getThongBaoCupNuoc: async () => ({ success: true, data: { coSuCo: false, thongBao: "Khu vực bình thường, không có sự cố." } }),
  });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "22082351775" }, {});
  assert.equal(out.success, true);
  assert.equal(out.message, "Khu vực bình thường, không có sự cố.");
});

test("handleGetOutages: khong co su co, API khong tra thongBao -> dung cau mac dinh", async () => {
  const { handlers } = makeFakes({
    getThongBaoCupNuoc: async () => ({ success: true, data: { coSuCo: false } }),
  });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "22082351775" }, {});
  assert.equal(out.message, "Khách hàng không nằm trong vùng bị sự cố.");
});

test("handleGetOutages: CO su co + co thoiGianDuKienHoanThanh -> message noi them 'Dự kiến hoàn thành'", async () => {
  const { handlers } = makeFakes({
    getThongBaoCupNuoc: async () => ({
      success: true,
      data: { coSuCo: true, thongBao: "Đang bảo trì đường ống chính.", thoiGianDuKienHoanThanh: "18h00 ngày 24/08/2026" },
    }),
  });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "22082351775" }, {});
  assert.equal(out.message, "Đang bảo trì đường ống chính. Dự kiến hoàn thành: 18h00 ngày 24/08/2026.");
});

test("handleGetOutages: CO su co nhung KHONG co thoiGianDuKienHoanThanh -> khong them cau du kien", async () => {
  const { handlers } = makeFakes({
    getThongBaoCupNuoc: async () => ({ success: true, data: { coSuCo: true, thongBao: "Đang bảo trì." } }),
  });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "22082351775" }, {});
  assert.equal(out.message, "Đang bảo trì.");
});

test("handleGetOutages: CO su co, API khong tra thongBao -> dung cau mac dinh", async () => {
  const { handlers } = makeFakes({
    getThongBaoCupNuoc: async () => ({ success: true, data: { coSuCo: true } }),
  });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "22082351775" }, {});
  assert.equal(out.message, "Khu vực của Quý khách đang bị sự cố cấp nước.");
});

test("handleGetOutages: data tra ve nguyen d (khong bi loc bot field)", async () => {
  const d = { coSuCo: true, thongBao: "x", thoiGianDuKienHoanThanh: "y", maKhuVuc: "KV07" };
  const { handlers } = makeFakes({ getThongBaoCupNuoc: async () => ({ success: true, data: d }) });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "22082351775" }, {});
  assert.deepEqual(out.data, d);
});

// ─── Du lieu THAT (khong doan/mock tuong tuong) ─────────────────────────────
//
// [23/08/2026] Goi THAT toi API test cua CNTA qua tunnel (danh ba
// "22023251775", chinh chu du an tu chay lenh - xem hoi thoai
// docs/roadmap.md muc Giai doan 5b), xac nhan getThongBaoCupNuoc tra ve:
//   { coSuCo: false, thongBao: "Khách hàng không nằm trong vùng bị sự cố.",
//     thoiGianDuKienHoanThanh: "" }
// KHONG phat hien lech gi voi gia dinh cu (khac voi billing.js - xem fix
// fmtNgay) - thoiGianDuKienHoanThanh la CHUOI RONG (khong phai null) khi
// khong ap dung, van falsy nen logic hien tai xu ly dung, khong can sua.
test("[du lieu THAT 23/08/2026, danh bo 22023251775] handleGetOutages dung dung field API that tra ve", async () => {
  const { handlers } = makeFakes({
    getThongBaoCupNuoc: async () => ({
      success: true,
      message: "Lấy thông tin cúp nước thành công.",
      data: { coSuCo: false, thongBao: "Khách hàng không nằm trong vùng bị sự cố.", thoiGianDuKienHoanThanh: "" },
    }),
  });

  const out = await handlers.handleGetOutages({ ma_danh_bo: "22023251775" }, {});
  assert.deepEqual(out, {
    success: true,
    message: "Khách hàng không nằm trong vùng bị sự cố.",
    data: { coSuCo: false, thongBao: "Khách hàng không nằm trong vùng bị sự cố.", thoiGianDuKienHoanThanh: "" },
  });
});
