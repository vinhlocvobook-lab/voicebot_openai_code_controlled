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
//
// [SUA 25/08/2026] createReadbackMatcher() ban dau CHI xu ly 1 manh tra loi
// duy nhat - da SUA de gom nhieu manh (khach tra loi ngat quang), xem chu
// thich rieng ngay truoc ham do de biet chi tiet + bang chung that.

import { normalizeDanhBo, DANH_BO_LENGTH } from "./danh-bo-collect.js";

// ─── Buoc 1: khop cap theo THU TU (khong phai previous_item_id) ───

// [SUA 25/08/2026, xem docs/fix/giai_doan_6b_dinh_chinh_pairing_previous_
// item_id_20260824.md muc "Cap nhat 25/08/2026"] Ban dau (24/08/2026) ham
// nay CHI lay manh "user-item-added" DAU TIEN sau arm() - SAI, phat hien
// qua CAU HOI THAT cua chu du an ("khach noi ngat quang thi previous_id co
// dung duoc khong?"). Chay THAT scripts/probe-confirm-danh-bo.mjs voi 2 file
// KHACH TU GHI AM co khoang ngung ro (6b_dung_roi_ngap_ngung_noise1.wav:
// 4 manh; _noise2.wav: 2 manh) xac nhan:
//   1. Cau tra loi xac nhan (ngan, khac cau doc 11 so DAI da do o Giai doan
//      1) VAN bi VAD tach nhieu manh - KHONG the gia dinh 1 manh = het cau.
//   2. previous_item_id TREN CA HAI: input_audio_buffer.committed (da
//      chuan hoa san, buffer-committed.previousItemId) VA conversation.
//      item.added (CAP TOP-LEVEL cua event, KHAC voi cap `item` da xac
//      nhan KHONG co field nay o lan chay 24/08/2026) - noi DUNG 100% cac
//      manh cua khach voi nhau (4/4 entry, moi manh sau tro DUNG ve item_id
//      cua manh ngay truoc, khong xen ke) - CA 2 co che deu dung duoc, cho
//      ra cung 1 chuoi.
// => Sua thanh GOM (concat) TOAN BO manh "user-item-added" den SAU arm(),
// khong chi manh dau. Diem DUNG (khong phai previous_item_id, ma la tin
// hieu "response-started") de biet HET manh: trong production (Giai doan
// 6b that, model tu quyet dinh khi nao du de phan hoi/goi tool - khac voi
// probe nay dung create_response:false nen KHONG co response-started nao
// giua cac manh de doi chung That truc tiep) - AI CHI bat dau 1 response
// MOI (tra loi tiep hoac goi tool confirm_danh_bo) SAU KHI da nghe du -
// nen "response-started" la diem dung TU NHIEN. GIA DINH nay HOP LY nhung
// CHUA duoc probe truc tiep xac nhan (probe dung create_response:false co
// y de khong bi AI xen vao giua chung khi thu nghiem) - CAN kiem chung lai
// bang checkpoint that/probe khac khi lam lop tich hop (dung tool_choice/
// system prompt that cua 6b), ghi ro o day de khong quen.

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
 *   1. MOI "user-item-added" sau khi arm (CHUA "dung") -> ghi itemId vao
 *      hang doi theo THU TU den (da xac nhan that: cac manh nay LUON den
 *      lien tiep, khong xen ke - xem docs/fix o tren).
 *   2. "transcript-ready" co itemId TRUNG voi 1 itemId dang cho trong hang
 *      doi -> ghi nhan text cho itemId do.
 *   3. "response-started" -> DUNG nhan them "user-item-added" MOI (AI bat
 *      dau luot ke tiep, coi nhu khach da noi xong).
 * Khi DA dung (buoc 3) VA TOAN BO itemId trong hang doi da co transcript
 * (buoc 2 xong het, ke ca transcript den SAU response-started - do that o
 * Giai doan 1 la co the xay ra) -> getResult() tra ve
 * { itemIds: [...theo thu tu], text: <cac manh noi lai bang 1 khoang
 * trang, giong quy uoc ghep transcript da dung o turn-signal.test.mjs> }.
 * Tin hieu nao khac bi bo qua co y.
 */
export function createReadbackMatcher() {
  let armed = false;
  let readbackText = null;
  let itemOrder = []; // itemId theo THU TU "user-item-added" den, sau arm()
  let transcripts = new Map(); // itemId -> text (tu "transcript-ready")
  let stopped = false; // true sau khi thay "response-started" - het nhan item MOI
  let result = null;

  function arm(aiReadbackText) {
    armed = true;
    readbackText = aiReadbackText ?? "";
    itemOrder = [];
    transcripts = new Map();
    stopped = false;
    result = null;
  }

  function tryFinalize() {
    if (!stopped || result) return;
    if (itemOrder.length === 0) return; // chua co manh nao ca - khong the ket luan
    if (itemOrder.some((id) => !transcripts.has(id))) return; // con manh cho transcript
    result = {
      itemIds: [...itemOrder],
      text: itemOrder.map((id) => transcripts.get(id)).join(" "),
    };
  }

  function handleSignal(signal) {
    if (!armed || result || !signal || typeof signal.kind !== "string") return;

    if (signal.kind === "user-item-added") {
      if (!stopped) itemOrder.push(signal.itemId);
      return;
    }

    if (signal.kind === "transcript-ready" && itemOrder.includes(signal.itemId)) {
      transcripts.set(signal.itemId, signal.text);
      tryFinalize();
      return;
    }

    if (signal.kind === "response-started") {
      stopped = true;
      tryFinalize();
    }
  }

  return {
    arm,
    handleSignal,
    isArmed: () => armed,
    isStopped: () => stopped,
    getReadbackText: () => readbackText,
    getItemIds: () => [...itemOrder],
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
