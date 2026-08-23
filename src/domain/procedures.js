// src/domain/procedures.js
//
// Giai doan 5b (xem docs/roadmap.md) - port get_procedure_info +
// check_missing_docs tu ban cu (voice_bot/src/tools.js: normalizeProcedureArgs,
// handleGetProcedureInfo, handleCheckMissingDocs, toSpoken, docMatches +
// cac helper chuan hoa chuoi). File LON NHAT trong Giai doan 5b - nhieu
// heuristic tung sua qua NHIEU cuoc goi that (moi fix deu co ghi chu ngay
// thang + so cuoc goi that trong ban cu) - PORT DUNG, KHONG rut gon/doan lai
// logic, du co ve phuc tap.
//
// KHAC cac file domain truoc (billing/outages/tickets/call-control):
// handleGetProcedureInfo/handleCheckMissingDocs KHONG goi API mang nao ca -
// la ham THUAN (sync, khong async) doi voi 4 loai thu tuc gan cung trong
// procedures-data.js. Van boc trong factory createProceduresHandlers({log})
// de dong bo giao dien voi cac file domain khac (tool-router.js goi giong
// nhau cho moi module).
//
// ============================================================================
// CANH BAO KIEN TRUC (giong ghi chu dau call-control.js - doc TRUOC khi noi
// day that):
// ============================================================================
// Ket qua co field `doc_cho_khach` (kich ban BAT BUOC doc NGUYEN VAN cho
// khach) va `luu_y_cho_tro_ly`/`quy_dinh`/`giai_thich_thuat_ngu` (ghi chu NOI
// BO, TUYET DOI KHONG duoc doc). Ban cu (session-ws.js) co CO CHE EP model
// doc dung nguyen van `doc_cho_khach` khi field nay co mat (khac voi tool
// thuong, chi doc "message" roi tu dien dat). Kien truc MOI (turn-
// controller.js/dispatch-tool-call.js, Giai doan 3/5a) CHUA co co che tuong
// duong - hien tai model chi nhan function_call_output roi tu do quyet dinh
// noi gi (qua say({mode:"auto"})). Neu noi 2 tool nay vao that ma KHONG co
// co che ep doc nguyen van, model (dac biet ban mini) co the tu tom tat/dien
// dat lai `doc_cho_khach`, lam mat cac chi tiet quan trong (dia chi van
// phong, giay to bat buoc) - dung y ban cu tung sua (xem cac fix ngay
// 12-13/07/2026 trong comment ben duoi). Day la viec CAN lam luc tool-
// router.js/turn-controller.js duoc mo rong (vd say({mode:"verbatim", text:
// doc_cho_khach}) khi ket qua tool co field nay) - CHUA lam trong file nay.
// ============================================================================
//
// GIU NGUYEN nghiep vu THAT (khong doan, port dung tu ban cu - moi heuristic
// duoi day deu tung sua 1 loi THAT, ghi lai nguyen ngay thang):
//   - normalizeProcedureArgs: model hay gui SAI ten/dinh dang tham so
//     (key co dau, value la ten day du thay vi id, co dua duoi dang co
//     boolean/N-A) - chuan hoa BANG CODE (deterministic), khong doan mo
//     (chi nhan khi co DUNG MOT ket qua khop).
//   - "can_hoi_doi_tuong"/callState.daHoiDoiTuong: thu tuc co huong dan khac
//     nhau theo doi tuong (ho gia dinh/doanh nghiep) - LAN GOI DAU khong
//     duoc tin doi_tuong model tu doan, phai tra cau HOI/XAC NHAN truoc, chi
//     tin tu LAN GOI THU HAI tro di trong CUNG cuoc goi (dung callState de
//     nho - day la STATE THEO CUOC GOI, khac resolveDanhBoRef).
//   - docMatches/DOC_ALIASES: doi chieu giay to khach da co bang CODE (khong
//     de model tu doi chieu - tung tra loi SAI, quen CCCD).
import { PROCEDURES } from "./procedures-data.js";

export function createProceduresHandlers({ log = () => {} } = {}) {
  // ── Helper chuan hoa chuoi (thuan, khong phu thuoc PROCEDURES) ───────────

  // [11/07/2026] gpt-realtime-mini doi khi sinh SAI TEN THAM SO tool (vd
  // "loại_thu_tuc" co dau thay vi "loai_thu_tuc") - chuan hoa bang CODE
  // (deterministic, cung triet ly normalizeDanhBo cu): bo dau + so khop
  // key/value.
  const stripDiacritics = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  // Chuan hoa value ve dang id: bo dau, thuong hoa, khoang trang/gach -> "_"
  // (vd "lắp đặt đồng hồ" -> "lap_dat_dong_ho").
  const canonValue = (v) => stripDiacritics(v).toLowerCase().trim().replace(/[\s-]+/g, "_");
  // Chuan hoa text de so khop (khac canonValue - giu khoang trang don, bo
  // ky tu la thay vi gop thanh "_") - dung cho docMatches.
  const canonText = (v) => stripDiacritics(v).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  const DOI_TUONG_IDS = ["ho_gia_dinh", "doanh_nghiep"];

  // [fix 08/07/2026, giu nguyen tu ban cu] Chuyen ten rieng sang DANG DOC
  // trong text ma AI phai doc cho khach. Ly do: gpt-realtime-mini khong ap
  // dung duoc quy tac phat am dat trong system prompt - cach tin cay duy
  // nhat la viet san dang doc vao text. Data goc + cac field cau truc
  // (thuTuc, quy_dinh) van giu CHU CHUAN cho log/summary sach.
  function toSpoken(text) {
    return text
      .replace(/ ?\(CCCD\)/g, "")
      .replace(/CCCD/g, "Căn cước công dân")
      .replace(/VNeID/g, "Vi-en-e-ai-đi")
      .replace(/CT07/g, "Xê-Tê-không-bảy")
      .replace(/CT08/g, "Xê-Tê-không-tám")
      .replace(/SAWACO CSKH/g, "Sa-qua-cô Xê-ét-ka-hát")
      .replace(/www\.capnuoctrungan\.vn/g, "vê kép vê kép vê kép chấm cấp nước trung an chấm vi-en")
      .replace(/873A Quang Trung/g, "Tám bảy ba A Quang Trung")
      .replace(/540 Hà Huy Giáp/g, "Năm trăm bốn mươi Hà Huy Giáp")
      .replace(/TP.HCM/g, "Thành Phố Hồ Chí Minh");
  }

  // Ten dan da khach hay dung -> cum dac trung trong ten giay to chuan.
  const DOC_ALIASES = [
    { keys: ["so hong", "so do", "giay to nha dat"], target: "giay chung nhan quyen" },
    { keys: ["hop dong mua ban"], target: "hop dong chuyen quyen so huu" },
  ];

  function docMatches(customerRaw, docRaw) {
    const cus = canonText(customerRaw);
    const doc = canonText(docRaw);
    if (!cus || !doc) return false;
    if (doc.includes(cus)) return true;
    for (const a of DOC_ALIASES) {
      if (a.keys.some((k) => cus.includes(k)) && doc.includes(a.target)) return true;
    }
    // Khach noi dai dong hon ten giay chuan: khop khi co cum 2 tu lien tiep trung.
    const words = cus.split(" ");
    for (let i = 0; i + 1 < words.length; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (bigram.length >= 7 && doc.includes(bigram)) return true;
    }
    return false;
  }

  // [11/07/2026 -> fix 13/07/2026, giu nguyen tu ban cu] Chuan hoa
  // loai_thu_tuc/doi_tuong tu args model gui - nhieu tang fallback, CHI
  // nhan khi co DUNG MOT ket qua khop (khong doan bua khi mo ho). Xem ghi
  // chu dau file - moi tang la 1 loi that model tung mac phai.
  function normalizeProcedureArgs(args = {}) {
    let loai = PROCEDURES[args.loai_thu_tuc] ? args.loai_thu_tuc : undefined;
    let doiTuong = DOI_TUONG_IDS.includes(args.doi_tuong) ? args.doi_tuong : undefined;

    // 1) Key viet sai (co dau/hoa thuong) nhung bo dau thi khop dung ten tham so.
    if (!loai || !doiTuong) {
      for (const [k, v] of Object.entries(args)) {
        const key = canonValue(k);
        const val = canonValue(v);
        if (!loai && key === "loai_thu_tuc" && PROCEDURES[val]) loai = val;
        if (!doiTuong && key === "doi_tuong" && DOI_TUONG_IDS.includes(val)) doiTuong = val;
      }
    }
    // 2) Fallback: quet value - chi nhan khi co DUNG MOT id thu tuc (tranh doan bua).
    if (!loai) {
      const ids = [...new Set(Object.values(args).map(canonValue).filter((v) => PROCEDURES[v]))];
      if (ids.length === 1) loai = ids[0];
    }
    // 2b) [fix 18/07/2026] value la TEN thu tuc day du ("Sang tên đồng hồ
    // nước" -> canon "sang_ten_dong_ho_nuoc") - khop exact truot. Nhan khi
    // canon value CHUA dung MOT id thu tuc (cac id khong chua lan nhau).
    if (!loai) {
      const hits = [...new Set(Object.values(args).map(canonValue).flatMap((v) => Object.keys(PROCEDURES).filter((id) => v.includes(id))))];
      if (hits.length === 1) loai = hits[0];
    }
    if (!doiTuong) {
      const dts = [...new Set(Object.values(args).map(canonValue).filter((v) => DOI_TUONG_IDS.includes(v)))];
      if (dts.length === 1) doiTuong = dts[0];
    }
    // 3) [13/07/2026] Model ma hoa dang CO BOOLEAN - key chinh la id, value
    // truthy danh dau lua chon.
    const truthy = (v) => v === true || v === 1 || v === "true" || v === "1";
    if (!loai) {
      const flagged = [...new Set(Object.entries(args).filter(([k, v]) => PROCEDURES[canonValue(k)] && truthy(v)).map(([k]) => canonValue(k)))];
      if (flagged.length === 1) loai = flagged[0];
    }
    if (!doiTuong) {
      const flagged = [...new Set(Object.entries(args).filter(([k, v]) => DOI_TUONG_IDS.includes(canonValue(k)) && truthy(v)).map(([k]) => canonValue(k)))];
      if (flagged.length === 1) doiTuong = flagged[0];
    }
    // 3b) [fix 18/07/2026] Model dem ca 4 key thu tuc bang "N/A", key DUOC
    // CHON mang value co nghia (ten thu tuc, "co", ...) - key la id thu tuc
    // + value KHONG phai marker rong = lua chon cua model. Chi nhan khi co
    // DUNG MOT key nhu vay (tranh doan bua).
    const NULL_MARKERS = new Set(["", "n/a", "na", "null", "none", "khong", "khong_co", "false", "0"]);
    const isNullish = (v) => v == null || v === false || v === 0 || NULL_MARKERS.has(canonValue(v));
    if (!loai) {
      const selected = [...new Set(Object.entries(args).filter(([k, v]) => PROCEDURES[canonValue(k)] && !isNullish(v)).map(([k]) => canonValue(k)))];
      if (selected.length === 1) loai = selected[0];
    }
    if (!doiTuong) {
      const selected = [...new Set(Object.entries(args).filter(([k, v]) => DOI_TUONG_IDS.includes(canonValue(k)) && !isNullish(v)).map(([k]) => canonValue(k)))];
      if (selected.length === 1) doiTuong = selected[0];
    }

    if (loai !== args.loai_thu_tuc || doiTuong !== args.doi_tuong) {
      log("warn", `procedures: args chuan hoa lai: ${JSON.stringify(args)} -> ${JSON.stringify({ loai_thu_tuc: loai, doi_tuong: doiTuong })}`);
    }
    return { loai_thu_tuc: loai, doi_tuong: doiTuong };
  }

  // ── get_procedure_info ────────────────────────────────────────────────

  function handleGetProcedureInfo(rawArgs = {}, callState = {}) {
    const { loai_thu_tuc, doi_tuong } = normalizeProcedureArgs(rawArgs);
    const procedure = PROCEDURES[loai_thu_tuc];
    if (!procedure) {
      // [11/07/2026] Thu tuc ngoai pham vi 4 thu tuc ho tro -> khong tu
      // huong dan, moi chuyen tong dai vien hoac tao phieu ghi nhan.
      return {
        success: false,
        ngoai_pham_vi: true,
        doc_cho_khach:
          "Dạ, em không có thông tin về yêu cầu này! " +
          "Quý khách có muốn em chuyển máy sang tổng đài viên hỗ trợ trực tiếp, hoặc ghi nhận lại yêu cầu để nhân viên liên hệ lại sau không ạ?",
        message:
          "Loại thủ tục không thuộc 4 thủ tục hỗ trợ (dinh_muc_nuoc, lap_dat_dong_ho, " +
          "sang_ten_dong_ho, nang_doi_dong_ho). Nếu khách đang hỏi MỘT trong 4 thủ tục này " +
          "→ GỌI LẠI tool với đúng tham số loai_thu_tuc. Nếu là thủ tục khác → ngoài phạm vi: " +
          "KHÔNG tự hướng dẫn, mời khách chọn chuyển tổng đài viên (transfer_to_agent) " +
          "hoặc tạo phiếu ghi nhận (create_ticket) để nhân viên liên hệ lại sau.",
      };
    }

    // [08/07/2026] Thu tuc gioi han doi tuong (vd dinh muc nuoc chi cho ho
    // gia dinh) -> khach hoi cho doi tuong khac thi bao ro, khong tra nham noi dung.
    if (procedure.apDung && doi_tuong && doi_tuong !== procedure.apDung) {
      return {
        success: true,
        thuTuc: procedure.title,
        doc_cho_khach:
          `Dạ, thủ tục ${procedure.title} hiện chỉ áp dụng cho hộ gia đình, ` +
          `chưa áp dụng cho doanh nghiệp ạ. Quý Khách có muốn em chuyển máy sang tổng đài viên ` +
          `hỗ trợ trực tiếp, hoặc ghi nhận lại yêu cầu không ạ?`,
        message: `Thủ tục ${procedure.title} CHỈ áp dụng cho hộ gia đình, KHÔNG áp dụng cho doanh nghiệp hay công ty. Nếu khách là doanh nghiệp cần hỗ trợ khác, mời chuyển tổng đài viên hoặc tạo phiếu ghi nhận.`,
      };
    }

    // [12/07/2026] Thu tuc co huong dan KHAC NHAU theo doi tuong (lap dat,
    // sang ten): thieu doi_tuong thi KHONG tra gop ca hai truong hop.
    const coPhanBietDoiTuong = procedure.cases.some((c) => c.id === "doanh_nghiep");

    // [fix 18/07/2026] Model TU DOAN doi_tuong ngay luot tool dau tien ->
    // nguy co doc nham huong dan ho gia dinh cho doanh nghiep. Deterministic:
    // voi thu tuc co huong dan khac nhau theo doi tuong, doi_tuong CHI duoc
    // chap nhan SAU KHI tool da yeu cau hoi khach (can_hoi_doi_tuong) cho
    // thu tuc do trong CUNG cuoc goi - truoc do bo qua gia tri model gui va
    // ep hoi. `daHoiDoiTuong` la STATE THEO CUOC GOI (callState), khac
    // resolveDanhBoRef (theo danh bo) - can callState song suot cuoc goi de
    // hoat dong dung (xem canh bao kien truc dau file).
    const daHoiDoiTuong = (callState.daHoiDoiTuong ??= new Set());
    const effDoiTuong = doi_tuong;
    if (coPhanBietDoiTuong && effDoiTuong && !daHoiDoiTuong.has(loai_thu_tuc)) {
      // [fix 18/07/2026 v2] Thay cau hoi mo bang cau XAC NHAN gia tri model
      // gui - khach chi can "dung roi" (neu da noi) hoac sua ngay (neu model
      // doan sai). Van an toan 100% vi doi tuong luon qua loi khach xac nhan.
      daHoiDoiTuong.add(loai_thu_tuc);
      const dtLabel = effDoiTuong === "doanh_nghiep" ? "doanh nghiệp" : "hộ gia đình";
      log("warn", `procedures: doi_tuong="${effDoiTuong}" chua qua buoc hoi - tra cau xac nhan doi tuong`);
      return {
        success: true,
        thuTuc: procedure.title,
        can_hoi_doi_tuong: true,
        xac_nhan_doi_tuong: effDoiTuong,
        message:
          `Cần khách XÁC NHẬN đối tượng trước khi hướng dẫn. ĐỌC câu trong doc_cho_khach rồi DỪNG, chờ khách trả lời. ` +
          `Khách xác nhận đúng → GỌI LẠI get_procedure_info với doi_tuong="${effDoiTuong}". ` +
          `Khách sửa lại → GỌI LẠI với doi_tuong khách nói. ` +
          `KHÔNG hướng dẫn giấy tờ khi chưa gọi lại tool.`,
        doc_cho_khach: `Dạ, em xin xác nhận lại: Quý Khách đăng ký cho ${dtLabel}, phải không ạ?`,
      };
    }

    if (!effDoiTuong && coPhanBietDoiTuong) {
      daHoiDoiTuong.add(loai_thu_tuc);
      return {
        success: true,
        thuTuc: procedure.title,
        can_hoi_doi_tuong: true,
        message:
          `Thủ tục ${procedure.title} có hướng dẫn KHÁC NHAU cho hộ gia đình và doanh nghiệp. ` +
          `HỎI khách một câu ngắn: "Quý Khách đăng ký cho hộ gia đình hay doanh nghiệp ạ?" ` +
          `rồi GỌI LẠI get_procedure_info với doi_tuong tương ứng. KHÔNG tự đoán, ` +
          `KHÔNG hướng dẫn giấy tờ khi chưa gọi lại tool.`,
        doc_cho_khach: `Dạ, thủ tục ${procedure.title} có hướng dẫn khác nhau cho hộ gia đình và doanh nghiệp ạ. Quý Khách đăng ký cho hộ gia đình hay doanh nghiệp ạ?`,
      };
    }

    // Loc case phu hop doi tuong (neu co).
    let relevantCases = procedure.cases;
    if (effDoiTuong) {
      const matched = procedure.cases.filter((c) => c.id.includes(effDoiTuong) || c.id === "default");
      if (matched.length > 0) relevantCases = matched;
    }
    // [11/07/2026] Case danh dau transferToAgent (vd doanh nghiep gan/sang
    // ten dong ho) -> khong huong dan giay to, moi chuyen tong dai vien hoac tao phieu.
    if (relevantCases.length > 0 && relevantCases.every((c) => c.transferToAgent)) {
      return {
        success: true,
        thuTuc: procedure.title,
        can_chuyen_tong_dai: true,
        message:
          `Thủ tục ${procedure.title} đối với doanh nghiệp/công ty do tổng đài viên hỗ trợ trực tiếp, ` +
          `trợ lý KHÔNG tự hướng dẫn giấy tờ. Mời khách chọn: chuyển tổng đài viên (transfer_to_agent), ` +
          `hoặc tạo phiếu ghi nhận (create_ticket) để nhân viên liên hệ lại sau.`,
        doc_cho_khach: `Dạ, thủ tục ${procedure.title} đối với doanh nghiệp/công ty do tổng đài viên hỗ trợ trực tiếp. Quý khách có muốn em chuyển máy sang tổng đài viên hỗ trợ trực tiếp, hoặc ghi nhận lại yêu cầu để nhân viên liên hệ lại sau không ạ?`,
      };
    }

    // Tong hop giay to thanh CAC Y DANH SO.
    // [fix 08/07/2026] Giu ngu nghia AND/OR cua data: `required` = can day
    // du, `options` = chi can mot trong, `optional` = bo sung tuy truong hop.
    // [fix 12/07/2026] Danh so y + chi thi "doc du N y" - tranh model tu
    // tom tat lam roi giay to bat buoc/dia chi.
    const spokenItems = [];
    const nhieuCase = relevantCases.length > 1;
    relevantCases.forEach((c) => {
      const prefix = nhieuCase ? `Trường hợp ${c.label} — ` : "";
      if (c.transferToAgent) {
        spokenItems.push(`${prefix}tổng đài viên hỗ trợ trực tiếp: mời chuyển tổng đài viên hoặc tạo phiếu ghi nhận`);
        return;
      }
      const docs = c.requiredDocs;
      let coY = false;
      if (docs.required?.length) {
        spokenItems.push(`${prefix}giấy tờ BẮT BUỘC: ${docs.required.join("; ")}`);
        coY = true;
      }
      if (docs.options?.length) {
        spokenItems.push(`${prefix}kèm CHỈ CẦN MỘT trong các giấy tờ sau: ${docs.options.join("; ")}`);
        coY = true;
      }
      if (docs.optional?.length) {
        spokenItems.push(`${prefix}giấy tờ bổ sung TÙY TRƯỜNG HỢP: ${docs.optional.join("; ")}`);
        coY = true;
      }
      if (!coY) spokenItems.push(`${prefix}${docs.note || "không có yêu cầu giấy tờ cụ thể"}`);
    });

    // [08/07/2026] Viet CHU CHUAN (SAWACO CSKH, www...) - cach phat am day
    // trong SYSTEM_PROMPT, khong nhung phien am vao data.
    // [11/07/2026] procedure.channels (data) de ghi de kenh mac dinh.
    const channels =
      procedure.channels ||
      "Nộp hồ sơ qua: app SAWACO CSKH, hoặc trực tiếp tại " +
      "văn phòng 873A Quang Trung, phường An Hội Tây, TP.HCM hoặc 540 Hà Huy Giáp, phường An Phú Đông, TP.HCM.";

    // Kenh nop ho so luon la y cuoi - bat buoc doc (kem day du 2 dia chi).
    spokenItems.push(channels);

    // [13/07/2026] "Thứ nhất/Thứ hai..." thay "Ý 1/Ý 2" - nghe tu nhien hon.
    const THU_TU = ["Thứ nhất", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
    const bodyDanhSo = spokenItems.map((s, i) => `${THU_TU[i] || `Thứ ${i + 1}`}, ${s.replace(/\.\s*$/, "")}.`).join(" ");

    log("info", `procedures: get_procedure_info loai_thu_tuc=${loai_thu_tuc} doi_tuong=${effDoiTuong ?? "?"} -> ${spokenItems.length} phan`);

    // [13/07/2026 dot 2+3, giu nguyen tu ban cu] TACH chi thi khoi noi dung
    // doc: "doc_cho_khach" = noi dung sach, doc nguyen van; "luu_y_cho_tro_ly"
    // = chi thi noi bo, cam doc. quy_dinh/giai_thich_thuat_ngu KHONG nam
    // trong phan doc mac dinh - chi dung tra loi cau hoi tiep theo.
    return {
      success: true,
      thuTuc: procedure.title,
      so_phan_phai_doc: spokenItems.length,
      luu_y_cho_tro_ly:
        `Ghi chú nội bộ, TUYỆT ĐỐI KHÔNG đọc cho khách: "doc_cho_khach" là KỊCH BẢN — ` +
        `đọc NGUYÊN VĂN toàn bộ, TỪNG CÂU, ngay từ lượt trả lời ĐẦU TIÊN. ` +
        `CẤM tóm tắt, CẤM diễn đạt lại, CẤM rút gọn (đủ ${spokenItems.length} phần, không bỏ phần nào, ` +
        `không đổi địa chỉ, không nói "có ${spokenItems.length} phần"). ` +
        `KHÔNG trộn nội dung "quy_dinh" vào bài đọc.`,
      doc_cho_khach: toSpoken(`${procedure.purpose} ${bodyDanhSo}`),
      ...(procedure.quyDinh
        ? {
          quy_dinh:
            "(GHI CHÚ NỘI BỘ — KHÔNG đọc khi hướng dẫn giấy tờ; chỉ dùng khi khách " +
            "hỏi thêm về đối tượng hoặc số người được đăng ký) " + procedure.quyDinh,
        }
        : {}),
      ...(procedure.thuatNgu
        ? {
          giai_thich_thuat_ngu: toSpoken(
            "(GHI CHÚ NỘI BỘ — KHÔNG đọc khi hướng dẫn giấy tờ; chỉ dùng khi khách " +
            "hỏi hoặc thắc mắc thuật ngữ, đọc NGẮN GỌN phần liên quan) " + procedure.thuatNgu
          ),
        }
        : {}),
    };
  }

  // ── check_missing_docs ────────────────────────────────────────────────
  // [13/07/2026, giu nguyen tu ban cu] Doi chieu giay to khach DA CO bang
  // CODE - khong de model tu doi chieu (tung tra loi SAI, quen CCCD).

  function handleCheckMissingDocs(rawArgs = {}) {
    const { loai_thu_tuc, doi_tuong } = normalizeProcedureArgs(rawArgs);
    const procedure = PROCEDURES[loai_thu_tuc];
    if (!procedure) {
      return {
        success: false,
        ngoai_pham_vi: true,
        message:
          "Loại thủ tục không thuộc 4 thủ tục hỗ trợ. Nếu khách hỏi 1 trong 4 thủ tục → gọi lại " +
          "với đúng loai_thu_tuc; nếu không → mời chuyển tổng đài viên (transfer_to_agent) " +
          "hoặc tạo phiếu (create_ticket).",
      };
    }
    const coPhanBietDoiTuong = procedure.cases.some((c) => c.id === "doanh_nghiep");
    if (!doi_tuong && coPhanBietDoiTuong) {
      return {
        success: true,
        thuTuc: procedure.title,
        can_hoi_doi_tuong: true,
        message:
          `Cần biết đối tượng trước. HỎI khách: "Quý Khách đăng ký cho hộ gia đình hay ` +
          `doanh nghiệp ạ?" rồi gọi lại tool với doi_tuong tương ứng.`,
      };
    }
    let relevantCases = procedure.cases;
    if (doi_tuong) {
      const matched = procedure.cases.filter((c) => c.id.includes(doi_tuong) || c.id === "default");
      if (matched.length > 0) relevantCases = matched;
    }
    if (relevantCases.length > 0 && relevantCases.every((c) => c.transferToAgent)) {
      return {
        success: true,
        thuTuc: procedure.title,
        can_chuyen_tong_dai: true,
        message:
          `Thủ tục ${procedure.title} cho doanh nghiệp/công ty do tổng đài viên hỗ trợ trực tiếp ` +
          `— mời khách chuyển tổng đài viên (transfer_to_agent) hoặc tạo phiếu (create_ticket).`,
      };
    }
    const cs = relevantCases.find((c) => !c.transferToAgent);
    const docsReq = cs?.requiredDocs || {};
    const required = docsReq.required || [];
    const options = docsReq.options || [];

    let daCo = rawArgs.giay_to_da_co;
    if (typeof daCo === "string") daCo = [daCo];
    if (!Array.isArray(daCo)) daCo = [];
    daCo = daCo.filter((x) => typeof x === "string" && x.trim());
    if (daCo.length === 0) {
      return {
        success: false,
        message:
          "Thiếu danh sách giấy tờ khách đã có. Gọi lại tool với giay_to_da_co là mảng " +
          'các giấy tờ khách nói đã có (vd ["giấy phép xây dựng"]).',
      };
    }

    const matchedRequired = new Set();
    let optionHit = null;
    const unrecognized = [];
    for (const item of daCo) {
      let hit = false;
      for (const r of required) {
        if (docMatches(item, r)) {
          matchedRequired.add(r);
          hit = true;
        }
      }
      for (const o of options) {
        if (docMatches(item, o)) {
          if (!optionHit) optionHit = o;
          hit = true;
        }
      }
      if (!hit) unrecognized.push(item);
    }
    const missingRequired = required.filter((r) => !matchedRequired.has(r));
    const needOption = options.length > 0 && !optionHit;
    const hoSoDu = missingRequired.length === 0 && !needOption;

    const daDuParts = [];
    if (optionHit) daDuParts.push(`nhóm "chỉ cần một trong" ĐÃ ĐỦ (khách có: ${optionHit})`);
    if (matchedRequired.size) daDuParts.push(`giấy bắt buộc đã có: ${[...matchedRequired].join("; ")}`);
    const thieu = [];
    if (missingRequired.length) thieu.push(`giấy tờ BẮT BUỘC: ${missingRequired.join("; ")}`);
    if (needOption) thieu.push(`MỘT trong các giấy tờ sau: ${options.join("; ")}`);
    // Cau cho KHACH ve giay chua nhan dien duoc (doc duoc); chi thi noi bo o luu_y.
    const canhBaoKhach = unrecognized.length
      ? ` Riêng "${unrecognized.join('", "')}" thì em chưa chắc chắn dùng thay được, ` +
      `Quý Khách có thể yêu cầu gặp tổng đài viên để xác nhận ạ.`
      : "";

    log("info", `procedures: check_missing_docs loai_thu_tuc=${loai_thu_tuc} da_co=${JSON.stringify(daCo)} -> ho_so_du=${hoSoDu}`);

    // [13/07/2026 dot 2, giu nguyen tu ban cu] Tach chi thi (luu_y_cho_tro_ly)
    // khoi noi dung doc (doc_cho_khach).
    return {
      success: true,
      thuTuc: procedure.title,
      ho_so_du: hoSoDu,
      con_thieu: hoSoDu ? [] : thieu,
      luu_y_cho_tro_ly:
        `Ghi chú nội bộ, TUYỆT ĐỐI KHÔNG đọc cho khách: đã đối chiếu xong` +
        `${daDuParts.length ? ` (${daDuParts.join("; ")})` : ""}. ` +
        `Đọc NGUYÊN VĂN "doc_cho_khach", KHÔNG đọc lại giấy tờ khách đã có, ` +
        `KHÔNG đọc lại toàn bộ danh sách.`,
      doc_cho_khach: toSpoken(
        hoSoDu
          ? `Dạ, hồ sơ giấy tờ của Quý Khách như vậy là đã đủ cho thủ tục ` +
          `${procedure.title}, Quý Khách chỉ cần nộp hồ sơ thôi ạ.${canhBaoKhach}`
          : `Dạ, Quý Khách còn cần ${thieu.join(", và ")}.${canhBaoKhach}`
      ),
    };
  }

  return { handleGetProcedureInfo, handleCheckMissingDocs };
}
