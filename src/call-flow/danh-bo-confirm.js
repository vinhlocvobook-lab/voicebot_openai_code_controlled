// src/call-flow/danh-bo-confirm.js
//
// Giai doan 6a (xem docs/roadmap.md). Ham THUAN: phan loai 1 luot noi cua
// khach thanh xac nhan/tu choi/xin nhac lai - dung khi dang cho khach XAC
// NHAN 1 cau da doc lai (vd doc lai 11 so danh bo qua
// turnController.say({mode:"verbatim"}), hoi "co dung khong?").
//
// PORT tu ban cu (voice_bot/src/session-ws.js, dong 185-226) - GIU NGUYEN
// thu tu kiem tra + cac fix that da ghi trong comment goc (bug \b-boundary
// voi "ừ/ờ", quy uoc "?" luon coi la KHONG xac nhan) - KHONG doan lai/sua
// lai thu tu, vi thu tu kiem tra CHINH LA noi da tung co bug that (xem
// tung ham duoi day). CO 1 CHO SUA KHAC BAN CU (khong phai "port nguyen
// van" 100%): KHANG_DINH_RE bo \b quanh "được" - ban cu dung \bđược\b la
// CODE CHET (khong bao gio khop, cung loai bug \b+dau tieng Viet da tung
// duoc phat hien/sua cho "ừ/ờ" nhung rieng cho "được" thi chua - xem ghi
// chu ngay 23/08/2026 tai khai bao KHANG_DINH_RE).

// [nguon: voice_bot/src/session-ws.js _KHANG_DINH_RE, dong 185 - CO 1 SUA
// KHAC BAN CU, xem ghi chu ngay ben duoi]
//
// [fix that 23/08/2026, phat hien khi PORT sang day - test tu dong
// isAffirmative("được") that bai] Ban cu dung `\bđược\b` - NHUNG \b cua JS
// chi coi ky tu ASCII [A-Za-z0-9_] la "word", nen "đ" (co dau) LUON la
// non-word - vi tri dau chuoi/sau khoang trang truoc "đ" khong bao gio
// duoc JS tinh la 1 bien (\b doi hoi 1 ben la word, 1 ben la non-word; ca
// 2 ben deu non-word thi khong co bien). Ket qua: `\bđược\b` KHONG BAO GIO
// khop, voi BAT KY chuoi nao chua "được" o BAT KY vi tri nao (da kiem
// chung: /\bđược\b/i.test("được") === false) - CUNG mot loai loi da tung
// duoc phat hien va sua cho "ừ/ờ" o KHANG_DINH_TU_DON_RE ben duoi (cuoc
// rtc_u1_E7L7Y2XD6JGGx1oQkIjAj), nhung rieng cho "được" o KHANG_DINH_RE thi
// ban cu chua tung phat hien/sua - nhanh "được" la CODE CHET tu luc viet ra.
// Sua: bo \b quanh "được", dung khop chuoi con (nhu cac tu khac trong cung
// regex nay - "đúng"/"chính xác"/... deu khong co \b). Da kiem tra khong
// co tu tieng Viet thong dung nao khac chua "được" nhu mot chuoi con gay
// khop nham (vd "đường" KHONG chua "được" - khac dau ở/ượ).
const KHANG_DINH_RE = /(đúng|chính xác|chuẩn|phải rồi|vâng|dạ đúng|\bok\b|\boke\b|được|yes)/i;

// [fix that 30/07/2026, ban cu - cuoc rtc_u1_E7L7Y2XD6JGGx1oQkIjAj] \b cua JS
// coi MOI ky tu co dau tieng Viet la ky tu "khong phai chu" (non-word), nen
// \bờ\b tung khop CA KHI "ờ" nam giua hai chu cai ASCII cua 1 tu KHAC hoan
// toan khong lien quan (vd "dời" = d+ờ+i -> JS coi "d->ờ" va "ờ->i" DEU la
// bien - \bờ\b khop nham). Cau that: khach noi "Mình muốn nâng dời đồng hồ."
// (xin doi lich ghi dong ho, khong lien quan xac nhan) van bi tinh la
// confirmed=true chi vi chua "dời". Cung rui ro voi "từ", "giờ", "chờ",
// "sợ"... deu la tu cuc ky pho bien. Sua: CHI coi "ừ/ừm/ờ" la xac nhan khi
// no la CA MOT TU RIENG trong 1 cau NGAN (<=2 tu, bo dau cau) - kiem tra
// bang cach tach token roi so KHOP CHINH XAC tung token, khong dung \b tren
// ca cau. [nguon: _KHANG_DINH_TU_DON_RE, dong 197]
const KHANG_DINH_TU_DON_RE = /^(ừ+|ừm|ờ+)$/i;

// [nguon: voice_bot/src/session-ws.js _PHU_DINH_RE, dong 198]
const PHU_DINH_RE = /(không đúng|chưa đúng|sai rồi|\bsai\b|chưa phải|không phải)/i;

// [fix that 27/07/2026, ban cu] Khach xin nghe/doc LAI cau bot vua noi
// (khong phai doi sang chu de khac). [nguon: _XIN_NHAC_LAI_RE, dong 200]
const XIN_NHAC_LAI_RE = /((đọc|nói|nhắc)\s+lại|chưa nghe rõ|nghe không rõ|không nghe rõ|nói gì)/i;

/**
 * true neu luot noi la XAC NHAN ("đúng", "vâng", "ok", hoac tu don "ừ/ờ"
 * dung 1 minh trong cau ngan). Thu tu kiem tra CO Y, PORT NGUYEN VAN ban
 * cu (_isAffirmative, dong 201-226) - KHONG doi thu tu:
 *   1. Co PHU_DINH_RE -> false NGAY (uu tien phu dinh - tranh cau "vâng,
 *      ...sai rồi ạ" bi tinh la xac nhan chi vi mo dau bang "vâng").
 *   2. Co dau "?" trong cau -> false (an toan mac dinh: 1 cau HOI khong
 *      bao gio duoc tinh la xac nhan, du lo chua tu khang dinh o dau/cuoi
 *      - tranh lo du lieu cua khach khac khi doan nham 1 cau hoi thanh xac
 *      nhan. [fix that 31/07/2026 dot 12, ban cu - cuoc
 *      rtc_u1_E7Z0LRZnTro02qMeeISyy: "Vâng, cho mình hỏi... được không ạ?"
 *      la cau HOI chu KHONG PHAI xac nhan, tung bi chot nham vi co "vâng"/
 *      "được"])
 *   3. Khop KHANG_DINH_RE (o BAT KY DAU trong cau) -> true.
 *   4. Cau <=2 tu (sau khi bo dau cau) VA co it nhat 1 tu KHOP CHINH XAC
 *      KHANG_DINH_TU_DON_RE -> true (xem giai thich bug \b o tren).
 *   Khong khop dieu kien nao -> false (khong ro rang, ben goi tu quyet
 *   dinh xu ly - vd hoi lai).
 */
export function isAffirmative(text) {
  const s = String(text ?? "").trim();
  if (PHU_DINH_RE.test(s)) return false;
  if (/\?/.test(s)) return false;
  if (KHANG_DINH_RE.test(s)) return true;
  const tokens = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.length > 0 && tokens.length <= 2 && tokens.some((tok) => KHANG_DINH_TU_DON_RE.test(tok));
}

/** true neu luot noi la TU CHOI ro rang ("không đúng", "sai rồi", "chưa phải"...). */
export function isNegative(text) {
  return PHU_DINH_RE.test(String(text ?? ""));
}

/** true neu khach xin nghe/doc LAI cau bot vua noi. */
export function wantsRepeat(text) {
  return XIN_NHAC_LAI_RE.test(String(text ?? ""));
}
