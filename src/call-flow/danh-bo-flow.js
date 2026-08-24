// src/call-flow/danh-bo-flow.js
//
// Giai doan 6a (xem docs/roadmap.md). State machine DUY NHAT dieu phoi viec
// CODE chu dong thu thap + xac nhan ma danh bo qua giong noi - thay 3
// watchdog/co doc lap, khong dong bo cua ban cu (nguyen nhan nhieu loi that
// da nghien cuu, xem docs/roadmap.md "Giai doan 6a"). Noi CAC MANH da
// viet/test rieng lai voi nhau:
//   - session-ws.js#setVadMode (Giai doan 6a) - doi VAD sang "digits".
//   - turn-controller.js#say (Giai doan 3) - noi, DA CO SAN co che
//     generation/queue giai quyet 3 loai race (khong can viet lai
//     _speakVerbatim cua ban cu - xem turn-controller.js dau file).
//   - danh-bo-collect.js (Giai doan 6a) - gom/chuan hoa chu so.
//   - danh-bo-confirm.js (Giai doan 6a) - phan loai xac nhan/tu choi/xin
//     nhac lai.
//
// 5 trang thai (`phase`, xem getPhase()): idle -> arming -> asking ->
// confirming -> done | failed.
//   - idle: chua chay. start() de bat dau.
//   - arming: vua goi setVadMode("digits") + say() moi doc so - CHUA xu ly
//     transcript-ready nao ca, cho tin hieu "session-updated" (turn-
//     signal.js) xac nhan cau hinh THAT SU da ap dung o server. Xem ly do
//     bat buoc o phan "CAN CU THUC NGHIEM" duoi day - day la trang thai
//     MOI, ban cu KHONG CO, dung de chan mot bug that.
//   - asking: dang gom chu so tu nhieu transcript-ready (VAD van tach lam
//     nhieu manh - xem danh-bo-collect.js). Du 11 so -> tu chuyen confirming.
//   - confirming: da doc lai xin xac nhan (say mode verbatim). Cho khach
//     tra loi: dung/sai/xin nhac lai/doc lai so moi/khong ro rang.
//   - done: thanh cong, onDone({ok:true, danhBo}) da duoc goi.
//   - failed: bo cuoc (het luot thu hoac watchdog het han),
//     onDone({ok:false, reason}) da duoc goi, VAD da tra ve "normal".
//
// CAN CU THUC NGHIEM THAT (khong doan - xem docs/fix/
// giai_doan_1_quan_sat_event_that_20260820.md va ket qua
// scripts/probe-danh-bo-vad.mjs chay that 24/08/2026, ca 3 file test):
//   - create_response:false o "digits" mode hoat dong DUNG (0/3 lan co
//     response.created tu VAD, ke ca khi co tinh phat audio NGAY khong doi
//     xac nhan) - khong can gate rieng cho rui ro nay.
//   - VAD (ban cu Giai doan 1 do ca semantic_vad lan server_vad) VAN tach 1
//     luot doc thanh nhieu manh (2/3 file test o day cung bi tach 2 manh) -
//     BAT BUOC gom nhieu transcript-ready, khong duoc coi "1 lan gom = 1
//     cau tra loi day du" (dung thiet ke danh-bo-collect.js da co).
//   - Co "cua so ho hong" ~200-250ms giua luc goi setVadMode("digits") va
//     luc session.updated ve xac nhan da ap dung xong (do that o 3/3 lan
//     chay). Ban cu tung gap DUNG lop bug nay (fix_migrate_gpt_realtime_21_
//     20260730.md, dot 15, 04/08/2026: model tra loi SAI dung trong cua so
//     do, bi hieu nham la khach phu dinh, khoa chet VINH VIEN 1 ma danh bo
//     DUNG that) - CHUA TUNG duoc sua tan goc o ban cu (chi vá hau qua).
//     Trang thai "arming" o day chan TAN GOC: khong tin bat ky tin hieu nao
//     la "khach dang doc so" cho toi khi co session-updated.
//   - KHONG mo khoa create_response cho buoc xac nhan (khac "unlocked"/
//     "confirm_tool" ban cu tung thu nghiem). "unlocked" tung lam SAP 1
//     cuoc goi that tren DUNG model dang dung (gpt-realtime-2.1-mini) -
//     model tu goi tool voi so bia khi moi nghe 4/11 so. "confirm_tool"
//     chua tung duoc xac nhan bang cuoc goi that (chi thiet ke, khong co
//     ket qua that). CODE (khong phai model) luon chu dong goi say() ca 2
//     giai doan asking VA confirming - khong thu nghiem lai 2 phuong an do.
//
// KHONG tu goi setTimeout/setInterval o day (giu dung quy uoc pure-testable
// da dung o session-ws.js/turn-controller.js) - watchdog dung mau
// checkWatchdog(nowMs) THUAN, ben goi (lop tich hop that, chua viet, se
// khong co unit test - giong connectRealtimeSession) tu dat 1 interval that
// goi ham nay dinh ky. moi `nowMs` deu do BEN GOI truyen vao (start(),
// handleSignal(), checkWatchdog()), khong tu doc Date.now() o day.
import {
  createDanhBoSession,
  noteDanhBoDigits,
  isDanhBoComplete,
  danhBoCandidate,
  danhBoDigitCount,
  danhBoSpoken,
  looksLikeDigitTurn,
  DANH_BO_LENGTH,
} from "./danh-bo-collect.js";
import { isAffirmative, isNegative, wantsRepeat } from "./danh-bo-confirm.js";

const ASK_PROMPT = "Dạ, Quý Khách vui lòng đọc giúp em mã danh bộ gồm 11 chữ số ạ.";

function buildConfirmPrompt(candidate) {
  return `Dạ, mã danh bộ của Quý Khách là ${danhBoSpoken(candidate)}. Quý Khách xác nhận giúp em có đúng không ạ?`;
}

const UNCLEAR_CONFIRM_INSTRUCTIONS =
  "Hỏi lại thật ngắn gọn xem Quý Khách xác nhận mã danh bộ vừa đọc lại là ĐÚNG hay CHƯA ĐÚNG, không hỏi gì thêm.";

export function createDanhBoFlow({
  setVadMode,
  say,
  onDone = () => {},
  watchdogMs = 90000,
  maxAttempts = 3,
  log = () => {},
} = {}) {
  let phase = "idle"; // idle | arming | asking | confirming | done | failed
  let session = null; // xem danh-bo-collect.js#createDanhBoSession
  let attempts = 0;
  let lastActivityAtMs = null;

  function askPrompt() {
    say({ mode: "verbatim", text: ASK_PROMPT });
  }

  function confirmPrompt() {
    say({ mode: "verbatim", text: buildConfirmPrompt(danhBoCandidate(session)) });
  }

  function giveUp(lyDo) {
    log("warn", `danh-bo-flow: bo cuoc (${lyDo})`);
    phase = "failed";
    setVadMode("normal");
    onDone({ ok: false, reason: lyDo });
  }

  function finish(candidate) {
    log("info", `danh-bo-flow: khach xac nhan DUNG - chot ma danh bo ${candidate}`);
    phase = "done";
    onDone({ ok: true, danhBo: candidate });
  }

  // Bat dau 1 lan thu thap MOI - reset toan bo state cu (khong tai su dung
  // session giua cac lan doc khac nhau, xem danh-bo-collect.js ve ly do).
  // Goi lai trong luc dang chay (arming/asking/confirming) la KHONG hop le
  // (chi 1 luong thu thap tai 1 thoi diem) - bi bo qua, co log canh bao.
  function start(reason, nowMs) {
    if (phase === "arming" || phase === "asking" || phase === "confirming") {
      log("warn", `danh-bo-flow: start() goi trong luc dang "${phase}" - bo qua`);
      return;
    }
    log("info", `danh-bo-flow: bat dau (${reason ?? "khong ro ly do"})`);
    session = createDanhBoSession();
    attempts = 0;
    lastActivityAtMs = nowMs;
    phase = "arming";
    setVadMode("digits");
    askPrompt();
  }

  function handleSignal(signal, nowMs) {
    if (!signal || typeof signal.kind !== "string") return;
    if (phase === "idle" || phase === "done" || phase === "failed") return;

    if (phase === "arming") {
      // MOI tin hieu khac (ke ca transcript-ready) trong luc "arming" BI BO
      // QUA CO Y - day chinh la cho chan bug that cua ban cu (xem "CAN CU
      // THUC NGHIEM" dau file), khong phai thieu sot.
      if (signal.kind === "session-updated") {
        phase = "asking";
        lastActivityAtMs = nowMs;
        log("info", "danh-bo-flow: VAD 'digits' da ap dung xong (session-updated) - bat dau nhan dien so");
      }
      return;
    }

    if (signal.kind !== "transcript-ready") return;
    lastActivityAtMs = nowMs;

    if (phase === "asking") {
      noteDanhBoDigits(session, signal.text);
      log("info", `danh-bo-flow: nhan them "${signal.text}" (${danhBoDigitCount(session)}/${DANH_BO_LENGTH} so)`);
      if (isDanhBoComplete(session)) {
        phase = "confirming";
        confirmPrompt();
      }
      return;
    }

    // phase === "confirming"
    const text = signal.text;

    if (looksLikeDigitTurn(text)) {
      // Khach doc lai 1 day so MOI thay vi tra loi co/khong - phan xa tu
      // nhien khi muon sua, KHONG PHAI mot trong ban cu (ban cu gan chat
      // voi tool model goi) - coi la bat dau lai tu dau voi chinh manh nay.
      log("info", "danh-bo-flow: khach doc lai 1 day so MOI giua luc cho xac nhan - coi la bat dau lai");
      attempts += 1;
      if (attempts > maxAttempts) return giveUp("qua so lan doc lai (doc so moi giua luc xac nhan)");
      session = createDanhBoSession();
      noteDanhBoDigits(session, text);
      if (isDanhBoComplete(session)) {
        phase = "confirming";
        confirmPrompt();
      } else {
        phase = "asking";
      }
      return;
    }

    if (isNegative(text)) {
      attempts += 1;
      if (attempts > maxAttempts) return giveUp("qua so lan khach bao sai");
      log("info", `danh-bo-flow: khach bao SAI (lan ${attempts}/${maxAttempts}) - doc lai tu dau`);
      session = createDanhBoSession();
      phase = "asking";
      askPrompt();
      return;
    }

    if (wantsRepeat(text)) {
      log("info", "danh-bo-flow: khach xin nhac lai cau xac nhan");
      confirmPrompt();
      return;
    }

    if (isAffirmative(text)) {
      finish(danhBoCandidate(session));
      return;
    }

    // Khong ro rang - hoi lai NGAN GON (mode "guided", KHONG reset session),
    // tinh vao chung 1 ngan sach attempts (don gian hoa co y - xem dau file).
    attempts += 1;
    if (attempts > maxAttempts) return giveUp("qua so lan khach tra loi khong ro rang");
    log("info", `danh-bo-flow: cau tra loi khong ro rang (lan ${attempts}/${maxAttempts}) - hoi lai`);
    say({ mode: "guided", instructions: UNCLEAR_CONFIRM_INSTRUCTIONS });
  }

  // Ben goi (lop tich hop that) tu dat 1 interval goi ham nay dinh ky voi
  // nowMs = Date.now() cua chinh no. Khong lam gi khi dang idle/done/failed.
  function checkWatchdog(nowMs) {
    if (phase !== "arming" && phase !== "asking" && phase !== "confirming") return;
    if (lastActivityAtMs === null) return;
    if (nowMs - lastActivityAtMs >= watchdogMs) {
      giveUp(`watchdog het han sau ${watchdogMs}ms khong co hoat dong`);
    }
  }

  return {
    start,
    handleSignal,
    checkWatchdog,
    getPhase: () => phase,
    getCandidate: () => (session ? danhBoCandidate(session) : null),
  };
}
