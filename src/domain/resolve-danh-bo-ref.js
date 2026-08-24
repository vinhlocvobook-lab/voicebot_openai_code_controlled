// src/domain/resolve-danh-bo-ref.js
//
// Giai doan 6a (xem docs/roadmap.md) - ban THAT, thay stub tam thoi cua
// Giai doan 5b. HOP DONG GIU NGUYEN dung nhu da hua (billing.js/outages.js/
// tickets.js KHONG doi gi ca, chi 1 dong import o tool-router.js da doi):
//   resolveDanhBoRef(rawArg, callState) ->
//     { ok: true, value: <string ma danh bo> }
//     hoac
//     { ok: false, error: <object, CHUA stringify - xem ghi chu tool-
//       router.js/dispatch-tool-call.js ve quy uoc nay> }
//
// [24/08/2026, quyet dinh cot loi cua Giai doan 6a] `rawArg` (gia tri model
// tu dien vao tham so tool) BI BO QUA HOAN TOAN - CHI tin callState.danhBo
// (chuoi 11 chu so, do danh-bo-flow.js ghi vao SAU KHI khach xac nhan bang
// loi that, hoac do he thong tra theo SDT gan san truoc cuoc goi - ca hai
// deu KHONG di qua "tai" model). Day la nguyen tac AN TOAN da duoc ca 2 du
// an (cu va moi) dong y qua bang chung THAT, khong phai suy doan:
//   - checkpoint-giai-doan-5b-audio.mjs (Giai doan 5b, 23/08/2026): model
//     nghe DUNG "2202 325 1775" nhung viet lai thanh "2203251775" (rot 1
//     so) roi TU TIN goi thang get_bill - neu tin rawArg, se tra nham du
//     lieu (may man cuoc nay CUSTOMER_NOT_FOUND vi so sai khong ton tai,
//     nhung khong the tin vao may man).
//   - fix_migrate_gpt_realtime_21_20260730.md (ban cu, dot "unlocked"
//     30/07/2026): model tu goi get_bill voi so BIA khi moi nghe 4/11 chu
//     so - lai xac nhan model KHONG dang tin de tu dien danh bo.
//   - Ban cu tu ghi nhan (cung tai lieu tren, muc "confirm_tool"): "do
//     chinh xac cua ma danh bo hoan toan KHONG phu thuoc viec model doc
//     lai dung hay sai" - vi resolveDanhBo LUON dung gia tri CODE da xac
//     minh (callState.danhBo.value ban cu), khong bao gio dung nhung gi
//     model tu noi/tu truyen. O day ap dung dung nguyen tac do tu dau,
//     manh hon: khong chi "khong dung khi da co", ma "khong bao gio doc
//     rawArg" - loai bo hoan toan duong hong nay thay vi chi khong ghi de.
//
// callState.danhBo la STRING (khong phai object {value,confirmed} nhu ban
// cu) - don gian hoa co y: chi mot minh danh-bo-flow.js (Giai doan 6a) ghi
// gia tri nay, VA CHI GHI SAU KHI khach da xac nhan bang loi that (xem
// isAffirmative, danh-bo-confirm.js) - khong con "ung vien chua xac nhan"
// nao can phan biet o tang callState nhu ban cu (co __danhBo.confirmed).
export function resolveDanhBoRef(rawArg, callState) {
  const known = callState?.danhBo;
  if (known) {
    return { ok: true, value: known };
  }
  return {
    ok: false,
    error: {
      success: false,
      error_code: "DANH_BO_MISSING",
      message: "Chưa có mã danh bộ, Quý Khách đọc giúp em ạ.",
    },
  };
}
