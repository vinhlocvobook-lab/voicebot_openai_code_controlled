// src/call-flow/danh-bo-readback-match.js
//
// Giai doan 6b (xem docs/roadmap.md muc "Giai doan 6b" va docs/fix/
// giai_doan_6b_dinh_chinh_pairing_previous_item_id_20260824.md). Hai ham
// THUAN cho buoc 1-2-3-4 cua thiet ke "Phuong an B: model tu thu thap + code
// doi chieu": (1) khop cap "cau AI vua doc lai xin xac nhan" voi "cau khach
// tra loi ngay sau do", (2)-(4) trich so tu CHINH cau AI doc lai roi so
// sanh voi gia tri tool `confirm_danh_bo(value)` model gui.
//
// PHAM VI CO Y CUA FILE NAY (khong lam qua): CHI 2 buoc matcher/doi chieu,
// dung DUNG mau "module thuan, ben goi tu quan ly vong doi" da ap dung
// xuyen suot du an (xem danh-bo-collect.js/danh-bo-confirm.js dau file cua
// chung). CHUA lam (con lai thuoc lop tich hop - se thiet ke rieng, CAN
// THAO LUAN THEM truoc khi viet, KHONG doan o day):
//   - Khi nao goi arm() (ben goi - tool-handler cho confirm_danh_bo, CHUA
//     VIET - tu quyet dinh dua vao ngu canh nghiep vu, vd ngay khi nhan
//     "ai-said" ma no cho la cau doc lai xin xac nhan).
//   - Dinh nghia tool `confirm_danh_bo(value)` (schema, dang ky vao
//     tool-router.js) va system prompt cho model (Entity Collection
//     Workflow - xem skill realtime-voice-prompting).
//   - Buoc 5 (cache vao callState, doi chieu moi lan tra cuu ke tiep).
//   - Buoc 6 (khong khop cap duoc/khach tu choi -> "khong ket luan duoc",
//     quay lai xin doc lai hoac leo thang DTMF - phu thuoc watchdog Giai
//     doan 7, chua co).
//   - Buoc 2.5 (trong tai gpt-5.1 doc lap khi so trich duoc LECH voi ASR
//     goc cua luot khach doc so ban dau).

import { normalizeDanhBo, DANH_BO_LENGTH } from "./danh-bo-collect.js";

// ─── Buoc 1: khop cap theo THU TU (khong phai previous_item_id) ───

/**
 * Tao 1 "phien" khop cap cho MOT lan AI doc lai xin xac nhan - dung vong
 * doi voi createDanhBoSession() cua danh-bo-collect.js (1 phien MOI cho MOI
 * lan doc lai, khong tai su dung qua nhieu lan khac nhau).
 *
 * Dung: goi arm(aiReadbackText) ngay khi ben goi nhan ra 1 tin hieu
 * "ai-said" la CAU DOC LAI XIN XAC NHAN (khong phai loi AI noi khac trong
 * cuoc goi - module nay KHONG tu doan, ben goi phai tu xac dinh dieu do qua
 * ngu canh nghiep vu). Sau do goi handleSignal(signal) voi MOI tin hieu
 * turn-signal.js tiep theo, theo DUNG thu tu chung den:
 *   1. "user-item-added" DAU TIEN sau khi arm -> ghi lai itemId, cho la
 *      item cua luot tra loi cua khach (xem bang moc thoi gian that trong
 *      docs/fix/giai_doan_6b_dinh_chinh_... - item nay LUON den sau
 *      conversation.item.done cua luot AI doc lai, khong xen ke).
 *   2. "transcript-ready" co itemId TRUNG voi item vua ghi o (1) -> khop
 *      cap xong, getResult() tra ve { itemId, text }.
 * Tin hieu nao khac (vd "speech-started"/"response-started" xen giua) bi
 * bo qua co y - khong lam gian doan viec cho khop cap.
 */
export function createReadbackMatcher() {
  let armed = false;
  let readbackText = null;
  let pendingItemId = null;
  let result = null;

  function arm(aiReadbackText) {
    armed = true;
    readbackText = aiReadbackText ?? "";
    pendingItemId = null;
    result = null;
  }

  function handleSignal(signal) {
    if (!armed || result || !signal || typeof signal.kind !== "string") return;

    if (signal.kind === "user-item-added") {
      // Chi lay item DAU TIEN sau arm - dung tinh huong "1 lan doc lai, 1
      // lan tra loi" da xac nhan bang probe that. Nhieu item lien tiep
      // (vd nhieu, tap am) CHUA co bang chung that - de lai cho lan gap
      // that sau, khong doan truoc.
      if (pendingItemId === null) pendingItemId = signal.itemId;
      return;
    }

    if (signal.kind === "transcript-ready" && pendingItemId !== null && signal.itemId === pendingItemId) {
      result = { itemId: signal.itemId, text: signal.text };
    }
  }

  return {
    arm,
    handleSignal,
    isArmed: () => armed,
    getReadbackText: () => readbackText,
    getPendingItemId: () => pendingItemId,
    getResult: () => result,
  };
}

// ─── Buoc 2-3-4: trich so tu cau AI doc lai + so sanh voi gia tri tool ───

/**
 * B2-3-4 cua thiet ke Giai doan 6b: trich day so TU CHINH cau AI da doc
 * lai (khong phai ASR cua khach - xem ly do trong docs/roadmap.md: day la
 * chuoi XAC DINH model tu sinh ra, khong phai audio can nhan dien), roi so
 * sanh voi `toolValue` (gia tri model gui kem tool `confirm_danh_bo`):
 *   - Khong trich duoc du DANH_BO_LENGTH so ro rang tu aiReadbackText ->
 *     "unclear" (B6, chua ket luan duoc - ben goi tu quyet dinh xin doc
 *     lai/leo thang, KHONG lam o day).
 *   - toolValue KHOP voi so da trich -> "match" (B3, dung duoc ngay).
 *   - toolValue LECH -> "override" (B4, dung so DA TRICH tu cau AI doc lai,
 *     KHONG dung so tool gui - ben goi tu bao lai cho model qua tool
 *     result de model noi nhat quan ve sau, KHONG lam o day).
 * Dung normalizeDanhBo() (danh-bo-collect.js) cho ca 2 chuoi - ham nay da
 * xu ly duoc CA dang so lien (ASR/tool co the tra chuoi so thuan) LAN dang
 * doc thanh chu ("Hai - Hai - Không...", cach danhBoSpoken() sinh ra cau
 * doc lai o Giai doan 6a - Giai doan 6b nhieu kha nang cau model tu sinh
 * cung dang tuong tu, KHONG bia them logic trich rieng).
 */
export function resolveConfirmDanhBo({ toolValue, aiReadbackText }) {
  const readbackDigits = normalizeDanhBo(aiReadbackText);
  if (readbackDigits.length < DANH_BO_LENGTH) {
    return { status: "unclear", readbackDigits, value: null };
  }
  const readback = readbackDigits.slice(0, DANH_BO_LENGTH);
  const tool = normalizeDanhBo(toolValue);
  if (tool === readback) {
    return { status: "match", readbackDigits: readback, value: readback };
  }
  return { status: "override", readbackDigits: readback, value: readback };
}
