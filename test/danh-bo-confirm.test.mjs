// test/danh-bo-confirm.test.mjs
//
// Giai doan 6a (xem docs/roadmap.md). Test cho src/call-flow/danh-bo-confirm.js
// - toan bo ham THUAN. Nhieu case duoi day la REGRESSION TEST cho bug THAT
// da xay ra o ban cu (trich dan cuoc goi trong tung test) - dam bao logic
// port sang KHONG lam song lai bug cu.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isAffirmative, isNegative, wantsRepeat } from "../src/call-flow/danh-bo-confirm.js";

test("isAffirmative: cac cau khang dinh ro rang -> true", () => {
  assert.equal(isAffirmative("đúng rồi ạ"), true);
  assert.equal(isAffirmative("vâng"), true);
  assert.equal(isAffirmative("dạ đúng"), true);
  assert.equal(isAffirmative("ok"), true);
  assert.equal(isAffirmative("oke bạn"), true);
  assert.equal(isAffirmative("được"), true);
  assert.equal(isAffirmative("chính xác"), true);
});

test("isAffirmative: 'được' phai khop (regression - ban cu dung \\bđược\\b la CODE CHET vi \\b khong " +
  "hoat dong voi ky tu co dau, phat hien khi port sang day 23/08/2026, KHONG PHAI trong ban cu)", () => {
  assert.equal(isAffirmative("được"), true);
  assert.equal(isAffirmative("dạ được ạ"), true);
});

test("isAffirmative: tu don 'ừ'/'ờ' dung MOT MINH trong cau ngan (<=2 tu) -> true", () => {
  assert.equal(isAffirmative("ừ"), true);
  assert.equal(isAffirmative("ừm"), true);
  assert.equal(isAffirmative("ờ"), true);
  assert.equal(isAffirmative("ừ đúng"), true);
});

test("isAffirmative: 'dời'/'giờ'/'chờ' chua am tiet 'ờ' nhung KHONG PHAI xac nhan " +
  "[fix that 30/07/2026 ban cu, cuoc rtc_u1_E7L7Y2XD6JGGx1oQkIjAj - \\b cua JS khop nham ben trong tu khac]", () => {
  assert.equal(isAffirmative("Mình muốn nâng dời đồng hồ."), false);
  assert.equal(isAffirmative("Bây giờ mình chưa rảnh."), false);
  assert.equal(isAffirmative("Chờ mình xíu."), false);
});

test("isAffirmative: cau HOI khong bao gio duoc tinh la xac nhan, ke ca khi chua tu khang dinh " +
  "[fix that 31/07/2026 dot 12 ban cu, cuoc rtc_u1_E7Z0LRZnTro02qMeeISyy]", () => {
  assert.equal(
    isAffirmative("Vâng, cho mình hỏi giờ mình lên đăng ký định mức nước hai nhân khẩu được không ạ?"),
    false
  );
  assert.equal(isAffirmative("Đúng không ạ?"), false);
});

test("isAffirmative: phu dinh duoc uu tien kiem tra TRUOC, du cau co lan tu khang dinh o dau", () => {
  assert.equal(isAffirmative("vâng, nhưng sai rồi ạ"), false);
  assert.equal(isAffirmative("không đúng"), false);
});

test("isAffirmative: cau dai qua 2 tu ma khong khop KHANG_DINH_RE -> false (khong ro rang)", () => {
  assert.equal(isAffirmative("em cảm ơn bạn nhiều nhé"), false);
  assert.equal(isAffirmative(""), false);
});

test("isNegative: tu choi ro rang -> true", () => {
  assert.equal(isNegative("không đúng"), true);
  assert.equal(isNegative("chưa đúng"), true);
  assert.equal(isNegative("sai rồi"), true);
  assert.equal(isNegative("chưa phải"), true);
  assert.equal(isNegative("không phải vậy"), true);
});

test("isNegative: cau khang dinh/khong lien quan -> false", () => {
  assert.equal(isNegative("đúng rồi ạ"), false);
  assert.equal(isNegative("ừ"), false);
  assert.equal(isNegative(""), false);
});

test("wantsRepeat: khach xin nghe/doc lai -> true", () => {
  assert.equal(wantsRepeat("bạn đọc lại giúp mình"), true);
  assert.equal(wantsRepeat("nói lại đi"), true);
  assert.equal(wantsRepeat("nhắc lại giúp em với"), true);
  assert.equal(wantsRepeat("chưa nghe rõ"), true);
  assert.equal(wantsRepeat("nghe không rõ lắm"), true);
});

test("wantsRepeat: cau khong lien quan xin nhac lai -> false", () => {
  assert.equal(wantsRepeat("đúng rồi ạ"), false);
  assert.equal(wantsRepeat(""), false);
});

test("isAffirmative/isNegative/wantsRepeat co the CUNG true tren 1 cau (vd 'không đúng, đọc lại đi') " +
  "- ben goi (orchestrator) tu quyet dinh uu tien, cac ham nay khong tu loai tru nhau", () => {
  const text = "không đúng, đọc lại đi";
  assert.equal(isAffirmative(text), false);
  assert.equal(isNegative(text), true);
  assert.equal(wantsRepeat(text), true);
});
