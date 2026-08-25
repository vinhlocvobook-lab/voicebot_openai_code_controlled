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

// ─── createReadbackMatcher (Buoc 1: khop cap theo thu tu) ───

test("chua arm(): handleSignal khong lam gi, getResult() luon null", () => {
  const m = createReadbackMatcher();
  assert.equal(m.isArmed(), false);
  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "Dạ đúng rồi ạ" });
  assert.equal(m.getResult(), null);
});

test("arm() roi khop dung: user-item-added truoc, transcript-ready cung itemId sau -> getResult() tra ve dung cap", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);
  assert.equal(m.isArmed(), true);
  assert.equal(m.getReadbackText(), AI_READBACK_TEXT);

  // Tin hieu xen giua (dung that theo bang moc thoi gian trong docs/fix -
  // response-ended cua chinh luot AI doc lai den truoc item cua khach) bi
  // bo qua co y, khong lam gian doan.
  m.handleSignal({ kind: "response-ended", responseId: "resp_1", status: "completed" });
  assert.equal(m.getResult(), null);

  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  assert.equal(m.getPendingItemId(), "item_u1");
  assert.equal(m.getResult(), null, "moi co item, CHUA co transcript - chua duoc tinh la khop");

  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "Dạ đúng rồi ạ" });
  assert.deepEqual(m.getResult(), { itemId: "item_u1", text: "Dạ đúng rồi ạ" });
});

test("transcript-ready itemId KHONG trung voi user-item-added dang cho -> khong khop, cho tiep", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);
  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  // itemId lech (vd du lieu khac luong, phong thu) - khong duoc khop nham.
  m.handleSignal({ kind: "transcript-ready", itemId: "item_KHAC", text: "noi dung khac" });
  assert.equal(m.getResult(), null);

  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "Dạ đúng rồi ạ" });
  assert.deepEqual(m.getResult(), { itemId: "item_u1", text: "Dạ đúng rồi ạ" });
});

test("transcript-ready den TRUOC ca user-item-added nao -> bi bo qua (chua co pendingItemId de doi chieu)", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "den qua som" });
  assert.equal(m.getResult(), null);
  assert.equal(m.getPendingItemId(), null);
});

test("nhieu user-item-added lien tiep (vd tap am/nhieu manh) - CHI item DAU TIEN sau arm duoc dung (chua co bang chung that cho truong hop khac, xem chu thich dau file)", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);
  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({ kind: "user-item-added", itemId: "item_u2" });
  assert.equal(m.getPendingItemId(), "item_u1", "van giu item DAU TIEN, khong bi item thu 2 ghi de");

  // transcript cua item THU HAI khong duoc tinh la khop, vi dang cho item dau tien.
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u2", text: "cua item thu hai" });
  assert.equal(m.getResult(), null);

  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "cua item dau tien" });
  assert.deepEqual(m.getResult(), { itemId: "item_u1", text: "cua item dau tien" });
});

test("da co ket qua roi thi handleSignal() tiep theo khong ghi de nua", () => {
  const m = createReadbackMatcher();
  m.arm(AI_READBACK_TEXT);
  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "dau tien" });
  assert.deepEqual(m.getResult(), { itemId: "item_u1", text: "dau tien" });

  m.handleSignal({ kind: "user-item-added", itemId: "item_u2" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u2", text: "sau do, khong lien quan" });
  assert.deepEqual(m.getResult(), { itemId: "item_u1", text: "dau tien" }, "ket qua giu nguyen, khong bi lan sau ghi de");
});

test("arm() lai (lan doc lai MOI) reset toan bo state cu - dung vong doi 1 phien/1 lan doc, giong createDanhBoSession()", () => {
  const m = createReadbackMatcher();
  m.arm("cau doc lai lan 1");
  m.handleSignal({ kind: "user-item-added", itemId: "item_u1" });
  m.handleSignal({ kind: "transcript-ready", itemId: "item_u1", text: "sai roi" });
  assert.notEqual(m.getResult(), null);

  m.arm("cau doc lai lan 2");
  assert.equal(m.getResult(), null, "arm() lai phai xoa ket qua cu");
  assert.equal(m.getPendingItemId(), null);
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
