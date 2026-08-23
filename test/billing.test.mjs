// test/billing.test.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Test src/domain/billing.js bang HAM
// GIA cho getTrangThaiTT/getSoSanhTangGiam/resolveDanhBoRef - KHONG goi
// tongdai-api.js/mang that (giong quy uoc dispatch-tool-call.test.mjs/
// turn-controller.test.mjs: factory injectable, gia lap qua tham so, khong
// mock fetch).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createBillingHandlers, docTienVN, fmtNgay, simplifyRow, prevPeriod } from "../src/domain/billing.js";

function makeFakes({ getTrangThaiTT, getSoSanhTangGiam, resolveValue = "22082351775" } = {}) {
  const logCalls = [];
  const resolveCalls = [];
  const resolveDanhBoRef = (rawArg, callState) => {
    resolveCalls.push({ rawArg, callState });
    if (resolveValue === null) {
      return { ok: false, error: { success: false, error_code: "DANH_BO_MISSING", message: "thieu ma danh bo" } };
    }
    return { ok: true, value: resolveValue };
  };
  const handlers = createBillingHandlers({
    getTrangThaiTT,
    getSoSanhTangGiam,
    resolveDanhBoRef,
    log: (level, msg) => logCalls.push({ level, msg }),
  });
  return { handlers, logCalls, resolveCalls };
}

// ─── docTienVN / fmtNgay / simplifyRow / prevPeriod (ham thuan) ──────────────

test("docTienVN: 185000 -> 'một trăm tám mươi lăm nghìn đồng' (vi du that tu ban cu)", () => {
  assert.equal(docTienVN(185000), "một trăm tám mươi lăm nghìn đồng");
});

test("docTienVN: 0 -> 'không đồng'", () => {
  assert.equal(docTienVN(0), "không đồng");
});

test("docTienVN: so co dau cham ngan cach hang nghin dang string van doc dung (khong bi TTS doc sai)", () => {
  assert.equal(docTienVN("1180266"), "một triệu một trăm tám mươi nghìn hai trăm sáu mươi sáu đồng");
});

test("fmtNgay: '2026-06-30 15:14:54' (ISO, gia dinh cu) -> '30/06/2026'", () => {
  assert.equal(fmtNgay("2026-06-30 15:14:54"), "30/06/2026");
});

test("[fix 23/08/2026, xac nhan qua goi API THAT] fmtNgay: '22/08/2026 06:42:04' (DD/MM/YYYY, dinh dang THAT API dang tra) -> '22/08/2026', cat bo gio:phut:giay", () => {
  assert.equal(fmtNgay("22/08/2026 06:42:04"), "22/08/2026");
});

test("fmtNgay: gia tri khong dung dinh dang -> tra ve nguyen si (khong throw)", () => {
  assert.equal(fmtNgay(null), null);
  assert.equal(fmtNgay("abc"), "abc");
});

test("simplifyRow: da thanh toan -> co ngay_thanh_toan; chua thanh toan -> null", () => {
  const paid = simplifyRow({ Ky: 7, Nam: 2026, SanLuong: 18, TongTien: 185000, TrangThaiThanhToan: "Đã thanh toán", NgayThanhToan: "2026-07-20 10:00:00" });
  assert.deepEqual(paid, {
    ky: "7/2026",
    san_luong_m3: 18,
    tong_tien: "một trăm tám mươi lăm nghìn đồng",
    tong_tien_so: 185000,
    trang_thai_thanh_toan: "Đã thanh toán",
    ngay_thanh_toan: "20/07/2026",
  });

  const unpaid = simplifyRow({ Ky: 8, Nam: 2026, SanLuong: 20, TongTien: 200000, TrangThaiThanhToan: "Chưa thanh toán", NgayThanhToan: null });
  assert.equal(unpaid.ngay_thanh_toan, null);
});

test("prevPeriod: thang hien tai > 1 -> lui 1 thang, giu nguyen nam", () => {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const curKy = now.getUTCMonth() + 1;
  const curNam = now.getUTCFullYear();
  const p = prevPeriod();
  if (curKy === 1) {
    assert.deepEqual(p, { ky: 12, nam: curNam - 1 }, "thang 1 phai lui ve thang 12 nam truoc");
  } else {
    assert.deepEqual(p, { ky: curKy - 1, nam: curNam });
  }
});

// ─── handleGetBill ────────────────────────────────────────────────────────

test("handleGetBill: resolveDanhBoRef that bai -> tra ve dung object error, KHONG goi getTrangThaiTT", async () => {
  let called = false;
  const { handlers } = makeFakes({
    resolveValue: null,
    getTrangThaiTT: async () => {
      called = true;
      return { success: true, data: [] };
    },
  });

  const out = await handlers.handleGetBill({ ma_danh_bo: "" }, {});
  assert.equal(called, false, "khong duoc goi API khi chua resolve duoc danh bo");
  assert.deepEqual(out, { success: false, error_code: "DANH_BO_MISSING", message: "thieu ma danh bo" });
});

test("handleGetBill: thanh cong -> message doc duoc + data da simplify, dung docTienVN", async () => {
  const row = { Ky: 7, Nam: 2026, SanLuong: 18, TongTien: 185000, TrangThaiThanhToan: "Chưa thanh toán", NgayThanhToan: null };
  const calls = [];
  const { handlers } = makeFakes({
    getTrangThaiTT: async (danhba, ky, nam) => {
      calls.push({ danhba, ky, nam });
      return { success: true, data: [row] };
    },
  });

  const out = await handlers.handleGetBill({ ma_danh_bo: "22082351775", ky: 7, nam: 2026 }, {});

  assert.equal(calls.length, 1, "khi co ky/nam va thanh cong ngay, chi goi API 1 lan");
  assert.equal(out.success, true);
  assert.equal(out.message, "Kỳ 7/2026: sản lượng 18 m³, tổng tiền một trăm tám mươi lăm nghìn đồng, chưa thanh toán.");
  assert.deepEqual(out.data, [simplifyRow(row)]);
});

test("handleGetBill: khong truyen ky/nam, ky hien tai INVOICE_NOT_FOUND -> tu dong lui 1 ky va goi lai DUNG 1 LAN", async () => {
  const calls = [];
  const { handlers, logCalls } = makeFakes({
    getTrangThaiTT: async (danhba, ky, nam) => {
      calls.push({ danhba, ky, nam });
      if (calls.length === 1) return { success: false, error_code: "INVOICE_NOT_FOUND", message: "khong co du lieu" };
      return { success: true, data: [{ Ky: ky, Nam: nam, SanLuong: 10, TongTien: 100000, TrangThaiThanhToan: "Chưa thanh toán", NgayThanhToan: null }] };
    },
  });

  const out = await handlers.handleGetBill({ ma_danh_bo: "22082351775", ky: null, nam: null }, {});

  assert.equal(calls.length, 2, "phai retry dung 1 lan");
  assert.deepEqual(calls[0], { danhba: "22082351775", ky: null, nam: null }, "lan 1 goi voi ky/nam rong (model khong truyen)");
  const p = prevPeriod();
  assert.deepEqual(calls[1], { danhba: "22082351775", ky: p.ky, nam: p.nam }, "lan 2 phai dung DUNG ky lien truoc tu prevPeriod()");
  assert.equal(out.success, true, "sau khi retry thanh cong, phai tra ve du lieu, khong phai loi");
  assert.ok(logCalls.some((c) => c.msg.includes("lui ve ky")), "phai log lai viec tu dong lui ky");
});

test("handleGetBill: CO truyen ky/nam ro rang + NOT_FOUND -> KHONG duoc tu retry (khac voi truong hop khong truyen)", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    getTrangThaiTT: async (danhba, ky, nam) => {
      calls.push({ danhba, ky, nam });
      return { success: false, error_code: "INVOICE_NOT_FOUND", message: "Không có dữ liệu cho kỳ này." };
    },
  });

  const out = await handlers.handleGetBill({ ma_danh_bo: "22082351775", ky: 3, nam: 2026 }, {});

  assert.equal(calls.length, 1, "khach da chi ro ky/nam thi KHONG tu doan lui ky khac");
  assert.deepEqual(out, { success: false, error_code: "INVOICE_NOT_FOUND", message: "Không có dữ liệu cho kỳ này." });
});

test("handleGetBill: loi khong phai NOT_FOUND (vd CUSTOMER_NOT_FOUND) -> tra ve object loi, khong retry", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    getTrangThaiTT: async (danhba, ky, nam) => {
      calls.push(1);
      return { success: false, error_code: "CUSTOMER_NOT_FOUND", message: "Không tìm thấy khách hàng." };
    },
  });

  const out = await handlers.handleGetBill({ ma_danh_bo: "22082351775" }, {});
  assert.equal(calls.length, 1);
  assert.deepEqual(out, { success: false, error_code: "CUSTOMER_NOT_FOUND", message: "Không tìm thấy khách hàng." });
});

test("handleGetBill: nhieu ky trong 1 lan tra ve -> noi cac cau bang '; ', ket thuc bang dau cham", async () => {
  const rows = [
    { Ky: 6, Nam: 2026, SanLuong: 15, TongTien: 150000, TrangThaiThanhToan: "Đã thanh toán", NgayThanhToan: "2026-07-05 09:00:00" },
    { Ky: 7, Nam: 2026, SanLuong: 18, TongTien: 185000, TrangThaiThanhToan: "Chưa thanh toán", NgayThanhToan: null },
  ];
  const { handlers } = makeFakes({ getTrangThaiTT: async () => ({ success: true, data: rows }) });

  const out = await handlers.handleGetBill({ ma_danh_bo: "22082351775", ky: 7, nam: 2026 }, {});
  assert.equal(
    out.message,
    "Kỳ 6/2026: sản lượng 15 m³, tổng tiền một trăm năm mươi nghìn đồng, đã thanh toán ngày 05/07/2026; " +
      "Kỳ 7/2026: sản lượng 18 m³, tổng tiền một trăm tám mươi lăm nghìn đồng, chưa thanh toán."
  );
});

// ─── handleCompareUsage ───────────────────────────────────────────────────

test("handleCompareUsage: resolveDanhBoRef that bai -> tra ve dung object error, khong goi getSoSanhTangGiam", async () => {
  let called = false;
  const { handlers } = makeFakes({
    resolveValue: null,
    getSoSanhTangGiam: async () => {
      called = true;
      return { success: true, data: {} };
    },
  });

  const out = await handlers.handleCompareUsage({ ma_danh_bo: "" }, {});
  assert.equal(called, false);
  assert.deepEqual(out, { success: false, error_code: "DANH_BO_MISSING", message: "thieu ma danh bo" });
});

test("handleCompareUsage: thanh cong -> tra ve dung message/data tu API", async () => {
  const { handlers } = makeFakes({
    getSoSanhTangGiam: async () => ({ success: true, message: "Tăng 5% so với kỳ trước.", data: { tang_giam_percent: 5 } }),
  });

  const out = await handlers.handleCompareUsage({ ma_danh_bo: "22082351775", ky: 7, nam: 2026 }, {});
  assert.deepEqual(out, { success: true, message: "Tăng 5% so với kỳ trước.", data: { tang_giam_percent: 5 } });
});

test("handleCompareUsage: khong truyen ky/nam, lan dau khong co du lieu -> tu dong lui 1 ky va goi lai DUNG 1 LAN", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    getSoSanhTangGiam: async (danhba, ky, nam) => {
      calls.push({ danhba, ky, nam });
      if (calls.length === 1) return { success: false, message: "Chưa có dữ liệu sản lượng cho kỳ này." };
      return { success: true, message: "ok", data: { tang_giam_percent: -2 } };
    },
  });

  const out = await handlers.handleCompareUsage({ ma_danh_bo: "22082351775" }, {});

  assert.equal(calls.length, 2);
  const p = prevPeriod();
  assert.deepEqual(calls[1], { danhba: "22082351775", ky: p.ky, nam: p.nam });
  assert.equal(out.success, true);
});

test("handleCompareUsage: sau retry van that bai -> tra ve object loi voi message tu API (khong bia message)", async () => {
  const { handlers } = makeFakes({
    getSoSanhTangGiam: async () => ({ success: false, message: "Chưa có dữ liệu sản lượng." }),
  });

  const out = await handlers.handleCompareUsage({ ma_danh_bo: "22082351775" }, {});
  assert.deepEqual(out, { success: false, message: "Chưa có dữ liệu sản lượng." });
});

// ─── resolveDanhBoRef nhan callState (hop dong voi resolveDanhBo that) ─────

test("callState duoc truyen xuyen suot toi resolveDanhBoRef (du stub khong dung) - giu dung chu ky ham cho Giai doan 6", async () => {
  const { handlers, resolveCalls } = makeFakes({ getTrangThaiTT: async () => ({ success: true, data: [] }) });
  const fakeCallState = { knownDanhBo: ["22082351775"] };

  await handlers.handleGetBill({ ma_danh_bo: "22082351775" }, fakeCallState);

  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0].callState, fakeCallState);
});

// ─── Du lieu THAT (khong doan/mock tuong tuong) ─────────────────────────────
//
// [23/08/2026] Goi THAT toi API test cua CNTA qua tunnel (danh ba
// "22023251775"), xac nhan bang lenh:
//   node --input-type=module -e '...getTrangThaiTT("22023251775", null, null)...'
// Ket qua that (dan lai nguyen van lam fixture, KHONG chinh sua) da lat ra
// 1 lech that voi gia dinh cu: NgayThanhToan tra ve dang "DD/MM/YYYY
// HH:MM:SS" ("22/08/2026 06:42:04"), khong phai ISO "YYYY-MM-DD..." nhu
// comment/gia dinh cu tu ban cu - xem fix fmtNgay o billing.js cung ngay.
const DU_LIEU_THAT_22023251775 = {
  Nam: 2026,
  Ky: 8,
  TongTien: 428413,
  SanLuong: 24,
  TrangThaiThanhToan: "Đã thanh toán",
  NgayThanhToan: "22/08/2026 06:42:04",
  DonViThanhToan: "VCB",
};

test("[du lieu THAT 23/08/2026, danh bo 22023251775] handleGetBill dung dung field API that tra ve, KHONG con doc thua gio:phut:giay", async () => {
  const { handlers } = makeFakes({
    resolveValue: "22023251775",
    getTrangThaiTT: async () => ({ success: true, data: [DU_LIEU_THAT_22023251775] }),
  });

  const out = await handlers.handleGetBill({ ma_danh_bo: "22023251775", ky: 8, nam: 2026 }, {});

  assert.equal(out.success, true);
  assert.equal(
    out.message,
    "Kỳ 8/2026: sản lượng 24 m³, tổng tiền bốn trăm hai mươi tám nghìn bốn trăm mười ba đồng, đã thanh toán ngày 22/08/2026."
  );
  assert.deepEqual(out.data, [
    {
      ky: "8/2026",
      san_luong_m3: 24,
      tong_tien: "bốn trăm hai mươi tám nghìn bốn trăm mười ba đồng",
      tong_tien_so: 428413,
      trang_thai_thanh_toan: "Đã thanh toán",
      ngay_thanh_toan: "22/08/2026", // KHONG con "22/08/2026 06:42:04"
    },
  ]);
});
