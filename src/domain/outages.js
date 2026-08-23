// src/domain/outages.js
//
// Giai doan 5b (xem docs/roadmap.md) - port get_outages tu ban cu
// (voice_bot/src/tools.js#handleGetOutages) sang kien truc moi.
//
// GIU NGUYEN nghiep vu THAT (khong doan, port dung tu ban cu):
//   - Khong co su co (d.coSuCo falsy) -> van success:true, doc lai
//     d.thongBao (hoac cau mac dinh) - day KHONG phai loi, la trang thai
//     binh thuong.
//   - CO su co (d.coSuCo truthy) -> doc d.thongBao, kem them
//     "Dự kiến hoàn thành: ..." NEU co d.thoiGianDuKienHoanThanh.
//
// KHAC ban cu (co y, giong billing.js - xem ghi chu o do): handler tra ve
// OBJECT thuong, KHONG tu JSON.stringify() - dispatch-tool-call.js da lam
// viec do o 1 noi duy nhat.
//
// Factory injectable - giong billing.js: KHONG tu import thang
// tongdai-api.js, nhan qua tham so de test bang ham gia (xem
// test/outages.test.mjs).
export function createOutagesHandlers({ getThongBaoCupNuoc, resolveDanhBoRef, log = () => {} }) {
  async function handleGetOutages({ ma_danh_bo } = {}, callState) {
    const rs = resolveDanhBoRef(ma_danh_bo, callState);
    if (!rs.ok) return rs.error;

    const r = await getThongBaoCupNuoc(rs.value);
    if (!r.success) {
      return { success: false, message: r.message || "Không tra cứu được thông tin cúp nước." };
    }

    const d = r.data || {};
    log("info", `outages: get_outages danh_bo=${rs.value} coSuCo=${!!d.coSuCo}`);

    if (!d.coSuCo) {
      return {
        success: true,
        message: d.thongBao || "Khách hàng không nằm trong vùng bị sự cố.",
        data: d,
      };
    }

    const tg = d.thoiGianDuKienHoanThanh ? ` Dự kiến hoàn thành: ${d.thoiGianDuKienHoanThanh}.` : "";
    return {
      success: true,
      message: `${d.thongBao || "Khu vực của Quý khách đang bị sự cố cấp nước."}${tg}`,
      data: d,
    };
  }

  return { handleGetOutages };
}
