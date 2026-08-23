// src/domain/billing.js
//
// Giai doan 5b (xem docs/roadmap.md) - port nghiep vu hoa don tu ban cu
// (voice_bot/src/tools.js: docTienVN, fmtNgay, simplifyRow, prevPeriod,
// fetchBilling, handleGetBill, handleCompareUsage) sang kien truc moi.
//
// GIU NGUYEN nghiep vu THAT (khong phai "vay" hay patch cho race dieu
// kien cua kien truc cu - nen KHONG duoc bo khi port):
//   - fetchBilling goi 1 API DUY NHAT (getTrangThaiTT - superset: TongTien
//     + SanLuong + TrangThaiThanhToan) dung chung cho ca get_bill lan
//     compare_usage-ke-tiep - tranh 2 vong goi API cho cung 1 lan tra
//     cuu (log that cho thay model hay goi get_bill roi goi tiep 1 tool
//     rieng cho san luong/thanh toan cua CUNG ky do).
//   - Khong truyen ky/nam ma backend tra INVOICE_NOT_FOUND/
//     PRODUCTION_NOT_FOUND -> tu dong lui 1 ky (prevPeriod()) va goi lai
//     DUNG 1 LAN. Day la QUIRK THAT cua backend (KHONG tu mac dinh ve ky
//     GAN NHAT co du lieu ma mac dinh theo ngay goi hien tai, thuong
//     chua co du lieu dau thang) - da xac nhan bang 2 loi that rieng
//     (fetchBilling 26/07/2026, getSoSanhTangGiam 04/08/2026 - xem
//     comment goc trong voice_bot/src/tools.js) - PHAI giu, khong phai
//     doan mo.
//   - docTienVN(...): so tien PHAI doc thanh CHU cho TTS - so da format
//     dau cham ngan cach hang nghin (vd "1.180.266 đồng") bi TTS doc SAI
//     (loi that da gap voi ban cu).
//
// BO CO Y (khac ban cu):
//   - danhBoNotFoundSelfCorrect() khi CUSTOMER_NOT_FOUND - thuoc co che
//     "ung vien co-pilot nen" cua luong thu thap danh bo, thuoc Giai
//     doan 6, khong lien quan nghiep vu hoa don.
//   - Toan bo state/gate xac nhan danh bo that (resolveDanhBo that goi
//     callState._danhBoSession/...) - thay bang resolveDanhBoRef TAM (xem
//     resolve-danh-bo-ref.js) - CUNG 1 hop dong, doi 1 dong import khi
//     Giai doan 6 xong, KHONG sua logic file nay.
//
// KHAC HOP DONG voi ban cu (co y, de khop dispatch-tool-call.js da viet
// o Giai doan 5a): handler cu tra ve CHUOI da JSON.stringify() san.
// dispatch-tool-call.js MOI tu stringify output roi (xem
// createToolDispatcher#handleSignal) - nen o day MOI handler tra ve
// OBJECT THUONG, KHONG tu stringify, tranh bi stringify 2 lan.
//
// Ham thuan (khong phu thuoc mang) export rieng o cap module - test duoc
// truc tiep, khong can gia lap gi. Cac ham CAN goi API (fetchBilling/
// handleGetBill/handleCompareUsage) nam trong factory injectable
// createBillingHandlers({...}) - giong quy uoc da dung o
// createTurnController/createToolDispatcher (Giai doan 3/5a): KHONG tu
// import thang tongdai-api.js, nhan qua tham so - test bang ham gia,
// khong goi mang that (xem test/billing.test.mjs).

// [fix 23/08/2026, xac nhan bang goi THAT toi API test qua tunnel (ma danh
// bo 22023251775, xem test/billing.test.mjs)] Comment/gia dinh cu (ke tu
// ban cu voice_bot/src/tools.js) noi NgayThanhToan dang ISO
// "2026-06-30 15:14:54" (YYYY-MM-DD). Du lieu THAT nhan duoc lai la
// "22/08/2026 06:42:04" (DD/MM/YYYY, da dung thu tu ngay/thang/nam, chi
// thua phan gio:phut:giay) - regex cu KHONG match dinh dang nay, roi vao
// nhanh fallback tra nguyen van ca cum gio:phut:giay, khien cau tra loi
// TTS doc thua ("...ngay 22/08/2026 06:42:04" thay vi "...ngay
// 22/08/2026"). Nhan CA HAI dinh dang (ISO cu + DD/MM/YYYY that xac nhan)
// - phong truong hop noi khac trong he thong van tra ISO, khong chi sua
// theo dinh dang moi nhat quan sat duoc.
export function fmtNgay(s) {
  const str = String(s ?? "");
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const vn = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (vn) return `${vn[1]}/${vn[2]}/${vn[3]}`;
  return s;
}

/** So -> chu tieng Viet doc qua TTS (vd 185000 -> "một trăm tám mươi lăm nghìn đồng"). */
export function docTienVN(n) {
  const num = Math.round(Number(n));
  if (!isFinite(num)) return String(n);
  if (num === 0) return "không đồng";
  const ones = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  const units = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ"];
  let v = Math.abs(num);
  const groups = [];
  while (v > 0) {
    groups.unshift(v % 1000);
    v = Math.floor(v / 1000);
  }
  const parts = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    const isFirst = parts.length === 0;
    const tr = Math.floor(g / 100), ch = Math.floor((g % 100) / 10), dv = g % 10;
    const w = [];
    if (tr > 0) w.push(ones[tr] + " trăm");
    else if (!isFirst) w.push("không trăm");
    if (ch > 1) {
      w.push(ones[ch] + " mươi");
      if (dv === 1) w.push("mốt");
      else if (dv === 5) w.push("lăm");
      else if (dv > 0) w.push(ones[dv]);
    } else if (ch === 1) {
      w.push("mười");
      if (dv === 5) w.push("lăm");
      else if (dv > 0) w.push(ones[dv]);
    } else if (dv > 0) {
      if (tr > 0 || !isFirst) w.push("lẻ");
      w.push(ones[dv]);
    }
    parts.push(w.join(" ") + units[groups.length - 1 - i]);
  });
  return (num < 0 ? "âm " : "") + parts.join(" ") + " đồng";
}

/**
 * Rut gon 1 dong hoa don thanh object "sach" cho model doc:
 * - ngay da format DD/MM/YYYY (model mini kho tu parse "2026-06-30 ..."),
 * - bo DonViThanhToan (ma noi bo nhu "GDGV", gay nhieu),
 * - tien da format kem don vi (chu, doc TTS dung).
 */
export function simplifyRow(d) {
  const paid = d.TrangThaiThanhToan === "Đã thanh toán";
  return {
    ky: `${d.Ky}/${d.Nam}`,
    san_luong_m3: d.SanLuong,
    tong_tien: docTienVN(d.TongTien), // dạng CHỮ — model đọc nguyên văn
    tong_tien_so: d.TongTien, // số raw để tham chiếu/log
    trang_thai_thanh_toan: d.TrangThaiThanhToan || null,
    ngay_thanh_toan: paid ? fmtNgay(d.NgayThanhToan) : null,
  };
}

/** Ky lien truoc theo gio GMT+7 (ky = thang). */
export function prevPeriod() {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  let ky = now.getUTCMonth() + 1;
  let nam = now.getUTCFullYear();
  ky -= 1;
  if (ky === 0) {
    ky = 12;
    nam -= 1;
  }
  return { ky, nam };
}

/**
 * Factory injectable - xem ghi chu dau file. `getTrangThaiTT`/
 * `getSoSanhTangGiam` giu dung chu ky nhu tongdai-api.js (Giai doan 5)
 * da export. `resolveDanhBoRef` giu dung hop dong nhu
 * resolve-danh-bo-ref.js (se doi thanh resolveDanhBo that o Giai doan 6).
 */
export function createBillingHandlers({ getTrangThaiTT, getSoSanhTangGiam, resolveDanhBoRef, log = () => {} }) {
  /**
   * Fetch chung cho tra cuu hoa don: xem ghi chu nghiep vu dau file.
   * Tra ve { ok, ma_danh_bo?, rows? } hoac { ok:false, error:<object> }.
   */
  async function fetchBilling(ma_danh_bo, ky, nam, callState) {
    const rs = resolveDanhBoRef(ma_danh_bo, callState);
    if (!rs.ok) return { ok: false, error: rs.error };

    let r = await getTrangThaiTT(rs.value, ky, nam);

    const noPeriodGiven = (ky === null || ky === undefined) && (nam === null || nam === undefined);
    const notFound = ["INVOICE_NOT_FOUND", "PRODUCTION_NOT_FOUND"].includes(r?.error_code);
    if (!r.success && noPeriodGiven && notFound) {
      const p = prevPeriod();
      log("info", `billing: khong truyen ky/nam, ky hien tai khong co du lieu (${r.error_code}) -> lui ve ky ${p.ky}/${p.nam}`);
      r = await getTrangThaiTT(rs.value, p.ky, p.nam);
    }

    if (!r.success) {
      return {
        ok: false,
        error: {
          success: false,
          error_code: r.error_code || null,
          message: r.message || "Không tra cứu được thông tin.",
        },
      };
    }
    return { ok: true, ma_danh_bo: rs.value, rows: Array.isArray(r.data) ? r.data : [] };
  }

  // [fix 05/08/2026, giu nguyen tu ban cu] Gop handleGetBill +
  // handleGetWaterUsage + handleGetPaymentStatus lam MOT - ca 3 tool cu goi
  // CHUNG mot API (qua fetchBilling), chi khac cach format lai message tu
  // CUNG mot bo du lieu. Hoi 1 trong 3 thu (tien, san luong, trang thai
  // thanh toan) -> tra loi du ca 3 tu lan hoi dau, tranh 2 vong goi API.
  // KHONG doc DonViThanhToan cho khach (ma noi bo, chua co bang map).
  async function handleGetBill({ ma_danh_bo, ky, nam } = {}, callState) {
    const f = await fetchBilling(ma_danh_bo, ky, nam, callState);
    if (!f.ok) return f.error;

    log("info", `billing: get_bill danh_bo=${f.ma_danh_bo} ky=${ky ?? "?"} nam=${nam ?? "?"} -> ${f.rows.length} dong`);

    const parts = f.rows.map((d) => {
      const tt =
        d.TrangThaiThanhToan === "Đã thanh toán"
          ? `đã thanh toán ngày ${fmtNgay(d.NgayThanhToan)}`
          : `chưa thanh toán`;
      return `Kỳ ${d.Ky}/${d.Nam}: sản lượng ${d.SanLuong} m³, tổng tiền ${docTienVN(d.TongTien)}, ${tt}`;
    });

    return {
      success: true,
      message: parts.length ? parts.join("; ") + "." : "Không có dữ liệu hóa đơn.",
      data: f.rows.map(simplifyRow),
    };
  }

  async function handleCompareUsage({ ma_danh_bo, ky, nam } = {}, callState) {
    const rs = resolveDanhBoRef(ma_danh_bo, callState);
    if (!rs.ok) return rs.error;

    let r = await getSoSanhTangGiam(rs.value, ky, nam);
    // [fix 04/08/2026, giu nguyen tu ban cu] Cung van de da sua o
    // fetchBilling (26/07): khong truyen ky/nam, backend mac dinh lay
    // THEO NGAY GOI HIEN TAI thay vi ky gan nhat co du lieu -> thu lai
    // voi ky lien truoc khi khong truyen ky/nam va lan dau khong co du lieu.
    const noPeriodGiven = (ky === null || ky === undefined) && (nam === null || nam === undefined);
    if (!r.success && noPeriodGiven) {
      const p = prevPeriod();
      log("info", `billing: compare_usage khong truyen ky/nam, lan dau khong co du lieu -> lui ve ky ${p.ky}/${p.nam}`);
      r = await getSoSanhTangGiam(rs.value, p.ky, p.nam);
    }
    if (!r.success) {
      return { success: false, message: r.message || "Không có dữ liệu so sánh." };
    }
    return {
      success: true,
      message: r.message || "Lấy thông tin so sánh sản lượng thành công.",
      data: r.data,
    };
  }

  return { handleGetBill, handleCompareUsage };
}
