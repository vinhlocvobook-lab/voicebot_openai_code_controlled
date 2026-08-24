// test/danh-bo-flow.test.mjs
//
// Giai doan 6a (xem docs/roadmap.md). Test cho src/call-flow/danh-bo-flow.js
// bang setVadMode/say/onDone GIA (khong can WS/API that) + nowMs tu truyen
// vao tay (khong dung Date.now()/timer that - giu dung quy uoc pure-testable
// cua du an). Nhieu case duoi day mo phong DUNG "cua so ho hong" da do that
// bang scripts/probe-danh-bo-vad.mjs (xem ghi chu dau danh-bo-flow.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDanhBoFlow } from "../src/call-flow/danh-bo-flow.js";
import { danhBoSpoken } from "../src/call-flow/danh-bo-collect.js";

// [them 24/08/2026] Dung DUNG chuoi GIVE_UP_TEXT khong export tu module
// nguon (co y, giu private) - khai bao lai o day CHINH XAC tung chu de doi
// chieu, giong cach ASK_PROMPT/UNCLEAR_CONFIRM_INSTRUCTIONS da lam ngam qua
// cac assert.equal(...text) ben duoi truoc do (khong co bien rieng).
const GIVE_UP_TEXT =
  "Dạ, em xin lỗi, em chưa xác nhận được mã danh bộ của Quý Khách. Để em chuyển máy cho nhân viên hỗ trợ giúp mình nhé.";

function createHarness(opts = {}) {
  const vadModes = [];
  const sayCalls = [];
  const doneCalls = [];
  const logs = [];
  const flow = createDanhBoFlow({
    setVadMode: (mode) => vadModes.push(mode),
    say: (payload) => sayCalls.push(payload),
    onDone: (result) => doneCalls.push(result),
    log: (level, msg) => logs.push({ level, msg }),
    ...opts,
  });
  return { flow, vadModes, sayCalls, doneCalls, logs };
}

const CANDIDATE = "22023251775";
const SPOKEN = danhBoSpoken(CANDIDATE);

function armAndAsk(flow, nowMs = 0) {
  flow.start("test", nowMs);
  flow.handleSignal({ kind: "session-updated" }, nowMs + 1);
}

test("start(): chuyen sang 'arming', goi setVadMode('digits') va say() moi doc so", () => {
  const { flow, vadModes, sayCalls } = createHarness();
  flow.start("khach hoi hoa don, chua co danh bo", 0);

  assert.equal(flow.getPhase(), "arming");
  assert.deepEqual(vadModes, ["digits"]);
  assert.equal(sayCalls.length, 1);
  assert.equal(sayCalls[0].mode, "verbatim");
});

test("arming: transcript-ready toi TRUOC session-updated bi BO QUA hoan toan " +
  "(regression - dung cua so ho hong da do that ~200-250ms, xem dau file)", () => {
  const { flow } = createHarness();
  flow.start("test", 0);
  assert.equal(flow.getPhase(), "arming");

  // Tin hieu "tre" tu che do "normal" cu, den truoc khi digits mode kip ap
  // dung - PHAI bi bo qua, khong duoc tinh la khach dang doc so.
  flow.handleSignal({ kind: "transcript-ready", itemId: "item_x", text: "2202" }, 10);
  assert.equal(flow.getPhase(), "arming", "van con o arming, transcript tre khong duoc xu ly");
  assert.equal(flow.getCandidate(), null);

  flow.handleSignal({ kind: "session-updated" }, 250);
  assert.equal(flow.getPhase(), "asking", "session-updated moi thuc su mo cong 'asking'");
});

test("asking: gom nhieu manh transcript-ready (VAD tach lam nhieu doan) cho ra dung candidate", () => {
  const { flow, sayCalls } = createHarness();
  armAndAsk(flow);

  flow.handleSignal({ kind: "transcript-ready", text: "2202" }, 100);
  assert.equal(flow.getPhase(), "asking");
  flow.handleSignal({ kind: "transcript-ready", text: "3251" }, 200);
  assert.equal(flow.getPhase(), "asking");
  flow.handleSignal({ kind: "transcript-ready", text: "775" }, 300);

  assert.equal(flow.getPhase(), "confirming");
  assert.equal(flow.getCandidate(), CANDIDATE);
  // Vua chuyen sang confirming phai lap tuc doc lai xin xac nhan.
  const lastSay = sayCalls[sayCalls.length - 1];
  assert.equal(lastSay.mode, "verbatim");
  assert.ok(lastSay.text.includes(SPOKEN), "cau xac nhan phai chua dung day so da doc tung chu");
});

test("asking: transcript khong phai so (vd tap am duoc STT dich lung tung) khong lam hong session, chi khong cong them so", () => {
  const { flow } = createHarness();
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: "dạ alo" }, 100);
  assert.equal(flow.getPhase(), "asking");
  assert.equal(flow.getCandidate(), null);
});

test("confirming: khach xac nhan DUNG -> phase 'done', onDone({ok:true, danhBo})", () => {
  const { flow, doneCalls, vadModes } = createHarness();
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);
  assert.equal(flow.getPhase(), "confirming");

  flow.handleSignal({ kind: "transcript-ready", text: "Dạ đúng rồi ạ" }, 200);

  assert.equal(flow.getPhase(), "done");
  assert.deepEqual(doneCalls, [{ ok: true, danhBo: CANDIDATE }]);
  // Thanh cong KHONG tu doi VAD ve "normal" - de ben goi (co the can goi
  // API tra cuu ngay) tu quyet dinh (xem ghi chu trong danh-bo-flow.js).
  assert.deepEqual(vadModes, ["digits"]);
});

test("confirming: khach bao SAI -> reset session, quay lai 'asking', doc lai loi moi", () => {
  const { flow, sayCalls } = createHarness();
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);
  const sayCountBeforeNo = sayCalls.length;

  flow.handleSignal({ kind: "transcript-ready", text: "không đúng ạ" }, 200);

  assert.equal(flow.getPhase(), "asking");
  assert.equal(flow.getCandidate(), null, "session phai duoc RESET, khong giu lai so cu");
  assert.equal(sayCalls.length, sayCountBeforeNo + 1);
  assert.equal(sayCalls[sayCalls.length - 1].text, "Dạ, Quý Khách vui lòng đọc giúp em mã danh bộ gồm 11 chữ số ạ.");
});

test("confirming: khach xin nhac lai -> say() lai DUNG cau xac nhan cu, session KHONG doi", () => {
  const { flow, sayCalls } = createHarness();
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);
  const confirmSay = sayCalls[sayCalls.length - 1];

  flow.handleSignal({ kind: "transcript-ready", text: "bạn nhắc lại giúp mình với" }, 200);

  assert.equal(flow.getPhase(), "confirming");
  assert.equal(flow.getCandidate(), CANDIDATE);
  const repeatSay = sayCalls[sayCalls.length - 1];
  assert.deepEqual(repeatSay, confirmSay, "phai la DUNG cau xac nhan cu, khong doi noi dung");
});

test("confirming: khach doc lai 1 day so MOI (khong noi dung/sai ro rang) -> coi la bat dau lai voi so moi", () => {
  const { flow } = createHarness();
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);
  assert.equal(flow.getPhase(), "confirming");

  const soMoi = "22023251999";
  flow.handleSignal({ kind: "transcript-ready", text: soMoi }, 200);

  assert.equal(flow.getPhase(), "confirming", "du 11 so ngay trong 1 manh -> chuyen thang sang confirming lai");
  assert.equal(flow.getCandidate(), soMoi);
});

test("confirming: khach doc lai so moi nhung CHUA DU 11 so trong manh nay -> quay ve 'asking' de gom tiep", () => {
  const { flow } = createHarness();
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);

  flow.handleSignal({ kind: "transcript-ready", text: "2202" }, 200);

  assert.equal(flow.getPhase(), "asking");
  assert.equal(flow.getCandidate(), null);
});

test("confirming: cau tra loi khong ro rang -> say(mode:'guided') hoi lai, KHONG reset session", () => {
  const { flow, sayCalls } = createHarness();
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);

  flow.handleSignal({ kind: "transcript-ready", text: "em muốn hỏi thêm về định mức nước" }, 200);

  assert.equal(flow.getPhase(), "confirming");
  assert.equal(flow.getCandidate(), CANDIDATE, "session khong bi reset khi cau tra loi khong ro rang");
  assert.equal(sayCalls[sayCalls.length - 1].mode, "guided");
});

test("qua nguong maxAttempts (mac dinh 3) lien tiep bao SAI -> 'failed', VAD tra ve 'normal', onDone({ok:false}), " +
  "VA tu noi 1 cau xin loi + de nghi chuyen may (khong im lang ngo cut - them 24/08/2026)", () => {
  const { flow, doneCalls, vadModes, sayCalls } = createHarness();
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);

  flow.handleSignal({ kind: "transcript-ready", text: "sai rồi" }, 200); // lan 1
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 300);
  flow.handleSignal({ kind: "transcript-ready", text: "sai rồi" }, 400); // lan 2
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 500);
  flow.handleSignal({ kind: "transcript-ready", text: "sai rồi" }, 600); // lan 3
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 700);
  flow.handleSignal({ kind: "transcript-ready", text: "sai rồi" }, 800); // lan 4 -> vuot nguong

  assert.equal(flow.getPhase(), "failed");
  assert.deepEqual(doneCalls, [{ ok: false, reason: "qua so lan khach bao sai" }]);
  assert.deepEqual(vadModes, ["digits", "normal"], "failed PHAI tu tra VAD ve 'normal'");
  const lastSay = sayCalls[sayCalls.length - 1];
  assert.deepEqual(lastSay, { mode: "verbatim", text: GIVE_UP_TEXT }, "giveUp() phai tu say() 1 cau xin loi, khong im lang ngo cut");
});

test("maxAttempts tuy chinh duoc qua opts", () => {
  const { flow, doneCalls, sayCalls } = createHarness({ maxAttempts: 1 });
  armAndAsk(flow);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);
  flow.handleSignal({ kind: "transcript-ready", text: "sai rồi" }, 200); // lan 1, con trong nguong
  assert.equal(flow.getPhase(), "asking");
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 300);
  flow.handleSignal({ kind: "transcript-ready", text: "sai rồi" }, 400); // lan 2, vuot nguong=1

  assert.equal(flow.getPhase(), "failed");
  assert.equal(doneCalls.length, 1);
  assert.equal(sayCalls[sayCalls.length - 1].text, GIVE_UP_TEXT);
});

test("checkWatchdog: khong lam gi khi con trong han", () => {
  const { flow, doneCalls } = createHarness({ watchdogMs: 90000 });
  armAndAsk(flow, 0);
  flow.checkWatchdog(89999);
  assert.equal(flow.getPhase(), "asking");
  assert.equal(doneCalls.length, 0);
});

test("checkWatchdog: het han -> 'failed', VAD tra ve 'normal', onDone({ok:false}), tu say() cau xin loi", () => {
  const { flow, doneCalls, vadModes, sayCalls } = createHarness({ watchdogMs: 90000 });
  armAndAsk(flow, 0); // session-updated luc nowMs=1 -> lastActivityAtMs=1

  flow.checkWatchdog(90001);

  assert.equal(flow.getPhase(), "failed");
  assert.deepEqual(vadModes, ["digits", "normal"]);
  assert.equal(doneCalls.length, 1);
  assert.equal(doneCalls[0].ok, false);
  assert.match(doneCalls[0].reason, /watchdog/);
  assert.equal(sayCalls[sayCalls.length - 1].text, GIVE_UP_TEXT, "watchdog cung la 1 dang bo cuoc, phai qua giveUp() nen cung phai xin loi");
});

test("checkWatchdog: hoat dong (transcript-ready) RESET dong ho, khong bi tinh don tu luc start", () => {
  const { flow, doneCalls } = createHarness({ watchdogMs: 90000 });
  armAndAsk(flow, 0); // lastActivityAtMs = 1

  flow.handleSignal({ kind: "transcript-ready", text: "2202" }, 60000); // reset ve 60000
  flow.checkWatchdog(140000); // 140000 - 60000 = 80000 < 90000 -> chua het han

  assert.equal(flow.getPhase(), "asking");
  assert.equal(doneCalls.length, 0);
});

test("checkWatchdog: khong lam gi khi dang idle/done/failed", () => {
  const { flow, doneCalls } = createHarness({ watchdogMs: 100 });
  flow.checkWatchdog(999999); // van dang idle
  assert.equal(doneCalls.length, 0);

  armAndAsk(flow, 0);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 10);
  flow.handleSignal({ kind: "transcript-ready", text: "đúng rồi" }, 20); // -> done
  assert.equal(flow.getPhase(), "done");

  flow.checkWatchdog(999999); // da done, khong duoc bien thanh failed
  assert.equal(flow.getPhase(), "done");
  assert.equal(doneCalls.length, 1);
});

test("start() goi lai trong luc dang chay (arming/asking/confirming) bi bo qua, khong lam mat state dang co", () => {
  const { flow, vadModes } = createHarness();
  armAndAsk(flow, 0);
  flow.handleSignal({ kind: "transcript-ready", text: "2202" }, 100);

  flow.start("goi nham lan 2", 200);

  assert.equal(flow.getPhase(), "asking", "khong bi reset ve arming");
  assert.equal(vadModes.length, 1, "khong goi setVadMode them lan nao");
});

test("start() lai sau khi 'done' hoac 'failed' hoat dong binh thuong (phien MOI)", () => {
  const { flow, vadModes, doneCalls } = createHarness();
  armAndAsk(flow, 0);
  flow.handleSignal({ kind: "transcript-ready", text: CANDIDATE }, 100);
  flow.handleSignal({ kind: "transcript-ready", text: "đúng rồi" }, 200);
  assert.equal(flow.getPhase(), "done");

  flow.start("lan tra cuu thu hai trong cung cuoc goi", 300);

  assert.equal(flow.getPhase(), "arming");
  assert.equal(flow.getCandidate(), null, "session cu phai duoc xoa het");
  assert.deepEqual(vadModes, ["digits", "digits"]);
  assert.equal(doneCalls.length, 1, "onDone cua lan truoc khong bi goi lai");
});
