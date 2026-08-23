// test/tool-router.test.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Test src/domain/tool-router.js - HAM
// GIA cho toan bo dependency mang (tongdai-api.js) - khong goi mang that
// (moi domain module con lai da tu test rieng + doi chieu du lieu that o
// file test cua no). Trong tam o DAY: dung tool -> dung handler, VA quan
// trong nhat - callState duoc CHIA SE (cung 1 tham chieu) giua nhieu lan
// goi tool khac nhau trong CUNG 1 "cuoc goi" (day la ly do tool-router.js
// ton tai - xem ghi chu dau file nguon).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolRouter } from "../src/domain/tool-router.js";

function makeFakeDeps(overrides = {}) {
  return {
    getTrangThaiTT: async () => ({ success: true, data: [{ Ky: 8, Nam: 2026, SanLuong: 20, TongTien: 200000, TrangThaiThanhToan: "Chưa thanh toán", NgayThanhToan: null }] }),
    getSoSanhTangGiam: async () => ({ success: true, message: "ok", data: { tang_giam_percent: 3 } }),
    getThongBaoCupNuoc: async () => ({ success: true, data: { coSuCo: false, thongBao: "Bình thường." } }),
    baoSuCo: async () => ({ success: true, message: "Đã ghi nhận.", data: {} }),
    getAvailableAgents: async () => ({ success: true, data: { available_agents: 1, queue: "Q1" } }),
    ...overrides,
  };
}

test("createToolRouter: tra ve DUNG 10 ten tool xac nhan tu system-prompt.js, deu la ham", () => {
  const router = createToolRouter(makeFakeDeps());
  const expectedNames = [
    "get_bill",
    "compare_usage",
    "get_outages",
    "create_ticket",
    "get_procedure_info",
    "check_missing_docs",
    "transfer_to_agent",
    "end_call",
    "leave_callback_message",
    "wait_for_user",
  ];
  for (const name of expectedNames) {
    assert.equal(typeof router[name], "function", `thieu hoac sai kieu cho tool "${name}"`);
  }
  assert.deepEqual(Object.keys(router).sort(), expectedNames.sort());
});

test("get_bill: dinh tuyen dung toi billing.js, tra ve object (khong phai Promise/string)", async () => {
  const router = createToolRouter(makeFakeDeps());
  const out = await router.get_bill({ ma_danh_bo: "22023251775", ky: 8, nam: 2026 });
  assert.equal(out.success, true);
  assert.match(out.message, /Kỳ 8\/2026/);
});

test("compare_usage: dinh tuyen dung toi billing.js", async () => {
  const router = createToolRouter(makeFakeDeps());
  const out = await router.compare_usage({ ma_danh_bo: "22023251775" });
  assert.deepEqual(out, { success: true, message: "ok", data: { tang_giam_percent: 3 } });
});

test("get_outages: dinh tuyen dung toi outages.js", async () => {
  const router = createToolRouter(makeFakeDeps());
  const out = await router.get_outages({ ma_danh_bo: "22023251775" });
  assert.equal(out.message, "Bình thường.");
});

test("create_ticket: dinh tuyen dung toi tickets.js", async () => {
  const router = createToolRouter(makeFakeDeps());
  const out = await router.create_ticket({ ma_danh_bo: "22023251775", loai: "su_co", mo_ta: "x" });
  assert.equal(out.success, true);
});

test("transfer_to_agent: dinh tuyen dung toi call-control.js", async () => {
  const router = createToolRouter(makeFakeDeps());
  const out = await router.transfer_to_agent({ ly_do: "x" });
  assert.equal(out.action, "transfer_to_agent");
});

test("leave_callback_message: dinh tuyen dung toi call-control.js, khong truyen callState -> callerPhone rong (khong throw)", async () => {
  const calls = [];
  const router = createToolRouter(makeFakeDeps({
    baoSuCo: async (danhba, noiDung, tel) => {
      calls.push({ danhba, noiDung, tel });
      return { success: true, data: {} };
    },
  }));
  await router.leave_callback_message({ noi_dung: "x" });
  assert.equal(calls[0].tel, null, "khong truyen callState -> callerPhone rong (call-control.js chuan hoa ve null)");
});

test("end_call / wait_for_user: dinh tuyen dung, khong can tham so mang nao", async () => {
  const router = createToolRouter(makeFakeDeps());
  const outEnd = await router.end_call({ ly_do: "xong việc" });
  assert.equal(outEnd.action, "end_call");
  const outWait = await router.wait_for_user({});
  assert.equal(outWait.action, "no_reply");
});

test("get_procedure_info / check_missing_docs: dinh tuyen dung toi procedures.js (du lieu that PROCEDURES, khong can ham gia mang)", async () => {
  const router = createToolRouter(makeFakeDeps());
  const outInfo = await router.get_procedure_info({ loai_thu_tuc: "nang_doi_dong_ho" });
  assert.equal(outInfo.thuTuc, "Nâng/Dời đồng hồ nước");

  const outDocs = await router.check_missing_docs({ loai_thu_tuc: "dinh_muc_nuoc", giay_to_da_co: ["căn cước công dân"] });
  assert.equal(outDocs.ho_so_du, true);
});

// ─── Ly do tool-router.js ton tai: callState CHIA SE qua nhieu lan goi ─────

test("callState duoc CHIA SE (cung 1 tham chieu) giua cac lan goi tool khac nhau trong CUNG 1 router - xac nhan qua gate daHoiDoiTuong cua procedures.js", async () => {
  const callState = { callerPhone: "0909123456" };
  const router = createToolRouter({ ...makeFakeDeps(), callState });

  // Lan 1: get_procedure_info voi thu tuc CO phan biet doi tuong + doi_tuong
  // -> phai bi chan lai o gate "xac nhan" (chua qua buoc hoi trong CUNG callState nay).
  const lan1 = await router.get_procedure_info({ loai_thu_tuc: "lap_dat_dong_ho", doi_tuong: "ho_gia_dinh" });
  assert.equal(lan1.can_hoi_doi_tuong, true);
  assert.equal(lan1.xac_nhan_doi_tuong, "ho_gia_dinh");

  // Lan 2: GOI LAI qua CUNG router (cung callState ben trong) -> phai qua
  // gate, tra ve day du giay to - CHUNG MINH callState duoc giu xuyen suot
  // giua 2 lan goi tool khac nhau, khong bi tao moi moi lan (day chinh la
  // van de tool-router.js duoc tao ra de giai quyet).
  const lan2 = await router.get_procedure_info({ loai_thu_tuc: "lap_dat_dong_ho", doi_tuong: "ho_gia_dinh" });
  assert.equal(lan2.can_hoi_doi_tuong, undefined);
  assert.ok(lan2.so_phan_phai_doc > 0);
});

test("leave_callback_message dung DUNG callState.callerPhone khi router duoc tao voi callState co san", async () => {
  const calls = [];
  const callState = { callerPhone: "0909999888" };
  const router = createToolRouter({
    ...makeFakeDeps({
      baoSuCo: async (danhba, noiDung, tel) => {
        calls.push(tel);
        return { success: true, data: {} };
      },
    }),
    callState,
  });

  await router.leave_callback_message({ noi_dung: "Gọi lại giúp em" });
  assert.equal(calls[0], "0909999888");
});

test("resolveDanhBoRef THAT (khong phai ham gia) duoc dung ben trong - ma_danh_bo hop le -> di toi tan getTrangThaiTT", async () => {
  const calls = [];
  const router = createToolRouter(makeFakeDeps({
    getTrangThaiTT: async (danhba, ky, nam) => {
      calls.push(danhba);
      return { success: true, data: [] };
    },
  }));

  await router.get_bill({ ma_danh_bo: "  22023251775  " }); // co khoang trang - resolveDanhBoRef phai trim
  assert.equal(calls[0], "22023251775");
});

test("resolveDanhBoRef THAT: ma_danh_bo rong -> khong goi duoc API, tra ve loi DANH_BO_MISSING", async () => {
  let called = false;
  const router = createToolRouter(makeFakeDeps({
    getTrangThaiTT: async () => {
      called = true;
      return { success: true, data: [] };
    },
  }));

  const out = await router.get_bill({ ma_danh_bo: "" });
  assert.equal(called, false);
  assert.equal(out.error_code, "DANH_BO_MISSING");
});
