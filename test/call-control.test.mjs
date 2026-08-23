// test/call-control.test.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Test src/domain/call-control.js bang
// HAM GIA cho getAvailableAgents/baoSuCo - khong goi mang that (giong quy
// uoc cac file domain truoc). transferTimeoutMs duoc chinh nho lai o cac
// test can cho timeout, tranh cho that 4.5s.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCallControlHandlers } from "../src/domain/call-control.js";

function makeFakes({ getAvailableAgents, baoSuCo, transferTimeoutMs } = {}) {
  const logCalls = [];
  const handlers = createCallControlHandlers({
    getAvailableAgents,
    baoSuCo,
    log: (level, msg) => logCalls.push({ level, msg }),
    ...(transferTimeoutMs !== undefined ? { transferTimeoutMs } : {}),
  });
  return { handlers, logCalls };
}

// ─── handleTransferToAgent ──────────────────────────────────────────────────

test("handleTransferToAgent: co agent ranh (available_agents > 0) -> success:true, action:transfer_to_agent", async () => {
  const { handlers } = makeFakes({
    getAvailableAgents: async () => ({ success: true, data: { available_agents: 2, queue: "GroupDay5" } }),
  });

  const out = await handlers.handleTransferToAgent({ ly_do: "Khách yêu cầu gặp người thật" });
  assert.deepEqual(out, {
    success: true,
    action: "transfer_to_agent",
    doc_cho_khach: "Dạ, em xin phép chuyển máy cho tổng đài viên hỗ trợ Quý Khách ngay ạ.",
    message: "Đang chuyển máy cho tổng đài viên, Quý khách vui lòng chờ trong giây lát.",
    ly_do: "Khách yêu cầu gặp người thật",
    available_agents: 2,
    queue: "GroupDay5",
  });
});

test("handleTransferToAgent: KHONG co agent ranh (available_agents = 0) -> success:false, action:leave_message", async () => {
  const { handlers } = makeFakes({
    getAvailableAgents: async () => ({ success: true, data: { available_agents: 0, queue: "GroupDay5" } }),
  });

  const out = await handlers.handleTransferToAgent({ ly_do: "x" });
  assert.equal(out.success, false);
  assert.equal(out.action, "leave_message");
  assert.match(out.doc_cho_khach, /chưa có tổng đài viên nào rảnh/);
});

test("handleTransferToAgent: getAvailableAgents nem loi -> BAT LAI, coi nhu khong co agent (khong throw ra ngoai)", async () => {
  const { handlers, logCalls } = makeFakes({
    getAvailableAgents: async () => {
      throw new Error("ECONNREFUSED");
    },
  });

  const out = await handlers.handleTransferToAgent({ ly_do: "x" });
  assert.equal(out.success, false);
  assert.equal(out.action, "leave_message");
  assert.ok(logCalls.some((c) => c.level === "warn" && c.msg.includes("ECONNREFUSED")));
});

test("handleTransferToAgent: getAvailableAgents qua CHAM (vuot transferTimeoutMs) -> coi nhu khong co agent, khong cho mai mai", async () => {
  const { handlers } = makeFakes({
    getAvailableAgents: () => new Promise(() => {}), // khong bao gio resolve
    transferTimeoutMs: 20, // rut ngan cho test, khong doi 4.5s that
  });

  const out = await handlers.handleTransferToAgent({ ly_do: "x" });
  assert.equal(out.success, false);
  assert.equal(out.action, "leave_message");
});

test("handleTransferToAgent: getAvailableAgents.data rong/thieu -> khong throw, coi nhu khong co agent", async () => {
  const { handlers } = makeFakes({ getAvailableAgents: async () => ({ success: false, data: null }) });

  const out = await handlers.handleTransferToAgent({ ly_do: "x" });
  assert.equal(out.success, false);
  assert.equal(out.action, "leave_message");
});

// ─── Du lieu THAT (khong doan/mock tuong tuong) ─────────────────────────────
//
// [23/08/2026] Goi THAT toi API test cua CNTA qua tunnel (chinh chu du an
// tu chay lenh - xem hoi thoai docs/roadmap.md muc Giai doan 5b), xac
// nhan getAvailableAgents tra ve:
//   { success: true, http_code: 200, data: { available_agents: 0, queue: "GroupDay1" } }
// KHONG phat hien lech gi voi gia dinh cu (giong outages.js - khac
// billing.js da phat hien loi dinh dang ngay).
test("[du lieu THAT 23/08/2026] handleTransferToAgent dung dung field API that tra ve (available_agents=0 -> leave_message)", async () => {
  const { handlers } = makeFakes({
    getAvailableAgents: async () => ({ success: true, http_code: 200, data: { available_agents: 0, queue: "GroupDay1" } }),
  });

  const out = await handlers.handleTransferToAgent({ ly_do: "Khách muốn gặp người thật" });
  assert.equal(out.success, false);
  assert.equal(out.action, "leave_message");
  assert.match(out.doc_cho_khach, /chưa có tổng đài viên nào rảnh/);
});

// ─── handleLeaveCallbackMessage ─────────────────────────────────────────────

test("handleLeaveCallbackMessage: co ma_danh_bo -> chuan hoa (bo ky tu khong phai so) truoc khi gui", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    baoSuCo: async (danhba, noiDung, tel) => {
      calls.push({ danhba, noiDung, tel });
      return { success: true, data: {} };
    },
  });

  await handlers.handleLeaveCallbackMessage(
    { noi_dung: "Gọi lại giúp em với", ma_danh_bo: "22023-251775" },
    { callerPhone: "0909123456" }
  );

  assert.deepEqual(calls[0], { danhba: "22023251775", noiDung: "Gọi lại giúp em với", tel: "0909123456" });
});

test("handleLeaveCallbackMessage: KHONG co ma_danh_bo -> gui null, KHONG bat buoc, khong throw", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    baoSuCo: async (danhba, noiDung, tel) => {
      calls.push({ danhba, noiDung, tel });
      return { success: true, data: {} };
    },
  });

  const out = await handlers.handleLeaveCallbackMessage({ noi_dung: "Gọi lại giúp em với" }, { callerPhone: "0909123456" });

  assert.equal(calls[0].danhba, null);
  assert.equal(out.ma_danh_bo, null);
});

test("handleLeaveCallbackMessage: khong co callState.callerPhone -> tel null, khong throw", async () => {
  const calls = [];
  const { handlers } = makeFakes({
    baoSuCo: async (danhba, noiDung, tel) => {
      calls.push(tel);
      return { success: true, data: {} };
    },
  });

  await handlers.handleLeaveCallbackMessage({ noi_dung: "x" }, {});
  assert.equal(calls[0], null);
});

test("handleLeaveCallbackMessage: baoSuCo that bai -> tra ve object loi voi message tu API", async () => {
  const { handlers } = makeFakes({ baoSuCo: async () => ({ success: false, message: "Lỗi hệ thống." }) });

  const out = await handlers.handleLeaveCallbackMessage({ noi_dung: "x" }, {});
  assert.deepEqual(out, { success: false, message: "Lỗi hệ thống." });
});

test("handleLeaveCallbackMessage: thanh cong -> tra ve doc_cho_khach + ma_danh_bo da chuan hoa + data", async () => {
  const { handlers } = makeFakes({ baoSuCo: async () => ({ success: true, data: { maPhieu: "CB01" } }) });

  const out = await handlers.handleLeaveCallbackMessage({ noi_dung: "Gọi lại giúp em", ma_danh_bo: "22023251775" }, { callerPhone: "0909123456" });

  assert.equal(out.success, true);
  assert.match(out.doc_cho_khach, /ghi nhận lời nhắn/);
  assert.equal(out.ma_danh_bo, "22023251775");
  assert.deepEqual(out.data, { maPhieu: "CB01" });
});

// ─── handleEndCall ──────────────────────────────────────────────────────────

test("handleEndCall: co ly_do -> giu nguyen ly_do", () => {
  const { handlers } = makeFakes({});
  const out = handlers.handleEndCall({ ly_do: "Khách cảm ơn và tạm biệt" });
  assert.deepEqual(out, {
    success: true,
    action: "end_call",
    message: "Kết thúc cuộc gọi.",
    ly_do: "Khách cảm ơn và tạm biệt",
  });
});

test("handleEndCall: khong co ly_do -> dung cau mac dinh", () => {
  const { handlers } = makeFakes({});
  const out = handlers.handleEndCall({});
  assert.equal(out.ly_do, "Khách hàng đã được hỗ trợ xong");
});

test("handleEndCall: goi khong tham so gi (opts undefined) -> khong throw", () => {
  const { handlers } = makeFakes({});
  const out = handlers.handleEndCall();
  assert.equal(out.success, true);
  assert.equal(out.action, "end_call");
});

// ─── handleWaitForUser ──────────────────────────────────────────────────────

test("handleWaitForUser: luon tra ve action:no_reply, khong nhan tham so", () => {
  const { handlers } = makeFakes({});
  const out = handlers.handleWaitForUser();
  assert.equal(out.success, true);
  assert.equal(out.action, "no_reply");
});
