// src/domain/resolve-danh-bo-ref.js
//
// Giai doan 5b (xem docs/roadmap.md) - stub TAM THOI thay cho resolveDanhBo
// THAT (Giai doan 6, ban cu: voice_bot/src/tools.js#resolveDanhBo). Tin
// THANG gia tri model gui vao tool - KHONG xac thuc/gate/xac nhan gi ca.
// Muc dich DUY NHAT: cho domain handlers (billing.js, ...) viet va test
// duoc (unit test + checkpoint script voi ma danh bo gai cung) TRUOC KHI
// luong thu thap/xac nhan danh bo that (Giai doan 6 - VAD tach so, xac
// nhan, trong tai) xong - day la phase rui ro cao nhat nen tach domain
// layer ra lam truoc (da ban va chot voi chu du an 23/08/2026, xem
// docs/roadmap.md muc "Giai doan 5b").
//
// HOP DONG (BAT BUOC giu nguyen khi Giai doan 6 thay bang resolveDanhBo
// THAT - domain handler (vd billing.js) se chi doi 1 dong import, KHONG
// sua logic ben trong):
//   resolveDanhBoRef(rawArg, callState) ->
//     { ok: true, value: <string ma danh bo> }
//     hoac
//     { ok: false, error: <object, CHUA stringify - xem ghi chu duoi> }
//
// [khac ban cu, co y] Ban cu (resolveDanhBo that trong tools.js) tra ve
// `error` la 1 CHUOI JSON da stringify() san (khop voi quy uoc "tat ca
// output la string" cua toan bo tools.js cu). Kien truc MOI (xem
// dispatch-tool-call.js) di theo quy uoc NGUOC LAI: domain handler tra ve
// OBJECT THUONG, dispatch-tool-call.js la noi DUY NHAT goi
// JSON.stringify() (o bien gioi gui len OpenAI). Nen o day - va o
// resolveDanhBo THAT khi Giai doan 6 viet - `error` phai la OBJECT, khong
// phai chuoi, de khop quy uoc chung cua ca du an.
//
// callState NHAN VAO nhung KHONG dung o day - chi giu tham so de khop
// chu ky ham voi resolveDanhBo that (Giai doan 6 can callState de
// doc/ghi session xac nhan danh bo). Giu tham so nay tu bay gio de khi
// doi sang ham that, cac noi GOI (fetchBilling/handleCompareUsage trong
// billing.js) khong can sua chu ky goi ham.
//
// AN TOAN SAN XUAT: stub nay chi song trong nhanh
// giai-doan-5b-domain-handlers va cac unit test/checkpoint script cua no.
// Giai doan 9 (gate cutover ve ban moi) yeu cau TOAN BO roadmap - ke ca
// Giai doan 6 co gate xac nhan that - pass het truoc khi duoc phep thay
// ban cu dang chay that, nen stub "tin thang" nay khong bao gio dung toi
// khach hang that.
export function resolveDanhBoRef(rawArg, callState) {
  const value = String(rawArg ?? "").trim();
  if (!value) {
    return {
      ok: false,
      error: {
        success: false,
        error_code: "DANH_BO_MISSING",
        message: "Chưa có mã danh bộ, Quý Khách đọc giúp em ạ.",
      },
    };
  }
  return { ok: true, value };
}
