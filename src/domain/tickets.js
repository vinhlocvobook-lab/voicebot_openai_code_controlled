// src/domain/tickets.js
//
// Giai doan 5b (xem docs/roadmap.md) - port create_ticket tu ban cu
// (voice_bot/src/tools.js#handleCreateTicket) sang kien truc moi.
//
// GIU NGUYEN nghiep vu THAT (khong doan, port dung tu ban cu):
//   - Gop `loai` + `mo_ta` thanh 1 chuoi noi dung "[loai] mo_ta" (hoac
//     chi `mo_ta` neu khong co `loai`) roi gui len endpoint bao-su-co -
//     KHONG co endpoint rieng cho "tao phieu", dung chung endpoint bao su
//     co cua tongdai-api.js.
//   - Gui kem callState.callerPhone (so dien thoai nguoi goi that) lam
//     tham so `tel` cho baoSuCo - de nhan vien lien he lai dung so.
//
// KHAC ban cu (co y, giong billing.js/outages.js): handler tra ve OBJECT
// thuong, KHONG tu JSON.stringify().
//
// [luu y test that] baoSuCo la hanh dong CO TAC DONG THAT (tao phieu that
// trong he thong san xuat/test cua CNTA) - khac get_bill/get_outages (chi
// doc). KHONG goi baoSuCo THAT (qua tunnel) khi kiem chung file nay - chi
// dung unit test voi ham gia, tranh tao phieu rac trong he thong that.
//
// Factory injectable - giong billing.js/outages.js.
export function createTicketsHandlers({ baoSuCo, resolveDanhBoRef, log = () => {} }) {
  async function handleCreateTicket({ ma_danh_bo, loai, mo_ta } = {}, callState) {
    const rs = resolveDanhBoRef(ma_danh_bo, callState);
    if (!rs.ok) return rs.error;

    const noiDung = loai ? `[${loai}] ${mo_ta}` : mo_ta;
    const r = await baoSuCo(rs.value, noiDung, callState?.callerPhone);
    log("info", `tickets: create_ticket danh_bo=${rs.value} loai=${loai ?? "?"} -> success=${r.success}`);

    if (!r.success) {
      return { success: false, message: r.message || "Không tạo được phiếu sự cố." };
    }
    return {
      success: true,
      message: r.message || "Phiếu tiếp nhận sự cố đã được ghi nhận.",
      data: r.data,
    };
  }

  return { handleCreateTicket };
}
