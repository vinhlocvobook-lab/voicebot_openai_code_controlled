// src/domain/procedures-data.js
//
// Giai doan 5b (xem docs/roadmap.md). Port NGUYEN VAN tu ban cu
// (voice_bot/src/huongdanthutuc-data.js) - day la DU LIEU THAM CHIEU
// (thu tuc hanh chinh, giay to can), KHONG phai logic - khong co gi de
// "don dep vay race" o day, copy dung.
//
// Du lieu thu tuc hanh chinh cho tool get_procedure_info/check_missing_docs.
// [11/07/2026, ban cu] Cap nhat theo docs/huongdanthutuc_20260711.md (kich
// ban chinh thuc):
// - Dinh muc nuoc: phan theo CCCD TP.HCM / CCCD tinh khac (CT07/CT08/VNeID).
// - Gan dong ho ho gia dinh: CCCD chinh chu + 1 trong 3 giay to (rut gon tu 10).
// - Gan dong ho & sang ten cho DOANH NGHIEP: chuyen tong dai vien (transferToAgent).
// - Website www.capnuoctrungan.vn chi la kenh dang ky cua thu tuc nang/doi.
// - Thu tuc NGOAI danh sach nay: chuyen tong dai vien hoac tao phieu (xu ly o procedures.js).
//
// Quy uoc requiredDocs:
// - required: can DAY DU tat ca.
// - options:  chi can MOT trong so do.
// - optional: giay to bo sung TUY TRUONG HOP (khong bat buoc).
// - note:     chi doc khi khong co 3 danh sach tren.
// Case co transferToAgent: true -> khong huong dan giay to, moi chuyen tong dai vien/tao phieu.
export const PROCEDURES = {
  dinh_muc_nuoc: {
    id: "dinh_muc_nuoc",
    title: "Đăng ký định mức nước",
    purpose: "Đăng ký số nhân khẩu để được tính định mức nước sinh hoạt theo quy định.",
    // Thủ tục CHỈ dành cho hộ gia đình — tools.js dùng field này để chặn khi
    // khách hỏi cho doanh nghiệp/công ty.
    apDung: "ho_gia_dinh",
    // [11/07/2026] Quy định đối tượng — đồng bộ với huongdanthutuc_20260711.md.
    // Trả về cho AI qua field "quy_dinh" để trả lời "ai được đăng ký / được mấy người".
    quyDinh:
      "Thủ tục đăng ký định mức nước CHỈ áp dụng cho hộ gia đình, KHÔNG áp dụng " +
      "cho doanh nghiệp hay công ty. " +
      "Người có CCCD tại TP.HCM, không tính khu vực Bình Dương và Vũng Tàu cũ, chỉ cần " +
      "bản photo CCCD. Người có CCCD ở tỉnh khác cần Xác nhận cư trú CT07 hoặc CT08, " +
      "hoặc thông tin cư trú trên VNeID tại địa chỉ muốn đăng ký. " +
      "Người KHÔNG chứng minh được cư trú tại địa chỉ thì KHÔNG được tính định mức. " +
      "Số người đăng ký được = số người có giấy tờ chứng minh. " +
      "Ví dụ: nhà 8 người, 4 có CCCD TP.HCM, 2 có xác nhận cư trú CT07/CT08 đầy đủ, " +
      "2 không có giấy tờ cư trú → đăng ký được 6 người; 2 người còn lại nên đăng ký " +
      "cư trú trước rồi bổ sung sau.",
    // [13/07/2026] Giải thích thuật ngữ CT07/CT08 — dùng khi khách hỏi/thắc mắc
    // "CT07 là gì", "xác nhận cư trú là gì", "xin ở đâu". Nguồn: Thông tư
    // 66/2023/TT-BCA (tổng hợp từ luatvietnam.vn, thuvienphapluat.vn 13/07/2026).
    thuatNgu:
      "CT07 là Giấy xác nhận thông tin về cư trú, do Công an cấp xã/phường cấp theo " +
      "mẫu của Bộ Công an, dùng để chứng minh nơi thường trú hoặc tạm trú của mình. " +
      "CT08 là Thông báo kết quả giải quyết đăng ký cư trú (thường trú/tạm trú), cũng " +
      "do công an cấp. " +
      "Cách xin: đến trực tiếp Công an xã/phường bất kỳ (không phụ thuộc nơi cư trú), " +
      "hoặc nộp online qua Cổng dịch vụ công Bộ Công an hay ứng dụng VNeID — hoàn toàn " +
      "miễn phí. Kết quả có trong khoảng nửa ngày đến 3 ngày làm việc. " +
      "Giấy có giá trị 1 năm kể từ ngày cấp (riêng người chưa có nơi thường trú/tạm trú " +
      "là 6 tháng); nếu thông tin cư trú thay đổi thì giấy hết giá trị từ lúc thay đổi.",
    cases: [
      {
        id: "cccd_tphcm",
        label: "Có CCCD tại TP.HCM, không tính khu vực Bình Dương và Vũng Tàu cũ",
        requiredDocs: {
          required: ["Bản photo Căn cước công dân (CCCD)"],
        },
      },
      {
        id: "cccd_tinh_khac",
        label: "Có CCCD ở tỉnh khác",
        requiredDocs: {
          note: "Cung cấp một trong các giấy tờ sau, tại địa chỉ muốn đăng ký",
          options: [
            "Xác nhận cư trú CT07 hoặc CT08 tại địa chỉ muốn đăng ký",
            "Thông tin cư trú trên ứng dụng VNeID tại địa chỉ muốn đăng ký",
          ],
        },
      },
    ],
  },

  lap_dat_dong_ho: {
    id: "lap_dat_dong_ho",
    title: "Đăng ký lắp đặt đồng hồ nước",
    purpose:
      "Đăng ký gắn đồng hồ nước mới tại địa chỉ sử dụng nước. " +
      "Giấy tờ cần sao y còn hiệu lực trong vòng 6 tháng hoặc có bản chính để đối chiếu.",
    cases: [
      {
        id: "ho_gia_dinh",
        label: "Hộ gia đình",
        requiredDocs: {
          required: ["Căn cước công dân (CCCD) chính chủ"],
          options: [
            "Giấy chứng nhận quyền sở hữu nhà ở, quyền sử dụng đất ở",
            "Hợp đồng chuyển quyền sở hữu nhà lập tại cơ quan Nhà nước nơi có căn nhà tọa lạc, đã nộp lệ phí trước bạ và đăng ký",
            "Giấy phép xây dựng nhà",
          ],
        },
      },
      {
        // [11/07/2026] Doanh nghiệp đăng ký gắn đồng hồ → chuyển tổng đài viên.
        id: "doanh_nghiep",
        label: "Doanh nghiệp, công ty",
        transferToAgent: true,
      },
    ],
  },

  sang_ten_dong_ho: {
    id: "sang_ten_dong_ho",
    title: "Sang tên đồng hồ nước",
    purpose: "Thay đổi tên chủ hợp đồng sử dụng nước sang chủ sở hữu mới.",
    cases: [
      {
        id: "ho_gia_dinh",
        label: "Hộ gia đình",
        requiredDocs: {
          required: [
            "Số danh bạ đồng hồ nước tại nơi đăng ký",
            "Bản sao có chứng thực giấy chứng nhận quyền sử dụng đất / quyền sở hữu nhà ở và tài sản khác gắn liền với đất",
          ],
          optional: [
            "Bản sao có chứng thực giấy chứng nhận số nhà (nếu địa chỉ có thay đổi so với địa chỉ trên hóa đơn tiền nước)",
            "Hồ sơ đăng ký định mức nước (nếu có nhu cầu)",
          ],
        },
      },
      {
        // [11/07/2026] Doanh nghiệp sang tên → chuyển tổng đài viên.
        id: "doanh_nghiep",
        label: "Doanh nghiệp, công ty",
        transferToAgent: true,
      },
    ],
  },

  nang_doi_dong_ho: {
    id: "nang_doi_dong_ho",
    title: "Nâng/Dời đồng hồ nước",
    purpose:
      "Thay đổi vị trí hoặc nâng cấp đồng hồ nước hiện có. ",
    // [11/07/2026] Kênh website chỉ áp dụng cho thủ tục này (theo tài liệu mới).
    channels:
      "Đăng ký qua: app SAWACO CSKH, website www.capnuoctrungan.vn, hoặc trực tiếp tại " +
      "văn phòng 873A Quang Trung, phường An Hội Tây, TP.HCM hoặc 540 Hà Huy Giáp, phường An Phú Đông, TP.HCM.",
    cases: [
      {
        id: "default",
        label: "Mọi trường hợp",
        requiredDocs: {
          note: "Không cần chuẩn bị giấy tờ trước",
        },
      },
    ],
  },
};
