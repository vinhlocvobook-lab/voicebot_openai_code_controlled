// test/danh-bo-confirm-tool-flow.test.mjs
//
// Giai doan 6b (xem docs/roadmap.md). Test cho src/call-flow/
// danh-bo-confirm-tool-flow.js - lop TICH HOP noi matcher/resolver THUAN
// vao dong tin hieu (handleSignal) + tool-handler (resolveToolCall), khong
// can WS/API that. Tin hieu hand-build theo DUNG thu tu THAT da quan sat
// (Giai doan 5a: response-started -> ai-said -> ... -> response-ended cua
// luot AI; Giai doan 6b: user-item-added -> transcript-ready cua luot
// khach) - cung mau AI_READBACK_TEXT/du lieu ngat quang that da dung o
// test/danh-bo-readback-match.test.mjs, khong bia moi.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDanhBoConfirmToolFlow } from "../src/call-flow/danh-bo-confirm-tool-flow.js";

const AI_READBACK_TEXT =
  "Dạ, mã danh bộ của Quý Khách là Hai - Hai - Không - Hai - Ba - Hai - Năm - Một - Bảy - Bảy - Năm. Quý Khách xác nhận giúp em có đúng không ạ?";
const MA_DANH_BO = "22023251775";

function createHarness() {
  const callState = {};
  const logs = [];
  const flow = createDanhBoConfirmToolFlow({ callState, log: (level, msg) => logs.push({ level, msg }) });
  return { flow, callState, logs };
}

// Mo phong DUNG 1 luot AI doc lai xin xac nhan hoan tat (response-started ->
// ai-said -> response-ended), roi 1 luot khach tra loi 1 manh duy nhat.
function playNormalReadbackAndConfirm(flow, { readbackText = AI_READBACK_TEXT, confirmText = "Dạ đúng rồi." } = {}) {
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai1" });
  flow.handleSignal({ kind: "ai-said", responseId: "resp_ai1", itemId: "item_ai1", text: readbackText });
  flow.handleSignal({ kind: "response-ended", responseId: "resp_ai1", status: "completed" });
  flow.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  flow.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: confirmText });
  // Luot AI ke tiep (chua tool-call) bat dau - day la diem "response-started"
  // DA duoc probe that xac nhan la diem dung an toan (xem docs/roadmap.md).
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai2" });
}

test("luot binh thuong: khach xac nhan dung, gia tri tool khop -> match, callState.danhBo duoc set", () => {
  const { flow, callState } = createHarness();
  playNormalReadbackAndConfirm(flow);

  const output = flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(output.success, true);
  assert.equal(output.ma_danh_bo, MA_DANH_BO);
  assert.equal(callState.danhBo, MA_DANH_BO);
});

test("gia tri tool LECH so trich tu cau AI doc lai -> override, dung so DA DOC LAI (khong dung gia tri tool)", () => {
  const { flow, callState, logs } = createHarness();
  playNormalReadbackAndConfirm(flow);

  // Model bao gio lech - gui nham 1 so cuoi khac voi chinh cau no vua doc.
  const output = flow.resolveToolCall({ value: "22023251770" });
  assert.equal(output.success, true);
  assert.equal(output.ma_danh_bo, MA_DANH_BO, "phai la so DA DOC LAI, khong phai gia tri tool gui len");
  assert.equal(callState.danhBo, MA_DANH_BO);
  assert.ok(output.message.includes(MA_DANH_BO));
  assert.ok(logs.some((l) => l.level === "warn" && l.msg.includes("LECH")));
});

test("khach CHUA xac nhan ro rang (tra loi mo ho) -> tu choi, callState khong doi", () => {
  const { flow, callState } = createHarness();
  playNormalReadbackAndConfirm(flow, { confirmText: "Dạ để em xem lại đã." });

  const output = flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(output.success, false);
  assert.equal(output.error_code, "DANH_BO_CONFIRM_UNCLEAR");
  assert.equal(callState.danhBo, undefined);
});

test("khach noi SAI/tu choi ro rang -> tu choi (isAffirmative that bai vi PHU_DINH_RE khop truoc)", () => {
  const { flow, callState } = createHarness();
  playNormalReadbackAndConfirm(flow, { confirmText: "Không đúng, để em đọc lại." });

  const output = flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(output.success, false);
  assert.equal(output.error_code, "DANH_BO_CONFIRM_UNCLEAR");
  assert.equal(callState.danhBo, undefined);
});

test("model goi tool TRUOC KHI khach kip tra loi (matcherResult null - goi som ngoai y muon) -> tu choi", () => {
  const { flow, callState } = createHarness();
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai1" });
  flow.handleSignal({ kind: "ai-said", responseId: "resp_ai1", itemId: "item_ai1", text: AI_READBACK_TEXT });
  // KHONG co user-item-added/transcript-ready nao ca - model goi tool ngay
  // trong CHINH luot doc lai (dau hieu giong dot 4, ban cu).

  const output = flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(output.success, false);
  assert.equal(output.error_code, "DANH_BO_CONFIRM_UNCLEAR");
  assert.equal(callState.danhBo, undefined);
});

test("AI noi nhieu luot lien tiep TRUOC khi khach tra loi - chi giu lai luot CUOI (khong noi voi luot truoc)", () => {
  const { flow } = createHarness();
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai1" });
  flow.handleSignal({ kind: "ai-said", responseId: "resp_ai1", itemId: "item_ai1", text: "Dạ, mã danh bộ là số cũ ạ." });
  flow.handleSignal({ kind: "response-ended", responseId: "resp_ai1", status: "completed" });

  // AI noi TIEP 1 luot khac TRUOC KHI khach kip tra loi (vd tu sua) - phai
  // COI LA luot MOI, khong noi text cu vao.
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai2" });
  flow.handleSignal({ kind: "ai-said", responseId: "resp_ai2", itemId: "item_ai2", text: AI_READBACK_TEXT });
  assert.equal(flow.getDebugState().readbackText, AI_READBACK_TEXT, "KHONG duoc con dinh 'Dạ, mã danh bộ là số cũ ạ.'");

  flow.handleSignal({ kind: "response-ended", responseId: "resp_ai2", status: "completed" });
  flow.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  flow.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "Dạ đúng rồi." });
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai3" });

  const output = flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(output.success, true);
});

test("ai-said nhieu manh TRONG CUNG 1 luot (commentary + final) - noi lai bang 1 khoang trang", () => {
  const { flow } = createHarness();
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai1" });
  flow.handleSignal({ kind: "ai-said", responseId: "resp_ai1", itemId: "item_ai1a", text: "Dạ, để em kiểm tra lại nhé." });
  flow.handleSignal({ kind: "ai-said", responseId: "resp_ai1", itemId: "item_ai1b", text: AI_READBACK_TEXT });

  assert.equal(flow.getDebugState().readbackText, `Dạ, để em kiểm tra lại nhé. ${AI_READBACK_TEXT}`);
});

// [SUA 25/08/2026, xem chu thich dau danh-bo-confirm-tool-flow.js] Test CU o
// day tung khang dinh handleSignal() la "no-op hoan toan" khi callState.danhBo
// DA CO SAN - dung DA SAI, chinh dieu kien do la bug chan buoc 5 ("khach co
// the hoi ve mot ma danh bo KHAC that trong cung cuoc goi"). Thay bang test
// duoi day: chung minh 1 CHU KY XAC NHAN THU HAI (ma danh bo KHAC) sau khi
// lan dau DA thanh cong van hoat dong dung binh thuong, VA callState.danhBo
// duoc GHI DE bang gia tri MOI nhat (khong con dinh gia tri cu).
test("buoc 5: sau khi DA xac nhan 1 ma danh bo thanh cong, khach hoi ve 1 ma KHAC trong cung cuoc goi " +
  "- handleSignal VAN tiep tuc theo doi, chu ky xac nhan thu hai thanh cong va GHI DE callState.danhBo", () => {
  const { flow, callState } = createHarness();

  // Chu ky 1: xac nhan thanh cong ma danh bo dau tien.
  playNormalReadbackAndConfirm(flow);
  const output1 = flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(output1.success, true);
  assert.equal(callState.danhBo, MA_DANH_BO);

  // Chu ky 2 (trong CUNG cuoc goi, CUNG flow instance): khach hoi ve 1 ma
  // danh bo KHAC that - AI doc lai ma moi, khach xac nhan.
  const MA_DANH_BO_KHAC = "22023259999";
  const AI_READBACK_TEXT_2 =
    "Dạ, mã danh bộ của Quý Khách là Hai - Hai - Không - Hai - Ba - Hai - Năm - Chín - Chín - Chín - Chín. Quý Khách xác nhận giúp em có đúng không ạ?";
  playNormalReadbackAndConfirm(flow, { readbackText: AI_READBACK_TEXT_2 });

  const output2 = flow.resolveToolCall({ value: MA_DANH_BO_KHAC });
  assert.equal(output2.success, true, "chu ky xac nhan thu hai phai THANH CONG binh thuong, khong bi chan boi callState.danhBo da co tu chu ky 1");
  assert.equal(output2.ma_danh_bo, MA_DANH_BO_KHAC);
  assert.equal(callState.danhBo, MA_DANH_BO_KHAC, "callState.danhBo phai duoc GHI DE bang gia tri MOI NHAT, khong con dinh gia tri chu ky 1");
});

test("[du lieu that, giong test/danh-bo-readback-match.test.mjs] khach tra loi NGAT QUANG (4 manh) van duoc gom DU truoc khi tool duoc goi", () => {
  const { flow, callState } = createHarness();
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai1" });
  flow.handleSignal({ kind: "ai-said", responseId: "resp_ai1", itemId: "item_ai1", text: AI_READBACK_TEXT });
  flow.handleSignal({ kind: "response-ended", responseId: "resp_ai1", status: "completed" });

  flow.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  flow.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "À để kiểm tra xíu." });
  flow.handleSignal({ kind: "user-item-added", itemId: "item_u2" });
  flow.handleSignal({ kind: "transcript-ready", itemId: "item_u2", text: "Vâng ạ." });
  flow.handleSignal({ kind: "user-item-added", itemId: "item_u3" });
  flow.handleSignal({ kind: "transcript-ready", itemId: "item_u3", text: "À, đúng rồi." });
  flow.handleSignal({ kind: "user-item-added", itemId: "item_u4" });
  flow.handleSignal({ kind: "transcript-ready", itemId: "item_u4", text: "Hóa đơn." });
  flow.handleSignal({ kind: "response-started", responseId: "resp_ai2" });

  const output = flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(output.success, true);
  assert.equal(callState.danhBo, MA_DANH_BO);
});

test("sau 1 lan resolveToolCall (du thanh cong hay tu choi) - trang thai duoc RESET, khong dinh sang lan doc lai ke tiep", () => {
  const { flow, callState } = createHarness();
  // Lan 1: khong ro rang, bi tu choi.
  playNormalReadbackAndConfirm(flow, { confirmText: "Dạ để em xem lại đã." });
  flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(callState.danhBo, undefined);

  // Lan 2 (doc lai tu dau): khach xac nhan ro rang - phai THANH CONG, khong
  // bi anh huong boi trang thai "chua ro" cua lan 1.
  playNormalReadbackAndConfirm(flow, { confirmText: "Dạ đúng rồi ạ." });
  const output = flow.resolveToolCall({ value: MA_DANH_BO });
  assert.equal(output.success, true);
  assert.equal(callState.danhBo, MA_DANH_BO);
});
