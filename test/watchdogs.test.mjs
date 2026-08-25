// test/watchdogs.test.mjs
//
// Giai doan 7 (xem docs/roadmap.md). Test src/session/watchdogs.js bang dong
// ho GIA (nowMs tu tay, khong cho thoi gian that) - dung DUNG khuon
// test/danh-bo-flow.test.mjs da dung cho checkWatchdog(nowMs) THUAN.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMuteWatchdog, createVadRestoreWatchdog } from "../src/session/watchdogs.js";

// ─── createMuteWatchdog ─────────────────────────────────────────────────────

test("mute watchdog: chua co luot khach nao - khong bao gio kich hoat", () => {
  const wd = createMuteWatchdog({ thresholdMs: 1000 });
  for (let t = 0; t <= 5000; t += 500) {
    assert.equal(wd.checkWatchdog(t), false);
  }
});

test("mute watchdog: khach noi, bot dap TRUOC nguong - khong kich hoat", () => {
  const wd = createMuteWatchdog({ thresholdMs: 1000 });
  wd.onCustomerTurn(0);
  wd.onBotSpoke(300);
  for (let t = 0; t <= 5000; t += 500) {
    assert.equal(wd.checkWatchdog(t), false, `khong duoc kich hoat tai t=${t}`);
  }
});

test("mute watchdog: khach noi, bot KHONG dap, khong co gi ban - kich hoat DUNG luc dat nguong", () => {
  const wd = createMuteWatchdog({ thresholdMs: 1000 });
  wd.onCustomerTurn(0);
  assert.equal(wd.checkWatchdog(500), false, "chua du nguong");
  assert.equal(wd.checkWatchdog(999), false, "vua thieu 1ms");
  assert.equal(wd.checkWatchdog(1000), true, "dat DUNG nguong - phai kich hoat");
});

// [SUA 25/08/2026, xem chu thich dau watchdogs.js muc "SUA 25/08/2026"] Day
// la test REGRESSION cho dung bug that chu du an phat hien: khach hoi lai
// nhieu lan trong luc cho ("Alo? co nghe khong") KHONG duoc phep day han chot
// ra XA HON so voi chi co 1 luot duy nhat.
test("mute watchdog: khach noi LAI nhieu lan trong luc cho (vd sot ruot hoi 'Alo?') - " +
  "KHONG day han chot xa hon, van kich hoat DUNG gio nhu chi co 1 luot", () => {
  const wd = createMuteWatchdog({ thresholdMs: 1000 });
  wd.onCustomerTurn(0);
  // Khach noi THEM 2 lan nua trong luc cho (t=300, t=600) - truoc day se lam
  // dong ho RESET ve 300+1000=1300 hoac 600+1000=1600 (SAI, ban cu tung lam
  // vay) - nay PHAI KHONG anh huong gi ca.
  wd.onCustomerTurn(300);
  wd.onCustomerTurn(600);
  assert.equal(wd.checkWatchdog(999), false, "chua du nguong tinh tu luot DAU TIEN (t=0)");
  assert.equal(wd.checkWatchdog(1000), true, "phai kich hoat DUNG t=1000 (tinh tu luot dau tien), KHONG PHAI t=1600");
});

test("mute watchdog: dang co module nghiep vu BAN (isBusy true suot) - khong bao gio kich hoat du qua nguong nhieu lan", () => {
  let busy = true;
  const wd = createMuteWatchdog({ thresholdMs: 1000, isBusy: () => busy });
  wd.onCustomerTurn(0);
  for (let t = 0; t <= 10000; t += 500) {
    assert.equal(wd.checkWatchdog(t), false, `dang ban, khong duoc kich hoat tai t=${t}`);
  }
});

test("mute watchdog: BAN mot khoang roi RANH - dem lai TU LAN checkWatchdog() dau tien phat hien het ban, khong tinh luon thoi gian da ban", () => {
  let busy = true;
  const wd = createMuteWatchdog({ thresholdMs: 1000, isBusy: () => busy });
  wd.onCustomerTurn(0);
  assert.equal(wd.checkWatchdog(5000), false, "van dang ban");
  busy = false;
  // [poll-based - xem chu thich watchdogs.js] watchdog CHI biet "het ban" tai
  // LAN checkWatchdog() KE TIEP no duoc goi (khong co timestamp rieng cho luc
  // isBusy() doi gia tri) - neo dem tu DUNG lan poll nay (t=5100), khong phai
  // tu thoi diem "that" bien `busy` doi gia tri (t=5000).
  assert.equal(wd.checkWatchdog(5100), false, "vua phat hien het ban tai t=5100 - bat dau dem tu day");
  assert.equal(wd.checkWatchdog(6099), false, "chua du 1000ms ke tu t=5100");
  assert.equal(wd.checkWatchdog(6100), true, "du 1000ms ke tu luc phat hien het ban (t=5100)");
});

test("mute watchdog: sau khi kich hoat 1 lan ma bot VAN khong dap - kich hoat LAI sau 1 chu ky nguong nua (khong bo cuoc sau 1 lan)", () => {
  const wd = createMuteWatchdog({ thresholdMs: 1000 });
  wd.onCustomerTurn(0);
  assert.equal(wd.checkWatchdog(1000), true, "lan kich hoat thu nhat");
  // Ben goi (gia lap) ep tra loi nhung THAT BAI (bug nang hon, bot van im) -
  // KHONG goi onBotSpoke(). Watchdog phai tu dat lai chu ky moi.
  assert.equal(wd.checkWatchdog(1500), false, "chua du 1 chu ky moi ke tu lan kich hoat truoc");
  assert.equal(wd.checkWatchdog(1999), false);
  assert.equal(wd.checkWatchdog(2000), true, "lan kich hoat thu hai, dung 1000ms sau lan dau");
});

test("mute watchdog: bot noi xong - tat trang thai 'chua tra loi', khong con gi de kich hoat cho toi luot khach MOI", () => {
  const wd = createMuteWatchdog({ thresholdMs: 1000 });
  wd.onCustomerTurn(0);
  wd.onBotSpoke(1000); // dap DUNG luc het nguong - khong duoc tinh la tre
  assert.equal(wd.checkWatchdog(1000), false, "bot da dap - khong kich hoat");
  assert.equal(wd.checkWatchdog(5000), false, "van khong co gi de kich hoat, khong co luot khach moi");

  // Luot khach MOI sau do - watchdog phai hoat dong lai binh thuong.
  wd.onCustomerTurn(5000);
  assert.equal(wd.checkWatchdog(5999), false);
  assert.equal(wd.checkWatchdog(6000), true, "luot khach MOI, bot chua dap - kich hoat dung nhu binh thuong");
});

test("mute watchdog: getDebugState() phan anh dung trang thai noi bo", () => {
  const wd = createMuteWatchdog({ thresholdMs: 1000 });
  assert.deepEqual(wd.getDebugState(), { lastCustomerTurnAt: null, lastBotSpokeAt: null, idleAnchorMs: null });
  wd.onCustomerTurn(100);
  wd.checkWatchdog(100);
  assert.deepEqual(wd.getDebugState(), { lastCustomerTurnAt: 100, lastBotSpokeAt: null, idleAnchorMs: 100 });
  wd.onBotSpoke(200);
  assert.deepEqual(wd.getDebugState(), { lastCustomerTurnAt: 100, lastBotSpokeAt: 200, idleAnchorMs: 100 }, "onBotSpoke KHONG tu xoa idleAnchorMs - phai cho lan checkWatchdog() ke tiep moi cap nhat");
  wd.checkWatchdog(200);
  assert.deepEqual(wd.getDebugState(), { lastCustomerTurnAt: 100, lastBotSpokeAt: 200, idleAnchorMs: null }, "sau checkWatchdog(), idleAnchorMs phai duoc xoa vi da 'answered'");
});

// ─── createVadRestoreWatchdog ───────────────────────────────────────────────

test("vad-restore watchdog: chua bao gio doi mode - khong bao gio kich hoat", () => {
  const wd = createVadRestoreWatchdog({ thresholdMs: 1000 });
  for (let t = 0; t <= 5000; t += 500) {
    assert.equal(wd.checkWatchdog(t), false);
  }
});

test("vad-restore watchdog: doi sang mode khoa, KHONG bao gio tra ve 'normal' - kich hoat DUNG luc dat nguong", () => {
  const wd = createVadRestoreWatchdog({ thresholdMs: 1000 });
  wd.onVadModeChanged("digits", 0);
  assert.equal(wd.checkWatchdog(999), false);
  assert.equal(wd.checkWatchdog(1000), true, "dat DUNG nguong - phai tu khoi phuc");
});

test("vad-restore watchdog: doi sang 'digits' roi CHU DONG tra ve 'normal' TRUOC nguong - khong bao gio kich hoat", () => {
  const wd = createVadRestoreWatchdog({ thresholdMs: 1000 });
  wd.onVadModeChanged("digits", 0);
  wd.onVadModeChanged("normal", 500);
  for (let t = 500; t <= 5000; t += 500) {
    assert.equal(wd.checkWatchdog(t), false, `da tra ve normal, khong duoc kich hoat tai t=${t}`);
  }
});

test("vad-restore watchdog: sau khi tu khoi phuc, doi sang 'digits' LAN NUA - vong chu ky moi hoat dong dung", () => {
  const wd = createVadRestoreWatchdog({ thresholdMs: 1000 });
  wd.onVadModeChanged("digits", 0);
  assert.equal(wd.checkWatchdog(1000), true, "chu ky dau");
  // wd.checkWatchdog(1000) da tu clear lockedSinceMs - neu KHONG co lan doi
  // mode moi, khong duoc kich hoat lai.
  assert.equal(wd.checkWatchdog(5000), false, "da tu khoi phuc roi, khong con gi de kich hoat");

  wd.onVadModeChanged("digits", 5000);
  assert.equal(wd.checkWatchdog(5999), false);
  assert.equal(wd.checkWatchdog(6000), true, "chu ky thu hai, dung 1000ms sau lan doi mode moi");
});

test("vad-restore watchdog: khong hardcode ten mode 'digits' - bat ky mode nao KHAC 'normal' cung bi coi la khoa", () => {
  const wd = createVadRestoreWatchdog({ thresholdMs: 1000 });
  wd.onVadModeChanged("mot-mode-tuong-lai-nao-do", 0);
  assert.equal(wd.checkWatchdog(1000), true, "mode la gi khong quan trong, khac 'normal' la bi coi la khoa");
});

test("vad-restore watchdog: getDebugState() phan anh dung trang thai noi bo", () => {
  const wd = createVadRestoreWatchdog({ thresholdMs: 1000 });
  assert.deepEqual(wd.getDebugState(), { lockedSinceMs: null, lockedMode: null });
  wd.onVadModeChanged("digits", 42);
  assert.deepEqual(wd.getDebugState(), { lockedSinceMs: 42, lockedMode: "digits" });
  wd.onVadModeChanged("normal", 100);
  assert.deepEqual(wd.getDebugState(), { lockedSinceMs: null, lockedMode: null });
});
