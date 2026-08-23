// src/domain/tool-router.js
//
// Giai doan 5b (xem docs/roadmap.md) - "noi day" cuoi cung: gop CA 5 module
// domain (billing/outages/tickets/call-control/procedures) thanh 1 object
// `handlers` DUNG HINH DANG ma dispatch-tool-call.js (Giai doan 5a) da can:
// { [ten_tool]: async (args) => output }. Day la file MOI DUY NHAT trong
// Giai doan 5b thuc su "goi" 5 file domain lai voi nhau - tung file truoc
// do (billing.js, outages.js, ...) van dung doc lap, test rieng, chua noi day.
//
// ============================================================================
// GIAI QUYET 1 TRONG 2 KHOANG CACH DA GHI CHU O CAC FILE TRUOC: callState
// ============================================================================
// dispatch-tool-call.js goi `handler(args)` - CHI 1 THAM SO. Nhung moi domain
// handler (billing/outages/tickets/call-control/procedures.handleGetProcedureInfo)
// deu can `(args, callState)` - dac biet procedures.js can callState SONG
// SUOT ca cuoc goi (Set `daHoiDoiTuong`) de hoat dong dung.
//
// GIAI PHAP (khong sua dispatch-tool-call.js): createToolRouter nhan
// `callState` la tham so O MUC FACTORY (giong createTurnController(ws) -
// factory theo TUNG CUOC GOI/KET NOI), roi CLOSURE callState do vao moi ham
// tra ve trong `handlers` - ket qua la moi ham trong `handlers` CHI con 1
// tham so (args) => output, dung y dispatch-tool-call.js dang mong doi,
// KHONG can sua gi o Giai doan 5a. Noi goi (server.js, sau nay) se tao 1
// callState MOI cho MOI cuoc goi that, roi goi createToolRouter({..., callState})
// 1 LAN cho ca cuoc goi do - giong cach createTurnController(ws)/
// createToolDispatcher(...) da lam.
// ============================================================================
//
// ============================================================================
// KHOANG CACH THU 2 - CHUA GIAI QUYET O DAY (de lai nguyen, ghi ro):
// ============================================================================
// Ca field `action` (call-control.js: no_reply/end_call/transfer_to_agent/
// leave_message) LAN field `doc_cho_khach` (call-control.js/procedures.js:
// kich ban bat buoc doc nguyen van) deu CHUA duoc dispatch-tool-call.js/
// turn-controller.js doc/xu ly - hien tai dispatch-tool-call.js van goi
// turnController.say({}) (mode "auto", de model tu do dat cau) VO DIEU KIEN
// sau moi tool. Muon 4 tool cua call-control.js va 2 tool cua procedures.js
// hoat dong DUNG Y BAN CU khi noi vao cuoc goi that, CAN mot ban cap nhat
// dispatch-tool-call.js/turn-controller.js RIENG (doc output cua tool, neu
// co `action:"no_reply"` thi KHONG goi say(), neu co `doc_cho_khach` thi
// say({mode:"verbatim", text: output.doc_cho_khach}) thay vi mode "auto",
// v.v.) - VIEC NAY CHUA LAM, la buoc tiep theo sau tool-router.js nay.
// ============================================================================
//
// Anh xa 10 ten tool (xac nhan tu voice_bot/src/system-prompt.js#TOOLS,
// KHONG doan): get_bill, compare_usage, get_outages, create_ticket,
// get_procedure_info, check_missing_docs, transfer_to_agent, end_call,
// leave_callback_message, wait_for_user.
//
// resolveDanhBoRef: import THANG tu resolve-danh-bo-ref.js (KHONG qua tham
// so injectable) - day CHINH LA "1 dong import" ma toan bo thiet ke
// resolveDanhBoRef/billing.js/outages.js/tickets.js tung hua se doi khi Giai
// doan 6 xong (resolveDanhBo that cung hop dong). Sua o DAY, khong noi nao khac.
import { resolveDanhBoRef } from "./resolve-danh-bo-ref.js";
import { createBillingHandlers } from "./billing.js";
import { createOutagesHandlers } from "./outages.js";
import { createTicketsHandlers } from "./tickets.js";
import { createCallControlHandlers } from "./call-control.js";
import { createProceduresHandlers } from "./procedures.js";

export function createToolRouter({
  // tongdai-api.js (Giai doan 5) - nhan qua tham so, KHONG tu import thang,
  // giu dung quy uoc injectable cua toan bo module domain (test bang ham gia).
  getTrangThaiTT,
  getSoSanhTangGiam,
  getThongBaoCupNuoc,
  baoSuCo,
  getAvailableAgents,
  // State theo TUNG CUOC GOI - xem ghi chu dau file. Mac dinh {} de test le
  // tung tool khong bat buoc phai tu tao callState.
  callState = {},
  log = () => {},
  transferTimeoutMs,
} = {}) {
  const billing = createBillingHandlers({ getTrangThaiTT, getSoSanhTangGiam, resolveDanhBoRef, log });
  const outages = createOutagesHandlers({ getThongBaoCupNuoc, resolveDanhBoRef, log });
  const tickets = createTicketsHandlers({ baoSuCo, resolveDanhBoRef, log });
  const callControl = createCallControlHandlers({
    getAvailableAgents,
    baoSuCo,
    log,
    ...(transferTimeoutMs !== undefined ? { transferTimeoutMs } : {}),
  });
  const procedures = createProceduresHandlers({ log });

  return {
    get_bill: (args) => billing.handleGetBill(args, callState),
    compare_usage: (args) => billing.handleCompareUsage(args, callState),
    get_outages: (args) => outages.handleGetOutages(args, callState),
    create_ticket: (args) => tickets.handleCreateTicket(args, callState),
    get_procedure_info: (args) => procedures.handleGetProcedureInfo(args, callState),
    // [giu nguyen tu ban cu] check_missing_docs KHONG dung callState (khong
    // qua resolveDanhBoRef, khong can gate doi tuong theo phien) - xem
    // procedures.js#handleCheckMissingDocs.
    check_missing_docs: (args) => procedures.handleCheckMissingDocs(args),
    transfer_to_agent: (args) => callControl.handleTransferToAgent(args),
    leave_callback_message: (args) => callControl.handleLeaveCallbackMessage(args, callState),
    end_call: (args) => callControl.handleEndCall(args),
    // [giu nguyen tu ban cu] wait_for_user khong nhan tham so nao ca -
    // dispatch-tool-call.js van goi voi args da parse (thuong la {}), bo qua an toan.
    wait_for_user: () => callControl.handleWaitForUser(),
  };
}
