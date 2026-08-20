// src/session/turn-signal.js
//
// Giai doan 2 (xem docs/roadmap.md). Ham THUAN: nhan vao MOT event tho tu
// OpenAI Realtime API (dung nguyen dang server gui, da qua JSON.parse),
// tra ve MOT object "tin hieu luot" da chuan hoa. KHONG mo ket noi, KHONG
// goi API, KHONG giu state gi ca - cung mot input luon ra cung mot output.
//
// Muc dich: cac lop phia tren (turn-controller.js - Giai doan 3,
// call-flow/* - Giai doan 6...) chi lam viec voi field `kind` va cac field
// da duoc dat ten lai o day, khong dung truc tiep ten field goc cua
// OpenAI nua - sau nay OpenAI doi ten field thi chi sua 1 cho.
//
// Danh sach event duoc chuan hoa dua tren du lieu THAT da quan sat o Giai
// doan 1 (xem docs/fix/giai_doan_1_quan_sat_event_that_20260820.md), KHONG
// phai doan tu tai lieu:
//   - input_audio_buffer.speech_started / speech_stopped
//   - input_audio_buffer.committed (co previous_item_id - quan trong de
//     biet 1 luot noi co bi VAD tach thanh nhieu manh hay khong)
//   - conversation.item.input_audio_transcription.completed
//   - response.created / response.done (status: completed | cancelled)
//   - error
// Event nao chua gap/chua can dung se roi vao nhanh "ignored" - khong lam
// crash, chi bao hieu "chua xu ly", de call-flow tu quyet dinh co bo qua
// that hay khong.

export function normalizeTurnEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent.type !== "string") {
    return { kind: "ignored", rawType: undefined };
  }

  switch (rawEvent.type) {
    case "input_audio_buffer.speech_started":
      return { kind: "speech-started", atMs: rawEvent.audio_start_ms };

    case "input_audio_buffer.speech_stopped":
      return { kind: "speech-stopped", atMs: rawEvent.audio_end_ms };

    case "input_audio_buffer.committed":
      return {
        kind: "buffer-committed",
        itemId: rawEvent.item_id,
        // previous_item_id != null nghia la manh nay noi tiep 1 manh
        // truoc do cung mot chuoi commit lien tuc (xem thi nghiem A,
        // Giai doan 1) - can de call-flow tu xau chuoi neu con dung VAD.
        previousItemId: rawEvent.previous_item_id ?? null,
      };

    case "conversation.item.input_audio_transcription.completed":
      return {
        kind: "transcript-ready",
        itemId: rawEvent.item_id,
        text: rawEvent.transcript ?? "",
      };

    case "response.created":
      return {
        kind: "response-started",
        responseId: rawEvent.response?.id ?? null,
      };

    case "response.done":
      return {
        kind: "response-ended",
        responseId: rawEvent.response?.id ?? null,
        status: rawEvent.response?.status ?? "unknown",
      };

    case "error":
      return { kind: "error", raw: rawEvent.error ?? rawEvent };

    default:
      return { kind: "ignored", rawType: rawEvent.type };
  }
}
