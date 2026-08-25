// src/session/watchdogs.js
//
// Giai doan 7 (xem docs/roadmap.md). Luoi an toan DUNG CHUNG cho ca cuoc goi,
// KHONG biet gi ve nghiep vu cu the (khac han danh-bo-flow.js#checkWatchdog -
// watchdog do la CUA RIENG khau thu thap danh bo, da lam xong o Giai doan 6a).
// 2 watchdog doc lap:
//   - createMuteWatchdog(): "bot quen tra loi" - khach vua noi mot luot THAT
//     ma bot chua he dap lai, VA khong co module nghiep vu nao dang chu dong
//     giu luot (xem "THIET KE isBusy" duoi day).
//   - createVadRestoreWatchdog(): "quen tra VAD ve 'normal'" - code chuyen
//     turn_detection sang mode khoa (hien tai chi co "digits", Giai doan 6a)
//     roi quen goi lai setVadMode("normal") o mot nhanh thoat nao do, khien
//     cuoc goi ket cung mai o mode khoa.
//
// KHONG tu goi setTimeout/setInterval o day - dung DUNG quy uoc
// checkWatchdog(nowMs) THUAN cua danh-bo-flow.js (xem chu thich dau file do):
// ben goi (lop tich hop that, chua viet o Giai doan nay) tu dat 1 interval
// that goi checkWatchdog() dinh ky, tu truyen Date.now() cua chinh no. Moi
// ham o day deu nhan `nowMs` tu ben ngoai, khong tu doc dong ho he thong -
// giu module test duoc bang dong ho gia, khong can cho thoi gian that.
//
// ─── THIET KE "isBusy" (da thao luan + chot voi chu du an 25/08/2026) ──────
// Van de can giai: khach co the (a) dang CHO bot tra loi luot truoc ("Alo? co
// nghe khong"), (b) dang NOI TIEP/bo sung cho luot truoc (VD dang doc so, VAD
// tach lam nhieu manh - xem danh-bo-collect.js), hoac (c) hoi sang chuyen
// khac - watchdog CHUNG nay KHONG the/KHONG NEN tu phan biet 3 truong hop do
// bang cach doan y qua noi dung transcript (de doan sai, va viec do THUOC VE
// lop nghiep vu, khong phai lop lươi an toan chung).
//
// Giai phap: watchdog KHONG tu suy luan gi ca - nhan 1 ham `isBusy()` duoc
// TRUYEN VAO tu ben goi (noi biet nhung module nghiep vu nao dang chay, vd
// `() => danhBoFlow.getPhase() !== "idle"`), CHI kiem tra ham do NGAY TAI
// THOI DIEM checkWatchdog() dang xet, giong HET co che DA CHUNG MINH DUNG cua
// ban cu (_muteWatchdogTimer callback tu doc `_toolCallState._danhBoVerifyRunning
// || _expectedSpeak` NGAY LUC HET GIO, khong phai module khac chu dong "bao"
// cho watchdog biet). Ly do CHON kieu "watchdog tu doc" (pull) thay vi "module
// khac tu bao" (push): push doi hoi MOI module nghiep vu phai nho goi ca
// markBusy() LAN markIdle() dung cho o MOI nhanh thoat - chi can 1 nhanh quen
// goi markIdle() la watchdog bi khoa "ban" VINH VIEN, tu tao ra dung LOAI BUG
// ma watchdog sinh ra de bat. Pull khong co rui ro do: watchdogs.js o day
// KHONG import bat ky module nghiep vu cu the nao (giu dung nguyen tac
// "watchdogs.js la luoi an toan CHUNG, khong lan nghiep vu") - ben goi tu
// COMPOSE ham isBusy() tu cac accessor DA CO SAN VA DA TEST (getPhase(),
// v.v.), khong can them 1 co "busy" song song moi module phai tu duy tri.
export function createMuteWatchdog({ thresholdMs = 15000, isBusy = () => false, log = () => {} } = {}) {
  let lastCustomerTurnAt = null; // nowMs cua lan "khach vua noi 1 luot THAT" gan nhat (xem onCustomerTurn)
  let lastBotSpokeAt = null; // nowMs cua lan bot vua noi gan nhat (xem onBotSpoke)
  // idleAnchorMs: moc thoi gian BAT DAU dem "im lang ma khong ai ban" - KHAC
  // lastCustomerTurnAt (xem "sua 25/08/2026" duoi day: KHONG duoc dong nhat 2
  // moc nay, day chinh la cho tung sai truoc khi chot thiet ke).
  let idleAnchorMs = null;

  // Goi moi khi co tin hieu "transcript-ready" (turn-signal.js) - khach vua
  // noi xong 1 luot THAT (ben goi tu loc bo transcript rong/nhieu, giong cach
  // ban cu da loc "prompt echo" truoc khi goi _armMuteWatchdog).
  //
  // [them 25/08/2026, phat hien khi tu viet test] Neu dang KHONG dem gi ca
  // (idleAnchorMs null) VA khong co gi ban - neo idleAnchorMs CHINH XAC vao
  // nowMs cua LUOT NAY (thoi diem khach THAT SU noi), KHONG doi checkWatchdog()
  // duoc poll lan ke tiep moi neo (se lam nguong bi TRE toi 1 chu ky poll,
  // vd poll moi 1s se lam mute watchdog 15s thanh ~15-16s tuy may man). Neu
  // dang ban, KHONG neo o day - de checkWatchdog() tu neo (xap xi nowMs cua
  // lan poll dau tien phat hien het ban, xem checkWatchdog duoi day) vi
  // isBusy() chi la 1 predicate, khong co timestamp rieng cho luc no doi gia
  // tri - day la muc do chinh xac TOT NHAT co the co duoc.
  function onCustomerTurn(nowMs) {
    lastCustomerTurnAt = nowMs;
    if (idleAnchorMs === null && !isBusy()) {
      idleAnchorMs = nowMs;
    }
  }

  // Goi moi khi bot THAT SU noi (vd tin hieu "response-started"/"ai-said",
  // hoac ngay luc turnController.say() duoc goi - ben goi tu chon diem chinh
  // xac, watchdog khong quan tam nguon nao, chi can biet "co tra loi roi").
  function onBotSpoke(nowMs) {
    lastBotSpokeAt = nowMs;
  }

  // [SUA 25/08/2026, phat hien qua thao luan voi chu du an - xem "THIET KE
  // isBusy" dau file] Ban dau (thiet ke dua tren nguyen ban ban cu) DINH dung
  // lai chinh xac co che _armMuteWatchdog() cua ban cu: MOI lan khach noi
  // (onCustomerTurn) deu RESET dong ho ve du "thresholdMs" tinh TU LUOT DO -
  // phat hien qua VI DU THAT chu du an dua ra: khach sot ruot hoi lai "Alo?
  // co nghe khong" giua luc cho SE TU DAY han chot ra XA HON (vd 15s ke tu
  // luot moi nhat), cang hoi nhieu cang phai cho lau hon - NGUOC hoan toan
  // trai giac nguoi dung, va la loi THAT da ke thua tu chinh ban cu (dong
  // 1700 session-ws.js cu goi _armMuteWatchdog() O MOI luot khach, kem
  // clearTimeout+resetTimeout tu dau). Sua: TACH RIENG `lastCustomerTurnAt`
  // (chi de biet "co dang cho tra loi khong", KHONG dung lam moc dem gio) voi
  // `idleAnchorMs` (moc THAT SU dung de dem nguong) - `idleAnchorMs` CHI duoc
  // dat lai khi TU "ban"/"chua ro rang" CHUYEN SANG "ranh + van chua tra loi"
  // (xem checkWatchdog duoi day), KHONG bi cac lan onCustomerTurn ke tiep day
  // lui. Ket qua: khach hoi lai bao nhieu lan cung KHONG lam han chot xa hon -
  // nguoc lai, vi lan hoi lai do CUNG la 1 "luot chua tra loi" nen dieu kien
  // "unanswered" van dung, dong ho idleAnchorMs (neu da dat va khong ban)
  // TIEP TUC chay, khong bi reset.
  function checkWatchdog(nowMs) {
    const unanswered = lastCustomerTurnAt !== null && (lastBotSpokeAt === null || lastBotSpokeAt < lastCustomerTurnAt);
    if (!unanswered) {
      idleAnchorMs = null; // bot da tra loi (hoac chua ai noi gi) - khong co gi de dem
      return false;
    }
    if (isBusy()) {
      // Co module nghiep vu dang chu dong giu luot (dang gom manh/dang goi
      // API...) - day KHONG PHAI bug, chi la CHUA toi luot bot noi.
      //
      // [sua 25/08/2026, PHAT HIEN THAT qua chinh test cua file nay -
      // test/watchdogs.test.mjs "BAN mot khoang roi RANH"] Ban dau dong nay
      // gan `idleAnchorMs = nowMs` (neo NGAY luc dang ban) - SAI: lam
      // idleAnchorMs dinh vao LAN POLL CUOI CUNG con dang ban (vd t=5000),
      // roi khi het ban o lan poll KE TIEP (vd t=5100), nhanh "idleAnchorMs
      // === null" duoi day KHONG con duoc kich hoat nua (vi idleAnchorMs da
      // la 5000, khac null) - khien nguong bi tinh SAI tu t=5000 (luc con
      // dang ban) thay vi tu t=5100 (luc THAT SU het ban), bat loi SOM hon
      // dung. Sua: dat NULL (khong phai nowMs) - de nhanh "idleAnchorMs ===
      // null" duoi day tu neo CHINH XAC vao lan poll dau tien phat hien het
      // ban, dung tinh than "chi biet duoc trang thai tai dung luc poll".
      idleAnchorMs = null;
      return false;
    }
    if (idleAnchorMs === null) {
      // Lan dau tien phat hien "ranh + van chua tra loi" - bat dau dem TU DAY.
      idleAnchorMs = nowMs;
      return false;
    }
    if (nowMs - idleAnchorMs >= thresholdMs) {
      log(
        "warn",
        `mute-watchdog: bot im lang >= ${thresholdMs}ms sau khi khach noi (khong co module nao dang ban) - kich hoat luoi an toan.`,
      );
      // [sua 25/08/2026, phat hien khi tu viet test] Neo LAI NGAY vao chinh
      // nowMs cua LAN BAN NAY (KHONG phai idleAnchorMs=null) - neu dat null,
      // phai doi checkWatchdog() duoc poll lan ke tiep moi neo lai (tre 1 chu
      // ky poll, giong ly do da sua o onCustomerTurn tren). Dung nowMs bay
      // gio (thoi diem CHINH XAC ta biet) dam bao neu ben goi ep tra loi ma
      // van that bai, lan kich hoat KE TIEP se cach lan nay DUNG thresholdMs,
      // khong bi tre thm boi chu ky poll.
      idleAnchorMs = nowMs;
      return true;
    }
    return false;
  }

  return {
    onCustomerTurn,
    onBotSpoke,
    checkWatchdog,
    getDebugState: () => ({ lastCustomerTurnAt, lastBotSpokeAt, idleAnchorMs }),
  };
}

// ─── VAD-restore watchdog ───────────────────────────────────────────────────
// Luoi an toan cho session-ws.js#setVadMode: neu 1 nhanh nao do chuyen sang
// mode khoa ("digits" - create_response:false, xem buildTurnDetectionConfig)
// roi QUEN goi lai setVadMode("normal"), cuoc goi se ket cung mai o mode khoa
// (model khong duoc tu noi, code cung khong con nho de mo lai). Watchdog nay
// KHONG biet ten mode cu the nao khac ngoai "normal" la mode "an toan"/mo -
// BAT KY mode nao KHAC "normal" deu bi coi la "khoa", dung tinh than "watchdog
// khong lan nghiep vu" (khong hardcode ten "digits").
export function createVadRestoreWatchdog({ thresholdMs = 90000, log = () => {} } = {}) {
  let lockedSinceMs = null; // null = dang o "normal" (hoac chua tung doi mode) - khong co gi de dem
  let lockedMode = null;

  // Goi moi khi setVadMode(mode) THAT SU duoc goi (ben goi tu wiring dung
  // diem nay - vd wrap quanh session-ws.js#setVadMode).
  function onVadModeChanged(mode, nowMs) {
    if (mode === "normal") {
      lockedSinceMs = null;
      lockedMode = null;
      return;
    }
    lockedSinceMs = nowMs;
    lockedMode = mode;
  }

  function checkWatchdog(nowMs) {
    if (lockedSinceMs === null) return false;
    if (nowMs - lockedSinceMs >= thresholdMs) {
      log(
        "warn",
        `vad-restore-watchdog: turn_detection kẹt ở mode "${lockedMode}" >= ${thresholdMs}ms - tự khôi phục "normal".`,
      );
      lockedSinceMs = null;
      lockedMode = null;
      return true;
    }
    return false;
  }

  return {
    onVadModeChanged,
    checkWatchdog,
    getDebugState: () => ({ lockedSinceMs, lockedMode }),
  };
}
