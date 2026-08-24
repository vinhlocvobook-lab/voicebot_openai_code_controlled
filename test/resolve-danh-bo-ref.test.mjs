// test/resolve-danh-bo-ref.test.mjs
//
// Giai doan 6a (xem docs/roadmap.md). Test rieng cho resolve-danh-bo-ref.js
// ban THAT - trong tam: rawArg (gia tri model tu dien) PHAI bi bo qua hoan
// toan, chi callState.danhBo moi duoc tin. Xem test/tool-router.test.mjs
// cho case tich hop qua router that (2 test da cap nhat cung dot nay).

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDanhBoRef } from "../src/domain/resolve-danh-bo-ref.js";

test("callState.danhBo da co -> ok:true, dung DUNG gia tri do", () => {
  const out = resolveDanhBoRef("bat ky gi", { danhBo: "22023251775" });
  assert.deepEqual(out, { ok: true, value: "22023251775" });
});

test("callState.danhBo chua co -> ok:false, error_code DANH_BO_MISSING, KHONG dung rawArg", () => {
  const out = resolveDanhBoRef("22023251775", {});
  assert.equal(out.ok, false);
  assert.equal(out.error.error_code, "DANH_BO_MISSING");
  assert.equal(out.error.success, false);
});

test("rawArg la mot chuoi 11 so HOP LE nhung callState.danhBo rong - VAN BI TU CHOI " +
  "(dung nguyen tac an toan cot loi cua Giai doan 6a - xem ghi chu dau file nguon)", () => {
  const out = resolveDanhBoRef("22023251775", { danhBo: null });
  assert.equal(out.ok, false);
  assert.equal(out.error.error_code, "DANH_BO_MISSING");
});

test("callState la undefined/null (chua tung goi createToolRouter voi callState) - khong crash, tra ve DANH_BO_MISSING", () => {
  assert.equal(resolveDanhBoRef("x", undefined).ok, false);
  assert.equal(resolveDanhBoRef("x", null).ok, false);
});

test("rawArg rong/null/undefined nhung callState.danhBo DA co - van thanh cong (rawArg khong con vai tro gi)", () => {
  assert.deepEqual(resolveDanhBoRef("", { danhBo: "22023251775" }), { ok: true, value: "22023251775" });
  assert.deepEqual(resolveDanhBoRef(null, { danhBo: "22023251775" }), { ok: true, value: "22023251775" });
  assert.deepEqual(resolveDanhBoRef(undefined, { danhBo: "22023251775" }), { ok: true, value: "22023251775" });
});
