// test/danh-bo-readback-match.test.mjs
//
// Giai doan 6b (xem docs/roadmap.md, docs/fix/giai_doan_6b_dinh_chinh_
// pairing_previous_item_id_20260824.md). Test cho src/call-flow/
// danh-bo-readback-match.js - toan bo ham THUAN, khong can WS/API that.
// Cac tin hieu dung trong test la tin hieu DA CHUAN HOA (dung dang
// normalizeTurnEvent() tra ve - xem test/turn-signal.test.mjs), khong phai
// event tho - dung mau da lap voi test/danh-bo-flow.test.mjs (hand-build
// signal, khong replay fixture .jsonl, vi day la unit test cho state may
// THUAN chu khong phai cho lop chuan hoa).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadbackMatcher, resolveConfirmDanhBo } from "../src/call-flow/danh-bo-readback-match.js";

// Cau doc lai mo phong dung dang model se tu sinh ra (Entity Collection
// Workflow - doc TUNG CHU SO, xem docs/roadmap.md muc Giai doan 6b), CUNG
// so danh bo that da dung xuyen suot Giai doan 6a
// (samples/6a_doc_so_22023251775.wav): "22023251775".
const AI_READBACK_TEXT =
  "Dạ, mã danh bộ của Quý Khách là Hai - Hai - Không - Hai - Ba - Hai - Năm - Một - Bảy - Bảy - Năm. Quý Khách xác nhận giúp em có đúng không ạ?";

// ─── createReadbackMatcher (Buoc 1: khop cap theo thu tu, GOM nhieu manh) ───
//
// [25/08/2026] 3 test dung DU LIEU THAT, copy nguyen tu 3 lan chay
// scripts/probe-confirm-danh-bo.mjs (chu du an tu ghi am, dan lai nguyen
// van console output) - xem docs/fix/giai_doan_6b_dinh_chinh_pairing_
// previous_item_id_20260824.md muc "Cap nhat 25/08/2026". itemId rut gon
// (item_u1/u2/...) thay cho id that (item_EGaf...) de de doc, THU TU va
// NOI DUNG text giu NGUYEN VAN.

test("chua arm(): handleSignal khong lam gi, getResult() luon null", () => {
  const m = createReadbackMatcher();
  assert.equal(m.isArmed(), false);
  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "Dạ đúng rồi ạ" });
  m.handleSignal({ kind: "response-started", responseId: "resp_1" });
  assert.equal(m.getResult(), null);
});

test("[du lieu that #1 - 6b_xac_nhan_ngat_quang.wav, 1 manh duy nhat] khop dung, khong bi tach", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);
  assert.equal(m.isArmed(), true);
  assert.equal(m.getReadbackText(), AI_READBACK_TEXT);

  // Tin hieu xen giua (response-ended cua chinh luot AI doc lai) bi bo qua
  // co y, khong lam gian doan.
  m.handleSignal({ kind: "response-ended", responseId: "resp_1", status: "completed" });
  assert.equal(m.getResult(), null);

  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  assert.equal(m.getResult(), null, "moi co item, CHUA dung (chua thay response-started) - chua ket luan");

  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "Dạ, để em xem lại đã. Dạ, đúng rồi ạ." });
  assert.equal(m.getResult(), null, "da co transcript nhung CHUA dung - van co the con manh nua dang toi");

  m.handleSignal({ kind: "response-started", responseId: "resp_2" });
  assert.deepEqual(m.getResult(), { itemIds: ["item_u1"], text: "Dạ, để em xem lại đã. Dạ, đúng rồi ạ." });
});

test("[du lieu that #2 - 6b_dung_roi_ngap_ngung_noise1.wav, 4 manh] gom DU 4 manh, noi lai dung thu tu", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);

  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "À để kiểm tra xíu." });
  assert.equal(m.getResult(), null, "moi 1/4 manh, chua dung - KHONG duoc ket luan som (day chinh la bug 24/08/2026 da sua)");

  m.handleSignal({ kind: "user-item-added", itemId: "item_u2" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u2", text: "Vâng ạ." });
  m.handleSignal({ kind: "user-item-added", itemId: "item_u3" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u3", text: "À, đúng rồi." });
  m.handleSignal({ kind: "user-item-added", itemId: "item_u4" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u4", text: "Hóa đơn." });
  assert.equal(m.getResult(), null, "da co ca 4 manh nhung CHUA thay response-started - van chua duoc coi la 'het'");

  m.handleSignal({ kind: "response-started", responseId: "resp_2" });
  assert.deepEqual(m.getResult(), {
    itemIds: ["item_u1", "item_u2", "item_u3", "item_u4"],
    text: "À để kiểm tra xíu. Vâng ạ. À, đúng rồi. Hóa đơn.",
  });
});

// [25/08/2026 - Cap nhat #2] Lan chay dau cua noise2.wav (2 manh, "À" +
// "Để xem lại nha.") bi CAT MAT phan "đúng rồi" o cuoi do 1 bug KHAC (het
// han o probe-confirm-danh-bo.mjs: debounce dong ket noi som trong luc con
// dang gui audio - da sua, xem docs/fix). Test duoi day dung DU LIEU DA
// SUA/DAY DU (3 manh, chay lai thanh cong) - manh dau la 1 hien tuong phu
// thu vi (ASR echo lai chinh TRANSCRIBE_PROMPT vi audio dau khong ro, xem
// docs/fix) nhung KHONG anh huong ket qua vi matcher gom THEO THU TU, khong
// phu thuoc noi dung.
test("[du lieu that #3 - 6b_dung_roi_ngap_ngung_noise2.wav, 3 manh SAU KHI sua bug cat audio o probe] gom du 3 manh - transcript manh cuoi den SAU response-started van duoc tinh (dung thu tu bat dong bo da ghi nhan o Giai doan 1)", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);

  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({
    kind: "transcript-ready",
    itemId: "item_u1",
    text: "Cuộc gọi tổng đài chăm sóc khách hàng công ty cấp nước tại TP.HCM, toàn bộ bằng tiếng Việt. Có thể chứa mã danh bộ 11 chữ số, số tiền.",
  });
  m.handleSignal({ kind: "user-item-added", itemId: "item_u2" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u2", text: "Để xem lại nha." });
  m.handleSignal({ kind: "user-item-added", itemId: "item_u3" });
  // response-started den TRUOC transcript cua manh thu 3 (mo phong dung do
  // that o Giai doan 1: transcript co the den SAU response.created).
  m.handleSignal({ kind: "response-started", responseId: "resp_2" });
  assert.equal(m.getResult(), null, "da 'dung' nhung item_u3 CHUA co transcript - phai cho, KHONG duoc chot thieu");

  m.handleSignal({ kind: "transcript-ready", itemId: "item_u3", text: "À đúng rồi." });
  assert.deepEqual(m.getResult(), {
    itemIds: ["item_u1", "item_u2", "item_u3"],
    text: "Cuộc gọi tổng đài chăm sóc khách hàng công ty cấp nước tại TP.HCM, toàn bộ bằng tiếng Việt. Có thể chứa mã danh bộ 11 chữ số, số tiền. Để xem lại nha. À đúng rồi.",
  });
});

test("user-item-added den SAU 'response-started' (AI da bat dau luot ke tiep) bi bo qua, khong gom nham vao luot tra loi cu", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);
  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "đúng rồi ạ" });
  m.handleSignal({ kind: "response-started", responseId: "resp_2" });
  assert.deepEqual(m.getResult(), { itemIds: ["item_u1"], text: "đúng rồi ạ" });

  // Item MOI (vd khach noi chen/barge-in luot AI tiep theo) den SAU khi da
  // chot - KHONG duoc lam thay doi ket qua da co.
  m.handleSignal({ kind: "user-item-added", itemId: "item_u2" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u2", text: "khong lien quan" });
  assert.deepEqual(m.getResult(), { itemIds: ["item_u1"], text: "đúng rồi ạ" }, "ket qua giu nguyen");
});

test("khong co manh nao ca ma da 'response-started' -> getResult() van null (khong the ket luan tu tap rong)", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);
  m.handleSignal({ kind: "response-started", responseId: "resp_2" });
  assert.equal(m.isStopped(), true);
  assert.equal(m.getResult(), null);
});

test("arm() lai (lan doc lai MOI) reset toan bo state cu - dung vong doi 1 phien/1 lan doc, giong createDanhBoSession()", () => {
  const m = createReadbackMatcher();
  m.arm("cau doc lai lan 1");
  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "sai roi" });
  m.handleSignal({ kind: "response-started", responseId: "resp_x" });
  assert.notEqual(m.getResult(), null);

  m.arm("cau doc lai lan 2");
  assert.equal(m.getResult(), null, "arm() lai phai xoa ket qua cu");
  assert.equal(m.isStopped(), false);
  assert.deepEqual(m.getItemIds(), []);
  assert.equal(m.getReadbackText(), "cau doc lai lan 2");
});

// ─── resolveConfirmDanhBo (Buoc 2-3-4: trich so + so sanh voi tool) ───

test("toolValue KHOP voi so trich tu cau AI doc lai -> status 'match'", () => {
  const r = resolveConfirmDanhBo({ toolValue: "22023251775", aiReadbackText: AI_READBACK_TEXT });
  assert.deepEqual(r, { status: "match", readbackDigits: "22023251775", value: "22023251775" });
});

test("toolValue co dau gach ngang/khoang trang (dang tool hay gui) - normalizeDanhBo tu xu ly, van 'match'", () => {
  const r = resolveConfirmDanhBo({ toolValue: "2-2-0-2-3-2-5-1-7-7-5", aiReadbackText: AI_READBACK_TEXT });
  assert.equal(r.status, "match");
  assert.equal(r.value, "22023251775");
});

test("toolValue LECH so voi cau AI doc lai -> status 'override', dung so TRICH TU CAU AI (khong dung so tool gui)", () => {
  const r = resolveConfirmDanhBo({ toolValue: "22023251770", aiReadbackText: AI_READBACK_TEXT });
  assert.equal(r.status, "override");
  assert.equal(r.readbackDigits, "22023251775");
  assert.equal(r.value, "22023251775", "dung so DA TRICH, khong phai so tool gui (22023251770)");
});

test("cau AI doc lai KHONG trich du 11 so ro rang (vd bi cat cut/loi) -> status 'unclear', value null", () => {
  const r = resolveConfirmDanhBo({
    toolValue: "22023251775",
    aiReadbackText: "Dạ, mã danh bộ của Quý Khách là Hai - Hai - Không.",
  });
  assert.equal(r.status, "unclear");
  assert.equal(r.value, null);
});

test("aiReadbackText rong/null -> 'unclear', khong crash", () => {
  assert.equal(resolveConfirmDanhBo({ toolValue: "22023251775", aiReadbackText: "" }).status, "unclear");
  assert.equal(resolveConfirmDanhBo({ toolValue: "22023251775", aiReadbackText: null }).status, "unclear");
});

test("aiReadbackText doc du > 11 so (vd model lo doc dai hon) - chi lay 11 so DAU TIEN, giong quy uoc danhBoCandidate() cua Giai doan 6a", () => {
  const r = resolveConfirmDanhBo({
    toolValue: "22023251775",
    aiReadbackText: AI_READBACK_TEXT.replace("Năm. Quý", "Năm - Một. Quý"), // them 1 so thua vao cuoi
  });
  assert.equal(r.readbackDigits, "22023251775");
  assert.equal(r.readbackDigits.length, 11);
});
