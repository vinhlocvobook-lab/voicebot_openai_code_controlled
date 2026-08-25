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

test("createToolRouter: tra ve DUNG 10 ten tool xac nhan tu system-prompt.js, cong 1 tool confirm_danh_bo (Giai doan 6b) + 1 property handleSignal (KHONG phai ten tool)", () => {
  const router = createToolRouter(makeFakeDeps());
  const expectedToolNames = [
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
    "confirm_danh_bo",
  ];
  for (const name of expectedToolNames) {
    assert.equal(typeof router[name], "function", `thieu hoac sai kieu cho tool "${name}"`);
  }
  assert.equal(typeof router.handleSignal, "function", "handleSignal (khong phai ten tool - noi tin hieu that vao danh-bo-confirm-tool-flow.js) phai co san");
  assert.deepEqual(Object.keys(router).sort(), [...expectedToolNames, "handleSignal"].sort());
});

// [sua 24/08/2026, Giai doan 6a] resolveDanhBoRef ban THAT chi tin
// callState.danhBo (xem ghi chu o cac test "resolveDanhBoRef THAT" duoi) -
// 4 test dinh tuyen duoi day KHONG nham xac nhan resolveDanhBoRef, nen gan
// san callState.danhBo de tap trung dung vao dieu dang test (dinh tuyen).
test("get_bill: dinh tuyen dung toi billing.js, tra ve object (khong phai Promise/string)", async () => {
  const router = createToolRouter({ ...makeFakeDeps(), callState: { danhBo: "22023251775" } });
  const out = await router.get_bill({ ma_danh_bo: "22023251775", ky: 8, nam: 2026 });
  assert.equal(out.success, true);
  assert.match(out.message, /Kỳ 8\/2026/);
});

test("compare_usage: dinh tuyen dung toi billing.js", async () => {
  const router = createToolRouter({ ...makeFakeDeps(), callState: { danhBo: "22023251775" } });
  const out = await router.compare_usage({ ma_danh_bo: "22023251775" });
  assert.deepEqual(out, { success: true, message: "ok", data: { tang_giam_percent: 3 } });
});

test("get_outages: dinh tuyen dung toi outages.js", async () => {
  const router = createToolRouter({ ...makeFakeDeps(), callState: { danhBo: "22023251775" } });
  const out = await router.get_outages({ ma_danh_bo: "22023251775" });
  assert.equal(out.message, "Bình thường.");
});

test("create_ticket: dinh tuyen dung toi tickets.js", async () => {
  const router = createToolRouter({ ...makeFakeDeps(), callState: { danhBo: "22023251775" } });
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

// [24/08/2026, Giai doan 6a] resolveDanhBoRef chuyen tu stub "tin thang
// rawArg" sang ban THAT "chi tin callState.danhBo, bo qua hoan toan rawArg"
// - 2 test duoi day cap nhat theo dung hop dong MOI (xem ghi chu dau
// src/domain/resolve-danh-bo-ref.js va test/resolve-danh-bo-ref.test.mjs
// cho case unit rieng).
test("resolveDanhBoRef THAT (khong phai ham gia) duoc dung ben trong - callState.danhBo da co -> " +
  "dung DUNG gia tri do, BO QUA hoan toan ma_danh_bo model truyen vao", async () => {
  const calls = [];
  const callState = { danhBo: "22023251775" };
  const router = createToolRouter({
    ...makeFakeDeps({
      getTrangThaiTT: async (danhba, ky, nam) => {
        calls.push(danhba);
        return { success: true, data: [] };
      },
    }),
    callState,
  });

  // Model truyen 1 ma SAI/khac han - phai bi bo qua, khong duoc dung tra cuu.
  await router.get_bill({ ma_danh_bo: "00000000000" });
  assert.equal(calls[0], "22023251775", "phai dung callState.danhBo, khong dung rawArg model truyen vao");
});

test("resolveDanhBoRef THAT: callState.danhBo CHUA co -> khong goi duoc API, tra ve loi DANH_BO_MISSING " +
  "(KE CA khi model tu dien 1 ma_danh_bo HOP LE - nguyen tac an toan cot loi Giai doan 6a)", async () => {
  let called = false;
  const router = createToolRouter(makeFakeDeps({
    getTrangThaiTT: async () => {
      called = true;
      return { success: true, data: [] };
    },
  }));

  const out = await router.get_bill({ ma_danh_bo: "22023251775" });
  assert.equal(called, false);
  assert.equal(out.error_code, "DANH_BO_MISSING");
});

// [25/08/2026, Giai doan 6b] confirm_danh_bo/handleSignal dinh tuyen dung
// toi danh-bo-confirm-tool-flow.js, VA quan trong nhat (giong tinh than cac
// test callState-chia-se o tren): callState duoc CHIA SE giua handleSignal()
// (nuoi tin hieu) va confirm_danh_bo() (tool-call that su) trong CUNG 1
// router - dung DUNG chuoi tin hieu that da kiem chung qua scripts/probe-
// confirm-danh-bo-tool.mjs (2 lan chay that, xem docs/roadmap.md), khong bia.
const AI_READBACK_TEXT =
  "Dạ, mã danh bộ của Quý Khách là Hai - Hai - Không - Hai - Ba - Hai - Năm - Một - Bảy - Bảy - Năm. Quý Khách xác nhận giúp em có đúng không ạ?";

test("confirm_danh_bo + handleSignal dinh tuyen dung toi danh-bo-confirm-tool-flow.js, callState.danhBo duoc ghi qua CUNG router", async () => {
  const callState = {};
  const router = createToolRouter({ ...makeFakeDeps(), callState });

  router.handleSignal({ kind: "response-started", responseId: "resp_ai1" });
  router.handleSignal({ kind: "ai-said", responseId: "resp_ai1", itemId: "item_ai1", text: AI_READBACK_TEXT });
  router.handleSignal({ kind: "response-ended", responseId: "resp_ai1", status: "completed" });
  router.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  router.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "Dạ đúng rồi." });
  router.handleSignal({ kind: "response-started", responseId: "resp_ai2" });

  const out = await router.confirm_danh_bo({ value: "22023251775" });
  assert.equal(out.success, true);
  assert.equal(callState.danhBo, "22023251775");

  // callState CHIA SE - get_bill goi NGAY SAU do (cung router) phai dung
  // duoc gia tri vua chot, khong can truyen lai gi them (dung tinh than
  // test "callState duoc CHIA SE" o tren).
  const bill = await router.get_bill({});
  assert.equal(bill.success, true);
});
