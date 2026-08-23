// test/tickets.test.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Test src/domain/tickets.js bang HAM
// GIA cho baoSuCo/resolveDanhBoRef - KHONG goi mang that (baoSuCo la hanh
// dong CO TAC DONG THAT, tao phieu that trong he thong CNTA - xem ghi chu
// dau tickets.js - nen o day CHI dung ham gia, tuyet doi khong goi API
// that qua tunnel nhu billing.js da lam voi getTrangThaiTT).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicketsHandlers } from "../src/domain/tickets.js";

function makeFakes({ baoSuCo, resolveValue = "22082351775" } = {}) {
  const logCalls = [];
  const resolveDanhBoRef = () => {
    if (resolveValue === null) {
      return { ok: false, error: { success: false, error_code: "DANH_BO_MISSING", message: "thieu ma danh bo" } };
    }
    return { ok: true, value: resolveValue };
  };
  const handlers = createTicketsHandlers({
    baoSuCo,
    resolveDanhBoRef,
    log: (level, msg) => logCalls.push({ level, msg }),
  });
  return { handlers, logCalls };
}

test("handleCreateTicket: resolveDanhBoRef that bai -> tra ve dung object error, khong goi baoSuCo", async () => {
  let called = false;
  const { handlers } = makeFakes({
    resolveValue: null,
    baoSuCo: async () => {
      called = true;
      return { success: true, data: {} };
    },
  });

  const out = await handlers.handleCreateTicket({ ma_danh_bo: "", loai: "su_co", mo_ta: "Rò rỉ vỉa hè" }, {});
  assert.equal(called, false);
  assert.deepEqual(out, { success: false, error_code: "DANH_BO_MISSING", message: "thieu ma danh bo" });
});

test("handleCreateTicket: co 'loai' -> ghep noi dung dang '[loai] mo_ta' gui len baoSuCo", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    baoSuCo: async (danhba, noiDung, tel) => {
      calls.push({ danhba, noiDung, tel });
      return { success: true, message: "Đã ghi nhận.", data: { maPhieu: "TK001" } };
    },
  });

  await handlers.handleCreateTicket({ ma_danh_bo: "22082351775", loai: "su_co", mo_ta: "Rò rỉ vỉa hè" }, { callerPhone: "0909123456" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].danhba, "22082351775");
  assert.equal(calls[0].noiDung, "[su_co] Rò rỉ vỉa hè");
  assert.equal(calls[0].tel, "0909123456", "phai gui kem so dien thoai nguoi goi tu callState");
});

test("handleCreateTicket: KHONG co 'loai' -> chi gui nguyen mo_ta, khong co dau ngoac vuong rong", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    baoSuCo: async (danhba, noiDung) => {
      calls.push(noiDung);
      return { success: true, data: {} };
    },
  });

  await handlers.handleCreateTicket({ ma_danh_bo: "22082351775", mo_ta: "Nước yếu" }, {});
  assert.equal(calls[0], "Nước yếu");
});

test("handleCreateTicket: callState khong co callerPhone -> tel la undefined, khong throw", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    baoSuCo: async (danhba, noiDung, tel) => {
      calls.push(tel);
      return { success: true, data: {} };
    },
  });

  await handlers.handleCreateTicket({ ma_danh_bo: "22082351775", loai: "phan_anh", mo_ta: "x" }, {});
  assert.equal(calls[0], undefined);
});

test("handleCreateTicket: baoSuCo that bai -> tra ve object loi voi message tu API", async () => {
  const { handlers } = makeFakes({
    baoSuCo: async () => ({ success: false, message: "Không tạo được phiếu, vui lòng thử lại." }),
  });

  const out = await handlers.handleCreateTicket({ ma_danh_bo: "22082351775", loai: "khan_cap", mo_ta: "Vỡ ống chính" }, {});
  assert.deepEqual(out, { success: false, message: "Không tạo được phiếu, vui lòng thử lại." });
});

test("handleCreateTicket: baoSuCo that bai, API khong tra message -> dung cau mac dinh", async () => {
  const { handlers } = makeFakes({ baoSuCo: async () => ({ success: false }) });

  const out = await handlers.handleCreateTicket({ ma_danh_bo: "22082351775", loai: "su_co", mo_ta: "x" }, {});
  assert.deepEqual(out, { success: false, message: "Không tạo được phiếu sự cố." });
});

test("handleCreateTicket: thanh cong -> tra ve dung message/data tu API", async () => {
  const { handlers } = makeFakes({
    baoSuCo: async () => ({ success: true, message: "Phiếu KH00123 đã được tạo.", data: { maPhieu: "KH00123" } }),
  });

  const out = await handlers.handleCreateTicket({ ma_danh_bo: "22082351775", loai: "khieunai", mo_ta: "x" }, {});
  assert.deepEqual(out, { success: true, message: "Phiếu KH00123 đã được tạo.", data: { maPhieu: "KH00123" } });
});

test("handleCreateTicket: thanh cong, API khong tra message -> dung cau mac dinh", async () => {
  const { handlers } = makeFakes({ baoSuCo: async () => ({ success: true, data: {} }) });

  const out = await handlers.handleCreateTicket({ ma_danh_bo: "22082351775", loai: "su_co", mo_ta: "x" }, {});
  assert.equal(out.message, "Phiếu tiếp nhận sự cố đã được ghi nhận.");
});

// ─── Du lieu THAT (khong doan/mock tuong tuong) ─────────────────────────────
//
// [23/08/2026] Goi THAT toi API test cua CNTA qua tunnel (danh ba
// "22023251775", chinh chu du an tu chay lenh, mo_ta co ghi ro "[TEST KY
// THUAT]" de phan biet voi su co that - xem hoi thoai docs/roadmap.md muc
// Giai doan 5b). Ket qua that:
//   { success: true, message: "Tiếp nhận sự cố thành công.",
//     data: [{ danhBa: "22023251775", noidungbao: "[phan_anh] [TEST...]" }] }
// KHONG phat hien lech gi voi gia dinh cu. Khac billing.js: `data` la 1
// MANG (khong phai object phang) - nhung handleCreateTicket khong dung
// toi cau truc ben trong `data`, chi forward nguyen r.data, nen khong anh
// huong.
test("[du lieu THAT 23/08/2026, danh bo 22023251775] handleCreateTicket dung dung field API that tra ve (data la MANG)", async () => {
  const { handlers } = makeFakes({
    baoSuCo: async () => ({
      success: true,
      message: "Tiếp nhận sự cố thành công.",
      data: [{ danhBa: "22023251775", noidungbao: "[phan_anh] [TEST KY THUAT - Giai doan 5b, khong phai su co that, vui long bo qua/xoa phieu nay]" }],
    }),
  });

  const out = await handlers.handleCreateTicket(
    { ma_danh_bo: "22023251775", loai: "phan_anh", mo_ta: "[TEST KY THUAT - Giai doan 5b, khong phai su co that, vui long bo qua/xoa phieu nay]" },
    { callerPhone: "0900000000" }
  );

  assert.equal(out.success, true);
  assert.equal(out.message, "Tiếp nhận sự cố thành công.");
  assert.deepEqual(out.data, [{ danhBa: "22023251775", noidungbao: "[phan_anh] [TEST KY THUAT - Giai doan 5b, khong phai su co that, vui long bo qua/xoa phieu nay]" }]);
});
