// test/danh-bo-collect.test.mjs
//
// Giai doan 6a (xem docs/roadmap.md). Test cho src/call-flow/danh-bo-collect.js
// - toan bo ham THUAN, khong can WS/API gia. Nhieu case duoi day la
// REGRESSION TEST cho cac bug THAT da xay ra o ban cu (trich dan cuoc goi
// trong tung test) - giu nguyen de dam bao logic port sang KHONG lam song
// lai bug cu.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDanhBo,
  viDigitsFromWords,
  danhBoSpoken,
  looksLikeDigitTurn,
  DANH_BO_LENGTH,
  createDanhBoSession,
  noteDanhBoDigits,
  danhBoDigitCount,
  isDanhBoComplete,
  danhBoCandidate,
} from "../src/call-flow/danh-bo-collect.js";

test("DANH_BO_LENGTH la 11 (dung tham so ban cu)", () => {
  assert.equal(DANH_BO_LENGTH, 11);
});

test("normalizeDanhBo: bo ky tu khong phai so (khach doc kem dau gach ngang/khoang trang)", () => {
  assert.equal(normalizeDanhBo("2-2-0-2-3-2-5-1-7-7-5"), "22023251775");
  assert.equal(normalizeDanhBo("22023251775"), "22023251775");
});

test("normalizeDanhBo: rong/null/undefined -> rong, khong crash", () => {
  assert.equal(normalizeDanhBo(""), "");
  assert.equal(normalizeDanhBo(null), "");
  assert.equal(normalizeDanhBo(undefined), "");
});

test("normalizeDanhBo: khong co chu so ASCII -> fallback ghep tu chu so doc bang loi", () => {
  assert.equal(normalizeDanhBo("Hai - Hai - Không - Hai - Ba"), "22023");
});

test("normalizeDanhBo: cau binh thuong lo co 1-2 tu trung chu so -> van ra rong (khong du 3 token lien tiep)", () => {
  assert.equal(normalizeDanhBo("một chút thôi ạ"), "");
});

test("viDigitsFromWords: bo qua tu khung cau xen dau/cuoi/giua, chi lay chuoi chu so LIEN TUC DAI NHAT " +
  "[fix that 30/07/2026 ban cu, cuoc rtc_u1_E7JWxaN1u2ZbQG9SnKbwh]", () => {
  assert.equal(viDigitsFromWords("Số danh bộ là hai hai không hai ba ạ"), "22023");
});

test("viDigitsFromWords: it hon 3 token chu so lien tiep -> rong (chong ghep nham cau binh thuong)", () => {
  assert.equal(viDigitsFromWords("một chút thôi"), "");
  assert.equal(viDigitsFromWords("không có gì đâu"), "");
});

test("danhBoSpoken: doc lai dung tung chu so, khop CHINH XAC vi du that da dung trong checkpoint 5b", () => {
  assert.equal(
    danhBoSpoken("22023251775"),
    "Hai - Hai - Không - Hai - Ba - Hai - Năm - Một - Bảy - Bảy - Năm"
  );
});

test("danhBoSpoken: chu so khong nam trong DIGIT_WORDS (vd ky tu la) duoc giu nguyen, khong crash", () => {
  assert.equal(danhBoSpoken("1a2"), "Một - a - Hai");
});

test("looksLikeDigitTurn: >=3 ky tu so LIEN tiep (ASR phien am thanh chuoi so) -> true " +
  "[fix that 19/07/2026 v2 ban cu, cuoc E3IwDpl3qXKJ2hoRtHHRU]", () => {
  assert.equal(looksLikeDigitTurn("232474431"), true);
});

test("looksLikeDigitTurn: >=3 tu chi so doc tach rieng -> true", () => {
  assert.equal(looksLikeDigitTurn("hai hai không hai ba"), true);
});

test("looksLikeDigitTurn: cau binh thuong khong du 3 dau hieu -> false", () => {
  assert.equal(looksLikeDigitTurn("một chút thôi ạ"), false);
  assert.equal(looksLikeDigitTurn("dạ vâng em cảm ơn"), false);
});

test("createDanhBoSession: tra ve session rong moi lan goi, khong chia se state giua cac lan", () => {
  const a = createDanhBoSession();
  const b = createDanhBoSession();
  assert.deepEqual(a, { digits: "", turns: [] });
  noteDanhBoDigits(a, "123");
  assert.deepEqual(b, { digits: "", turns: [] }, "session b khong bi anh huong boi thay doi tren session a");
});

test("noteDanhBoDigits: gom NOI TIEP nhieu manh (mo phong VAD 'digits' mode tach 1 lan doc thanh nhieu buffer-committed)", () => {
  const session = createDanhBoSession();
  noteDanhBoDigits(session, "hai hai không");
  noteDanhBoDigits(session, "hai ba hai năm");
  noteDanhBoDigits(session, "một bảy bảy năm");
  assert.equal(session.digits, "22023251775");
  assert.equal(danhBoDigitCount(session), 11);
});

test("noteDanhBoDigits: ghi lai turns[] (text goc + digits da chuan hoa) cho tung manh, phuc vu log/debug", () => {
  const session = createDanhBoSession();
  noteDanhBoDigits(session, "hai hai không");
  assert.equal(session.turns.length, 1);
  assert.deepEqual(session.turns[0], { text: "hai hai không", digits: "220" });
});

test("noteDanhBoDigits: tra ve chinh session (chain duoc)", () => {
  const session = createDanhBoSession();
  const returned = noteDanhBoDigits(session, "123");
  assert.equal(returned, session);
});

test("isDanhBoComplete: false khi chua du 11 so, true khi du/vuot", () => {
  const session = createDanhBoSession();
  noteDanhBoDigits(session, "2202325");
  assert.equal(isDanhBoComplete(session), false);
  noteDanhBoDigits(session, "1775");
  assert.equal(isDanhBoComplete(session), true);
});

test("danhBoCandidate: null khi chua du 11 so", () => {
  const session = createDanhBoSession();
  noteDanhBoDigits(session, "2202325");
  assert.equal(danhBoCandidate(session), null);
});

test("danhBoCandidate: dung 11 so dau tien khi vua du", () => {
  const session = createDanhBoSession();
  noteDanhBoDigits(session, "22023251775");
  assert.equal(danhBoCandidate(session), "22023251775");
});

test("danhBoCandidate: khach doc du/thua so - lay DUNG 11 so DAU TIEN theo thu tu da doc, bo so du (don gian hoa co y, xem ghi chu dau file)", () => {
  const session = createDanhBoSession();
  noteDanhBoDigits(session, "220232517759999");
  assert.equal(danhBoCandidate(session), "22023251775");
});
