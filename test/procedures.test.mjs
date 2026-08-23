// test/procedures.test.mjs
//
// Giai doan 5b (xem docs/roadmap.md). Test src/domain/procedures.js - KHONG
// can ham gia (khong goi API mang), dung THANG du lieu that trong
// procedures-data.js (PROCEDURES) - moi test deu bam vao noi dung THAT cua
// 4 thu tuc, khong bia du lieu.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createProceduresHandlers } from "../src/domain/procedures.js";

function makeHandlers() {
  const logCalls = [];
  const handlers = createProceduresHandlers({ log: (level, msg) => logCalls.push({ level, msg }) });
  return { handlers, logCalls };
}

// ─── handleGetProcedureInfo: dieu huong chinh ───────────────────────────────

test("handleGetProcedureInfo: loai_thu_tuc khong hop le -> ngoai_pham_vi:true", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo({ loai_thu_tuc: "sua_ong_nuoc" }, {});
  assert.equal(out.success, false);
  assert.equal(out.ngoai_pham_vi, true);
  assert.match(out.doc_cho_khach, /không có thông tin/);
});

test("handleGetProcedureInfo: dinh_muc_nuoc + doi_tuong=doanh_nghiep (thu tuc chi ap dung ho gia dinh) -> chan, bao khong ap dung", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo({ loai_thu_tuc: "dinh_muc_nuoc", doi_tuong: "doanh_nghiep" }, {});
  assert.equal(out.success, true);
  assert.match(out.doc_cho_khach, /chỉ áp dụng cho hộ gia đình/);
  assert.equal(out.can_hoi_doi_tuong, undefined, "day la nhanh chan rieng, khong phai nhanh hoi doi tuong");
});

test("handleGetProcedureInfo: thu tuc CO phan biet doi tuong (lap_dat_dong_ho), KHONG truyen doi_tuong -> hoi mo, chua tiet lo giay to", () => {
  const { handlers } = makeHandlers();
  const callState = {};
  const out = handlers.handleGetProcedureInfo({ loai_thu_tuc: "lap_dat_dong_ho" }, callState);

  assert.equal(out.can_hoi_doi_tuong, true);
  assert.equal(out.xac_nhan_doi_tuong, undefined, "cau hoi MO, khong phai cau xac nhan echo lai");
  assert.match(out.doc_cho_khach, /hộ gia đình hay doanh nghiệp/);
  assert.ok(callState.daHoiDoiTuong.has("lap_dat_dong_ho"), "phai danh dau da hoi cho thu tuc nay");
});

test("handleGetProcedureInfo: LAN DAU truyen doi_tuong (chua qua buoc hoi) -> tra cau XAC NHAN (echo lai), CHUA tra giay to", () => {
  const { handlers } = makeHandlers();
  const callState = {};
  const out = handlers.handleGetProcedureInfo({ loai_thu_tuc: "lap_dat_dong_ho", doi_tuong: "ho_gia_dinh" }, callState);

  assert.equal(out.can_hoi_doi_tuong, true);
  assert.equal(out.xac_nhan_doi_tuong, "ho_gia_dinh");
  assert.match(out.doc_cho_khach, /xác nhận lại.*hộ gia đình/);
  assert.equal(out.so_phan_phai_doc, undefined, "chua duoc tra giay to o lan dau");
});

test("handleGetProcedureInfo: LAN HAI cung callState + doi_tuong=ho_gia_dinh -> qua gate, tra day du giay to", () => {
  const { handlers } = makeHandlers();
  const callState = {};
  handlers.handleGetProcedureInfo({ loai_thu_tuc: "lap_dat_dong_ho", doi_tuong: "ho_gia_dinh" }, callState); // lan 1: xac nhan
  const out = handlers.handleGetProcedureInfo({ loai_thu_tuc: "lap_dat_dong_ho", doi_tuong: "ho_gia_dinh" }, callState); // lan 2

  assert.equal(out.success, true);
  assert.equal(out.thuTuc, "Đăng ký lắp đặt đồng hồ nước");
  assert.equal(out.so_phan_phai_doc, 3, "1 doan required + 1 doan options + 1 doan kenh nop = 3 phan");
  assert.match(out.doc_cho_khach, /Thứ nhất.*giấy tờ BẮT BUỘC/);
  assert.match(out.doc_cho_khach, /Thứ hai.*CHỈ CẦN MỘT/);
  assert.match(out.doc_cho_khach, /Thứ ba.*Sa-qua-cô Xê-ét-ka-hát/);
  // toSpoken: CCCD -> "Căn cước công dân", SAWACO CSKH -> phien am
  assert.doesNotMatch(out.doc_cho_khach, /CCCD/);
  assert.match(out.doc_cho_khach, /Căn cước công dân/);
  assert.match(out.doc_cho_khach, /Sa-qua-cô Xê-ét-ka-hát/);
});

test("handleGetProcedureInfo: LAN HAI + doi_tuong=doanh_nghiep -> case transferToAgent -> can_chuyen_tong_dai:true, khong doc giay to", () => {
  const { handlers } = makeHandlers();
  const callState = {};
  handlers.handleGetProcedureInfo({ loai_thu_tuc: "sang_ten_dong_ho", doi_tuong: "doanh_nghiep" }, callState); // lan 1
  const out = handlers.handleGetProcedureInfo({ loai_thu_tuc: "sang_ten_dong_ho", doi_tuong: "doanh_nghiep" }, callState); // lan 2

  assert.equal(out.can_chuyen_tong_dai, true);
  assert.match(out.doc_cho_khach, /tổng đài viên hỗ trợ trực tiếp/);
  assert.equal(out.so_phan_phai_doc, undefined);
});

test("handleGetProcedureInfo: nang_doi_dong_ho (KHONG phan biet doi tuong, case 'default') -> tra ngay, dung channels RIENG cua thu tuc (khac mac dinh)", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo({ loai_thu_tuc: "nang_doi_dong_ho" }, {});

  assert.equal(out.success, true);
  assert.equal(out.can_hoi_doi_tuong, undefined, "thu tuc nay khong co case doanh_nghiep, khong can hoi doi tuong");
  assert.match(out.doc_cho_khach, /hông cần chuẩn bị giấy tờ trước/);
  // channels rieng cua nang_doi_dong_ho co nhac website (thu tuc khac khong co).
  assert.match(out.doc_cho_khach, /vê kép vê kép vê kép chấm cấp nước trung an chấm vi-en/);
});

test("handleGetProcedureInfo: quy_dinh/giai_thich_thuat_ngu CHI xuat hien cho dinh_muc_nuoc (thu tuc duy nhat co du lieu nay)", () => {
  const { handlers } = makeHandlers();
  const dinhMuc = handlers.handleGetProcedureInfo({ loai_thu_tuc: "dinh_muc_nuoc" }, {});
  assert.ok(dinhMuc.quy_dinh);
  assert.ok(dinhMuc.giai_thich_thuat_ngu);
  assert.match(dinhMuc.giai_thich_thuat_ngu, /Xê-Tê-không-bảy/, "CT07 phai duoc phien am trong giai_thich_thuat_ngu");

  const nangDoi = handlers.handleGetProcedureInfo({ loai_thu_tuc: "nang_doi_dong_ho" }, {});
  assert.equal(nangDoi.quy_dinh, undefined);
  assert.equal(nangDoi.giai_thich_thuat_ngu, undefined);
});

// ─── normalizeProcedureArgs (test GIAN TIEP qua handleGetProcedureInfo) ────

test("normalizeProcedureArgs tier 1: key co dau tieng Viet ('loại_thu_tục') van nhan dien dung", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo({ loại_thu_tục: "dinh_muc_nuoc" }, {});
  assert.equal(out.thuTuc, "Đăng ký định mức nước");
});

test("normalizeProcedureArgs tier 2b: value la TEN DAY DU thu tuc (khong phai id) van nhan dien dung", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo({ loai_thu_tuc: "Sang tên đồng hồ nước" }, {});
  assert.equal(out.thuTuc, "Sang tên đồng hồ nước");
});

test("normalizeProcedureArgs tier 3: dang co BOOLEAN (key la id, value truthy la lua chon) -> nhan dien dung", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo({ lap_dat_dong_ho: true, sang_ten_dong_ho: false }, {});
  assert.equal(out.thuTuc, "Đăng ký lắp đặt đồng hồ nước");
});

test("normalizeProcedureArgs tier 3b: dem key bang 'N/A', DUNG MOT key co gia tri co nghia -> nhan dien dung", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo(
    { dinh_muc_nuoc: "N/A", lap_dat_dong_ho: "N/A", sang_ten_dong_ho: "có", nang_doi_dong_ho: "N/A" },
    {}
  );
  assert.equal(out.thuTuc, "Sang tên đồng hồ nước");
});

test("normalizeProcedureArgs: args mo ho (2 id cung xuat hien trong value) -> KHONG doan bua, tra ngoai_pham_vi", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo({ ghi_chu: "dinh_muc_nuoc hoặc lap_dat_dong_ho" }, {});
  assert.equal(out.ngoai_pham_vi, true, "2 id cung khop -> khong ro rang, phai tu choi thay vi doan");
});

test("normalizeProcedureArgs: args rong hoan toan -> ngoai_pham_vi (khong throw)", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleGetProcedureInfo({}, {});
  assert.equal(out.ngoai_pham_vi, true);
});

// ─── handleCheckMissingDocs ─────────────────────────────────────────────────

test("handleCheckMissingDocs: loai_thu_tuc khong hop le -> ngoai_pham_vi:true", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleCheckMissingDocs({ loai_thu_tuc: "khong_ton_tai", giay_to_da_co: ["x"] });
  assert.equal(out.ngoai_pham_vi, true);
});

test("handleCheckMissingDocs: thu tuc CO phan biet doi tuong, thieu doi_tuong -> can_hoi_doi_tuong:true", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleCheckMissingDocs({ loai_thu_tuc: "lap_dat_dong_ho", giay_to_da_co: ["căn cước"] });
  assert.equal(out.can_hoi_doi_tuong, true);
});

test("handleCheckMissingDocs: doi_tuong=doanh_nghiep (case transferToAgent) -> can_chuyen_tong_dai:true", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleCheckMissingDocs({ loai_thu_tuc: "lap_dat_dong_ho", doi_tuong: "doanh_nghiep", giay_to_da_co: ["x"] });
  assert.equal(out.can_chuyen_tong_dai, true);
});

test("handleCheckMissingDocs: THIEU giay_to_da_co (mang rong) -> success:false, bao ro can truyen mang", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleCheckMissingDocs({ loai_thu_tuc: "dinh_muc_nuoc" });
  assert.equal(out.success, false);
  assert.match(out.message, /Thiếu danh sách giấy tờ/);
});

test("handleCheckMissingDocs: dinh_muc_nuoc, khach co CCCD (dang doi cua khach) -> ho_so_du:true (docMatches nhan dien dung)", () => {
  const { handlers } = makeHandlers();
  // dinh_muc_nuoc khong doi_tuong -> dung case dau tien (cccd_tphcm), required
  // = ["Bản photo Căn cước công dân (CCCD)"]. Khach noi "căn cước công dân"
  // (khong dau cach viet giong het) phai duoc docMatches nhan la khop.
  const out = handlers.handleCheckMissingDocs({ loai_thu_tuc: "dinh_muc_nuoc", giay_to_da_co: ["căn cước công dân"] });
  assert.equal(out.ho_so_du, true);
  assert.deepEqual(out.con_thieu, []);
});

test("handleCheckMissingDocs: lap_dat_dong_ho ho_gia_dinh, khach co du CA required LAN 1 trong options -> ho_so_du:true", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleCheckMissingDocs({
    loai_thu_tuc: "lap_dat_dong_ho",
    doi_tuong: "ho_gia_dinh",
    giay_to_da_co: ["căn cước công dân", "giấy phép xây dựng"],
  });
  assert.equal(out.ho_so_du, true);
});

test("handleCheckMissingDocs: lap_dat_dong_ho ho_gia_dinh, khach CHI co CCCD (thieu 1 trong options) -> ho_so_du:false, con_thieu neu ro options", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleCheckMissingDocs({
    loai_thu_tuc: "lap_dat_dong_ho",
    doi_tuong: "ho_gia_dinh",
    giay_to_da_co: ["căn cước công dân"],
  });
  assert.equal(out.ho_so_du, false);
  assert.equal(out.con_thieu.length, 1);
  assert.match(out.con_thieu[0], /MỘT trong các giấy tờ sau/);
  assert.match(out.doc_cho_khach, /còn cần/);
});

test("handleCheckMissingDocs: giay to khach noi KHONG khop giay nao -> canh bao rieng, khong bi loai bo im lang", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleCheckMissingDocs({
    loai_thu_tuc: "lap_dat_dong_ho",
    doi_tuong: "ho_gia_dinh",
    giay_to_da_co: ["giấy khai sinh con"],
  });
  assert.equal(out.ho_so_du, false);
  assert.match(out.doc_cho_khach, /giấy khai sinh con.*chưa chắc chắn/);
});

test("handleCheckMissingDocs: giay_to_da_co la 1 chuoi don (khong phai mang) -> tu dong boc thanh mang, khong throw", () => {
  const { handlers } = makeHandlers();
  const out = handlers.handleCheckMissingDocs({ loai_thu_tuc: "dinh_muc_nuoc", giay_to_da_co: "căn cước công dân" });
  assert.equal(out.ho_so_du, true);
});
