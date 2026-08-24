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
//   - response.output_audio_transcript.done (Giai doan 5a, 23/08/2026 -
//     bo sung sau khi phat hien qua thao luan: lời AI noi KHONG he duoc
//     chuan hoa, trong khi loi NGUOI DUNG noi (transcript-ready ben duoi)
//     thi co - lech doi xung khong co ly do. Xac nhan bang du lieu THAT
//     (khong doan), copy nguyen tu logs/probe-tool-call-1787384731754.jsonl:
//     {"type":"response.output_audio_transcript.done","response_id":
//     "resp_EFahxMiakpgtNmPzvHapH","item_id":"item_EFahxiJmGpoiZKLMgS7BC",
//     "output_index":0,"content_index":0,"transcript":"Ok, để tôi xem thử
//     hóa đơn tháng này cho bạn nhé."} - dung field `transcript` day du cau,
//     KHONG can rap tu cac manh .delta (giong cach transcript-ready duoi
//     day chi dung .completed, khong dung .delta cua nguoi dung). CHỈ chuan
//     hoa .done - .delta (tung chu mot) VAN CO CHU DICH roi vao ignored,
//     giong nguyen tac da ap dung cho input_audio_transcription.delta.
//   - response.function_call_arguments.done (Giai doan 5a, 22/08/2026 -
//     xem scripts/probe-tool-call.mjs va docs/roadmap.md) - model xin goi
//     tool. Quan sat that xac nhan tool-call KHONG phai 1 lifecycle rieng:
//     no la 1 output item nam TRONG 1 response binh thuong (cung response
//     co the vua co audio "commentary" vua co function_call), nen
//     response-started/response-ended van bao dung nhu cu, khong can sua
//     turn-controller.js. Chon dung event nay (khong phai
//     response.output_item.done, tuy 2 event mang cung du lieu) vi no gon
//     hon - moi thu (call_id/name/arguments day du) trong 1 cho, khong
//     long trong `item`. `arguments` GIU NGUYEN string JSON tho (khong
//     JSON.parse o day) - de con debug duoc khi model sinh JSON hong,
//     ben goi (dispatcher, chua lam) tu parse va tu xu ly loi.
//   - error
//   - session.updated (Giai doan 6a, 24/08/2026 - xem docs/roadmap.md muc
//     "Giai doan 6a") - server xac nhan MOT session.update da duoc AP DUNG
//     XONG (khong phai luc TA gui, la luc SERVER xu ly xong). Truoc day roi
//     vao "ignored" (co chu dich, chua co nhu cau dung toi luc Giai doan
//     1-5). Ly do can chuan hoa rieng: xac nhan THAT bang
//     scripts/probe-danh-bo-vad.mjs (chay that, khong doan) - co "cua so ho
//     hong" ~200-250ms giua luc gui session.update doi turn_detection sang
//     "digits" va luc session.updated ve xac nhan da ap dung xong; ban cu
//     (voice_bot/) tung gap dung lop bug nay (fix_migrate_gpt_realtime_21_
//     20260730.md, dot 15, 04/08/2026 - model tra loi SAI dung trong cua so
//     do, bi hieu nham la khach phu dinh, khoa chet vinh vien 1 ma danh bo
//     DUNG that) - CHUA TUNG duoc sua tan goc o ban cu. danh-bo-flow.js
//     (Giai doan 6a, dang viet) dung tin hieu nay lam cong "arming": sau
//     khi goi setVadMode("digits"), CHO tin hieu nay ve moi bat dau tin cac
//     transcript-ready la khach dang doc so - watchdog chung (90s, da co)
//     la luoi an toan cuoi neu vi ly do gi session.updated khong bao gio
//     ve (khong can them 1 timer rieng cho truong hop hiem nay).
// Event nao chua gap/chua can dung se roi vao nhanh "ignored" - khong lam
// crash, chi bao hieu "chua xu ly", de call-flow tu quyet dinh co bo qua
// that hay khong. Cac event khac lien quan tool-call quan sat duoc o Giai
// doan 5a (response.output_item.added/done, response.function_call_
// arguments.delta, response.output_audio.*, response.output_audio_
// transcript.delta [chi .delta - .done da chuan hoa thanh ai-said o tren],
// response.content_part.*, conversation.item.added/done, rate_limits.
// updated) CO CHU DICH roi vao "ignored" - chua co nhu cau dung toi,
// khong phai bo sot.

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

    case "response.output_audio_transcript.done":
      return {
        kind: "ai-said",
        responseId: rawEvent.response_id ?? null,
        itemId: rawEvent.item_id ?? null,
        text: rawEvent.transcript ?? "",
      };

    case "response.function_call_arguments.done":
      return {
        kind: "tool-call-requested",
        responseId: rawEvent.response_id ?? null,
        itemId: rawEvent.item_id ?? null,
        callId: rawEvent.call_id ?? null,
        name: rawEvent.name ?? null,
        // Chuoi JSON tho, CHUA parse - xem chu thich dau file.
        arguments: rawEvent.arguments ?? "",
      };

    case "error":
      return { kind: "error", raw: rawEvent.error ?? rawEvent };

    // [bo sung 24/08/2026, Giai doan 6a] Xem chu thich dau file - truoc day
    // roi vao "ignored" cung nhom voi session.created.
    case "session.updated":
      return { kind: "session-updated" };

    default:
      return { kind: "ignored", rawType: rawEvent.type };
  }
}
