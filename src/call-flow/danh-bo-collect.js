// src/call-flow/danh-bo-collect.js
//
// Giai doan 6a (xem docs/roadmap.md). Ham THUAN: gom chu so ma danh bo tu
// nhieu luot noi cua khach. Ly do can gom nhieu luot: VAD "digits" mode
// (server_vad, xem session-ws.js buildTurnDetectionConfig) co the tach 1
// lan doc cua khach thanh NHIEU buffer-committed/transcript-ready rieng
// (silence_duration_ms 2000 - khach ngung tho giua chung cac cum so van bi
// tinh la 1 luot xong) - moi manh phai duoc CONG DON, khong duoc THAY THE.
// KHONG goi API, KHONG tu giu state toan cuoc goi o day - nhan/tra ve MOT
// object session do BEN GOI (module dieu phoi, se viet sau) tu tao/quan ly
// vong doi: 1 session MOI cho MOI lan bat dau doc lai tu dau (vd sau khi
// khach bao "sai" o buoc xac nhan) - KHONG tai su dung 1 session cu qua
// nhieu lan doc khac nhau, tranh so cu/moi lan vao nhau.
//
// Toan bo logic + tham so PORT NGUYEN VAN tu ban cu (voice_bot/src/tools.js:
// normalizeDanhBo/viDigitsFromWords dong 96-136, danhBoSpoken/DIGIT_WORDS
// dong 155-157, DANH_BO_LENGTH dong 138; voice_bot/src/session-ws.js:
// _looksLikeDigitTurn/_DIGIT_WORD_RE dong 169-175) - da doi chieu qua agent
// nghien cuu + doc truc tiep ban cu 23/08/2026, KHONG doan.
//
// DON GIAN HOA CO Y so voi ban cu (khac hop dong, khong phai thieu sot):
// ban cu con giu callState._danhBoTranscripts (kho quan sat cho TRONG TAI
// gpt-5.1 doi chieu nhieu nguon - resolveDanhBo/verifyDanhBoFromSession,
// tools.js dong ~790+) - thuoc co che "co-pilot ngam" cua Giai doan 6b,
// CHUA lam o day. Giai doan 6a la CODE tu gom so DETERMINISTIC (khong
// trong tai, khong doi chieu nhieu ung vien) - nen o day CHI giu digits +
// turns can cho viec gom + doc lai xac nhan, khong giu kho quan sat rieng
// cho trong tai (se bo sung khi lam Giai doan 6b, khong sua lai ham o day).

// Bo dau tieng Viet + ha chu thuong - dung de so khop chu so doc bang loi.
// [nguon: voice_bot/src/tools.js _deAccent, dong 65-71]
function deAccent(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

// Chu so doc bang loi tieng Viet (da bo dau) -> chu so.
// [nguon: voice_bot/src/tools.js _VI_DIGIT_WORDS, dong 74-79]
const VI_DIGIT_WORDS = {
  khong: "0", linh: "0", le: "0",
  mot: "1", hai: "2", hay: "2", ba: "3", ban: "3",
  bon: "4", tu: "4", nam: "5", lam: "5",
  sau: "6", bay: "7", tam: "8", chin: "9",
};

/**
 * Ghep chuoi DOC THANH CHU ("Hai - Hai - Không - Hai - Ba...") thanh chu
 * so. Tim CHUOI LIEN TUC DAI NHAT gom toan token chu so (>=3 token lien
 * tiep) - bo qua tu khung cau xen dau/cuoi/giua (vd "Số danh bộ LÀ hai hai
 * không..."). Cau binh thuong lo co 1-2 tu trung chu so (vd "một chút")
 * KHONG du dai de tinh la doc so.
 * [fix that 30/07/2026, ban cu - cuoc rtc_u1_E7JWxaN1u2ZbQG9SnKbwh: ban cu
 * hon yeu cau MOI token trong CA cau deu la chu so, chi 1 tu khung cau xen
 * vao la bi bo TOAN BO ca luot doc dung]
 */
export function viDigitsFromWords(raw) {
  const tokens = deAccent(raw).split(/[^a-z]+/).filter(Boolean);
  if (tokens.length === 0) return "";
  let best = "";
  let cur = "";
  for (const t of tokens) {
    if (t in VI_DIGIT_WORDS) {
      cur += VI_DIGIT_WORDS[t];
    } else {
      if (cur.length > best.length) best = cur;
      cur = "";
    }
  }
  if (cur.length > best.length) best = cur;
  return best.length >= 3 ? best : "";
}

/**
 * Chuan hoa 1 luot noi thanh chu so: bo het ky tu khong phai so (ASCII);
 * neu ra RONG, thu ghep tu chu so doc bang loi (model/ASR hay echo lai
 * dang "Hai - Hai - Không..." thay vi chu so, xem viDigitsFromWords).
 * [fix that 23/07/2026, ban cu - cuoc E4jVVW...: bo qua nhanh fallback nay
 * lam mot danh bo DUNG (22023251775, khach doc thanh chu) bi hieu nham la
 * "khach bao sai" vi strip ky tu ra rong]
 */
export function normalizeDanhBo(raw) {
  let normalized = String(raw ?? "").replace(/\D/g, "");
  if (normalized.length === 0) {
    const fromWords = viDigitsFromWords(raw);
    if (fromWords) normalized = fromWords;
  }
  return normalized;
}

// [nguon: voice_bot/src/tools.js DANH_BO_LENGTH, dong 138]
export const DANH_BO_LENGTH = 11;

const DIGIT_WORDS = ["Không", "Một", "Hai", "Ba", "Bốn", "Năm", "Sáu", "Bảy", "Tám", "Chín"];

/**
 * Doc lai 1 chuoi so THEO TUNG CHU SO ("22023251775" -> "Hai - Hai - Không
 * - Hai - Ba - Hai - Năm - Một - Bảy - Bảy - Năm"). Dung lam noi dung cho
 * turnController.say({mode:"verbatim", text}) khi doc lai xin xac nhan -
 * TTS doc mot day 11 so LIEN nhu 1 so lon se sai/kho nghe.
 * [nguon: voice_bot/src/tools.js danhBoSpoken, dong 155-157]
 */
export function danhBoSpoken(s) {
  return String(s).split("").map((d) => DIGIT_WORDS[+d] ?? d).join(" - ");
}

// Nguong nhan dien "luot nay co ve dang doc chu so" - CO Y khac
// VI_DIGIT_WORDS o tren: regex nay RONG hon (them "mươi"/"mười"/"mốt"/
// "tư"/"lăm" - cac tu chi xuat hien trong so GHEP nhu "hai mươi mốt",
// khong tu dung mot minh de TRICH 1 chu so rieng) - CHI dung de DEM/loc
// tho, khong dung de trich (viDigitsFromWords o tren moi la ham trich).
// [nguon: voice_bot/src/session-ws.js _DIGIT_WORD_RE, dong 169]
const DIGIT_WORD_RE = /(?:không|một|mốt|hai|ba|bốn|tư|năm|lăm|sáu|bảy|tám|chín|mươi|mười)(?=\s|$|[,.!?])/gi;

/**
 * true neu luot noi cua khach "co ve" dang doc chu so - bo loc THO, dung
 * de quyet dinh co dua luot noi nay vao bo gom danh bo hay khong (viec
 * trich so that do normalizeDanhBo lam). >=3 ky tu so LIEN tiep (vd ASR
 * phien am thanh chuoi so lien "232474431") HOAC >=3 tu chi so doc rieng
 * (vd "hai hai không...").
 * [fix that 19/07/2026 v2, ban cu - cuoc E3IwDpl3qXKJ2hoRtHHRU: regex cu
 * chi khop so doc TACH TUNG CHU, bo sot ASR phien am thanh chuoi so LIEN]
 * [nguon: voice_bot/src/session-ws.js _looksLikeDigitTurn, dong 170-175]
 */
export function looksLikeDigitTurn(text) {
  const s = String(text ?? "");
  const digitChars = (s.match(/\d/g) || []).length;
  if (digitChars >= 3) return true;
  return (s.match(DIGIT_WORD_RE) || []).length >= 3;
}

// ─── Session gom so cho MOT lan doc (xem ghi chu dau file ve vong doi) ───

/** Tao session gom so moi, rong. */
export function createDanhBoSession() {
  return { digits: "", turns: [] };
}

/**
 * Ghi 1 luot transcript vao session: digits duoc NOI TIEP (khong thay
 * the) - khop dung co che noteDanhBoTranscript cua ban cu (tools.js dong
 * 236-250), chi bo phan callState._danhBoTranscripts/logger (thuoc trong
 * tai Giai doan 6b, xem ghi chu dau file). Tra ve chinh session (chain
 * duoc neu can). `turns` giu lai tung manh tho + da chuan hoa - phuc vu
 * log/debug, KHONG dung de tinh isDanhBoComplete (chi dung session.digits).
 */
export function noteDanhBoDigits(session, text) {
  const digits = normalizeDanhBo(text);
  session.turns.push({ text, digits });
  session.digits += digits;
  return session;
}

/** So chu so da gom duoc trong session hien tai. */
export function danhBoDigitCount(session) {
  return session.digits.length;
}

/** true khi da gom du DANH_BO_LENGTH (11) chu so tro len. */
export function isDanhBoComplete(session) {
  return session.digits.length >= DANH_BO_LENGTH;
}

/**
 * Ung vien danh bo (11 SO DAU TIEN da gom duoc) de doc lai xin xac nhan/
 * dem tra API - null neu chua du 11 so. [don gian hoa CO Y so voi ban cu -
 * xem ghi chu dau file: ban cu dung TRONG TAI doi chieu nhieu ung vien khi
 * co qua/thieu so, o day CHI lay 11 so dau tien theo thu tu khach da doc,
 * so du (neu khach doc lo qua 11 so) bi BO - KHONG doan them logic doi
 * chieu, de danh cho Giai doan 6b neu thuc te can].
 */
export function danhBoCandidate(session) {
  if (!isDanhBoComplete(session)) return null;
  return session.digits.slice(0, DANH_BO_LENGTH);
}
