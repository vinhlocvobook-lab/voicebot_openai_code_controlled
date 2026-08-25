// src/call-flow/danh-bo-confirm-tool-flow.js
//
// Giai doan 6b, "Phuong an B" (xem docs/roadmap.md). Lop TICH HOP noi
// createReadbackMatcher()/resolveConfirmDanhBo() (danh-bo-readback-match.js,
// module THUAN, khong tu giu vong doi qua nhieu lan doc lai) vao dong tin
// hieu THAT cua 1 cuoc goi. Khac han danh-bo-flow.js (Giai doan 6a) o triet
// ly: CODE o day KHONG chu dong noi gi (khong say(), khong doi VAD mode) -
// MODEL tu quyet dinh khi nao doc lai/hoi xac nhan/goi tool, code CHI quan
// sat + doi chieu + cap nhat callState. Dung CHUNG hop dong callState.danhBo
// (string, chi ghi SAU KHI da xac nhan xong) voi resolve-danh-bo-ref.js cua
// Giai doan 6a - billing.js/outages.js/tickets.js KHONG can sua gi.
//
// THOI DIEM goi arm() (da thao luan + chot voi chu du an 25/08/2026, xem
// docs/roadmap.md muc "Giai doan 6b" - Cap nhat 25/08/2026 #3): MOI tin hieu
// "response-started" - KHONG con dieu kien callState.danhBo nua (xem sua
// duoi day). Khong doan truoc noi dung luot do co phai cau doc lai hay
// khong - neu khong phai, ket qua matcher don gian khong duoc dung toi
// (khong co tool-call nao theo sau de kich hoat resolveToolCall()).
//
// [SUA 25/08/2026, phat hien khi thiet ke buoc 5 - "moi lan goi tool tra
// cuu ke tiep deu doi chieu voi cache... khach co the hoi ve mot ma khac
// that trong cung cuoc goi"] Ban dau handleSignal() co dieu kien "chi theo
// doi khi callState.danhBo CHUA duoc set" - AN TOAN cho LAN XAC NHAN DAU
// TIEN nhung chan CHET moi lan doc lai SAU DO (vd khach hoi tiep ve 1 ma
// danh bo KHAC that trong cung cuoc goi): matcher se KHONG BAO GIO duoc
// nuoi tin hieu nua sau lan xac nhan dau, nen resolveToolCall() cho lan 2
// luon thay matcherResult=null -> tu choi SAI (dang le phai xac nhan duoc
// binh thuong). Sua: bo dieu kien do - handleSignal() LUON theo doi (chi
// ton it CPU/memory tao lai matcher moi lan response-started, khong anh
// huong nghiep vu vi ket qua don gian khong duoc dung toi neu khong co
// tool-call theo sau). resolveToolCall() van la noi DUY NHAT ghi callState.
// danhBo, LUON ghi de (khong so sanh "khac cache" o day - dung dinh dung
// don gian nhat, xem ghi chu o resolveToolCall).
//
// XU LY 2 LOAI "response-started" KHAC NHAU (diem tinh te nhat cua module
// nay - de sai se XOA MAT du lieu khach vua tra loi):
//   1. response-started ma matcher HIEN TAI CHUA gom duoc item nao cua khach
//      (matcher.getItemIds().length === 0) VA CHUA "stopped" -> day la 1
//      LUOT NOI MOI cua AI TRUOC KHI khach kip tra loi gi (lan dau, hoac AI
//      noi tiep nhieu cau lien tiep) - TAO matcher MOI (bo matcher cu di,
//      chua co gi dang gia de mat), CHUA arm() ngay (se arm() khi thay tin
//      hieu "ai-said" cua chinh luot nay).
//   2. response-started ma matcher DA gom it nhat 1 item cua khach (khach da
//      tra loi tu sau lan arm() gan nhat) -> day la luot AI dang PHAN HOI
//      lai cau khach vua noi (co the la luot chua tool-call) - CHUYEN tiep
//      cho matcher.handleSignal() de no tu dat "stopped" (dung diem dung DA
//      duoc probe xac nhan that, xem danh-bo-readback-match.js), KHONG duoc
//      tao matcher moi o day (se xoa mat du lieu khach vua tra loi).
//
// "ai-said" cung can phan biet TUONG TU: chi coi la 1 manh cua CAU DOC LAI
// (goi arm() voi text noi tiep) khi matcher CHUA gom item nao cua khach VA
// CHUA stopped (dang trong luot doc lai, co the co ca commentary+final) -
// ai-said den SAU khi matcher da stopped (vd loi noi kem theo tool-call)
// KHONG duoc dung de arm() lai (se xoa mat du lieu vua gom).
//
// Buoc 2 (dung lai isAffirmative(), danh-bo-confirm.js - xem chu thich dau
// danh-bo-readback-match.js) o day, KHONG phai trong resolveConfirmDanhBo()
// (ham do CHI so sanh toolValue voi so trich tu cau AI doc lai, KHONG biet
// gi ve viec khach co that su xac nhan hay khong). Neu model goi tool nhung
// khach CHUA xac nhan ro rang (vd tra loi mo ho, hoac model goi som/hieu
// nham) -> TU CHOI, coi la "khong ket luan duoc" (buoc 6 - placeholder DON
// GIAN o day, hoi lai 1 cau ngan, CHUA co dem so lan/leo thang DTMF - phu
// thuoc watchdog Giai doan 7, chua co, ghi ro trong docs/roadmap.md).
import { createReadbackMatcher, resolveConfirmDanhBo } from "./danh-bo-readback-match.js";
import { isAffirmative } from "./danh-bo-confirm.js";

const UNCLEAR_MESSAGE =
  "Dạ, em chưa xác nhận được rõ ràng, Quý Khách vui lòng xác nhận lại giúp em mã danh bộ vừa đọc có đúng không ạ.";

export function createDanhBoConfirmToolFlow({ callState, log = () => {} } = {}) {
  let matcher = createReadbackMatcher();

  function handleSignal(signal) {
    if (!signal || typeof signal.kind !== "string") return;
    // [SUA 25/08/2026] KHONG con dieu kien callState.danhBo o day - xem
    // chu thich dau file (can theo doi CA SAU khi da xac nhan 1 lan, de ho
    // tro dung khach hoi ve ma danh bo KHAC trong cung cuoc goi).

    if (signal.kind === "response-started") {
      if (matcher.getItemIds().length === 0 && !matcher.isStopped()) {
        matcher = createReadbackMatcher();
      } else {
        matcher.handleSignal(signal);
      }
      return;
    }

    if (signal.kind === "ai-said") {
      if (matcher.getItemIds().length === 0 && !matcher.isStopped()) {
        const existing = matcher.getReadbackText();
        matcher.arm(existing ? `${existing} ${signal.text}` : signal.text);
      }
      return;
    }

    matcher.handleSignal(signal);
  }

  // Dang ky vao tool-router.js voi ten "confirm_danh_bo" - KHOP dung hinh
  // dang handler ma dispatch-tool-call.js dang can: (args) => output (args
  // DA duoc JSON.parse san, xem dispatch-tool-call.js dau file). KHONG dung
  // resolveDanhBoRef/callState.danhBo lam nguon cho `value` - `value` LUON
  // lay tu chinh tool-call model gui (args.value), chi DOI CHIEU/GHI DE
  // bang so trich tu cau AI doc lai, dung thiet ke buoc 3-4 cua roadmap.
  //
  // Buoc 5 (cache + doi chieu lan sau): LUON GHI DE callState.danhBo khi
  // xac nhan thanh cong (khong so sanh "co khac cache cu khong" o day) -
  // dinh dung DON GIAN NHAT dap ung dung yeu cau roadmap ("khach co the hoi
  // ve mot ma danh bo KHAC that trong cung cuoc goi" - lan xac nhan MOI
  // nhat luon la nguon dung cho cac tool tra cuu KE TIEP, vi resolve-danh-
  // bo-ref.js luon doc callState.danhBo TAI THOI DIEM goi, khong cache rieng
  // o dau khac). Khong can canh bao "khac cache cu" - doi mot ma danh bo
  // trong luc dang tra cuu la hanh vi HOP LE cua khach, khong phai bat thuong.
  function resolveToolCall(args) {
    const value = args?.value ?? null;
    const aiReadbackText = matcher.getReadbackText() ?? "";
    const matcherResult = matcher.getResult();

    // Buoc 2: khach co THAT SU xac nhan ro rang khong - KHONG suy tu viec
    // model co goi tool hay khong (model co the goi som/hieu nham).
    if (!matcherResult || !isAffirmative(matcherResult.text)) {
      log(
        "warn",
        `danh-bo-confirm-tool-flow: model goi confirm_danh_bo nhung CHUA co bang chung khach xac nhan ro rang ` +
          `(matcherResult=${JSON.stringify(matcherResult)}) - tu choi, coi la "khong ket luan duoc".`,
      );
      matcher = createReadbackMatcher();
      return { success: false, error_code: "DANH_BO_CONFIRM_UNCLEAR", message: UNCLEAR_MESSAGE };
    }

    const resolved = resolveConfirmDanhBo({ toolValue: value, aiReadbackText });
    matcher = createReadbackMatcher(); // luon reset - khong de state cu lan sang lan doc lai ke tiep

    if (resolved.status === "unclear") {
      log(
        "warn",
        `danh-bo-confirm-tool-flow: khong trich duoc du 11 so ro rang tu cau AI doc lai ("${aiReadbackText}") - chua ket luan duoc.`,
      );
      return { success: false, error_code: "DANH_BO_CONFIRM_UNCLEAR", message: UNCLEAR_MESSAGE };
    }

    if (resolved.status === "override") {
      log(
        "warn",
        `danh-bo-confirm-tool-flow: gia tri tool ("${value}") LECH voi so trich tu cau AI doc lai ("${resolved.value}") ` +
          `- dung so DA DOC LAI (khong dung gia tri tool), bao lai cho model qua tool result.`,
      );
    } else {
      log("info", `danh-bo-confirm-tool-flow: khop dung - chot ma danh bo ${resolved.value}`);
    }

    callState.danhBo = resolved.value;
    return {
      success: true,
      ma_danh_bo: resolved.value,
      message:
        resolved.status === "override"
          ? `Dạ, hệ thống đã ghi nhận đúng mã danh bộ Quý Khách vừa xác nhận là ${resolved.value}, em dùng số này để tra cứu nhé.`
          : "Dạ, hệ thống đã xác nhận mã danh bộ.",
    };
  }

  return {
    handleSignal,
    resolveToolCall,
    // Tien ich cho test/log - KHONG dung trong production logic.
    getDebugState: () => ({
      armed: matcher.isArmed(),
      stopped: matcher.isStopped(),
      itemIds: matcher.getItemIds(),
      readbackText: matcher.getReadbackText(),
      result: matcher.getResult(),
    }),
  };
}
