# Giai đoạn 6b - Đính chính cơ chế khớp cặp: previous_item_id → thứ tự item (24/08/2026)

## Tóm tắt (đọc trước)

Bước 1 của thiết kế Giai đoạn 6b (`docs/roadmap.md`, đề xuất 21/08/2026) viết:
"dùng `previous_item_id`/thứ tự item để khớp ĐÚNG CẶP" - câu này được viết
**trước khi chạy thật để kiểm chứng**, tức là ĐOÁN, đi ngược đúng triết lý
của cả dự án ("code, hiểu, kiểm soát và test từng bước một" - không đoán
hành vi API). Khi rà soát lại thiết kế trước khi bắt đầu code Giai đoạn 6b
(24/08/2026), phát hiện `src/session/turn-signal.js` thậm chí chưa hề chuẩn
hoá field `previous_item_id` cho bất kỳ event nào ngoài
`input_audio_buffer.committed` (dùng cho một quan hệ HOÀN TOÀN khác - xâu
chuỗi các mảnh VAD của CÙNG một người nói, không phải khớp cặp AI-khách).

Chạy `scripts/probe-confirm-danh-bo.mjs` (probe thật, nối Realtime API
thật, không giả lập) để kiểm chứng trực tiếp. Kết quả: **`previous_item_id`
không dùng được cho việc khớp cặp "AI vừa đọc lại số" với "khách vừa trả
lời"** như thiết kế gốc kỳ vọng. Cơ chế đúng, đã kiểm chứng bằng mốc thời
gian thật: **thứ tự đến của event `conversation.item.added`
(`role:"user"`)** - event này của khách luôn đến SAU
`conversation.item.done` (`role:"assistant"`) của lượt AI đọc lại, không hề
xen kẽ. Đã sửa `src/session/turn-signal.js` để chuẩn hoá event này thành
tín hiệu mới `"user-item-added"`.

## Vì sao cần kiểm chứng lại

`docs/roadmap.md` mục Giai đoạn 6b, bước 1 (bản 21/08/2026) viết:

> Khớp cặp "câu model vừa đọc lại xin xác nhận" ... với "câu khách trả lời
> ngay sau đó" ..., dùng `previous_item_id`/thứ tự item để khớp ĐÚNG CẶP,
> không chỉ lấy "N event gần nhất" (tránh khớp nhầm do độ trễ bất đồng bộ
> đã ghi nhận ở Giai đoạn 1 - transcript có thể đến sau `response.created`).

Câu này gộp chung 2 cơ chế khác nhau ("previous_item_id" và "thứ tự item")
như thể là một, và không nói rõ field đó nằm trên EVENT NÀO. Khi bắt đầu
viết `turn-signal.js` để chuẩn hoá cho Giai đoạn 6b mới lộ ra: event quan
trọng nhất trong bước 1 -
`conversation.item.input_audio_transcription.completed` (dùng để lấy
transcript câu khách vừa trả lời, xem `turn-signal.js` case
`"transcript-ready"`) - **hoàn toàn không có field `previous_item_id`**,
chỉ có `item_id` và `transcript`. Không thể "đoán" tiếp là đúng hay sai -
phải chạy thật.

## Cách kiểm chứng: `scripts/probe-confirm-danh-bo.mjs`

Probe mới (KHÔNG thuộc Giai đoạn 6a, viết riêng cho việc kiểm chứng này),
mô phỏng đúng kịch bản Giai đoạn 6b sẽ gặp:

1. Nối WebSocket Realtime API thật.
2. Ép model tự nói câu đọc lại + xin xác nhận bằng `response.create` với
   `instructions` trực tiếp (đi tắt qua system prompt Giai đoạn 6b - lúc
   này còn chưa viết), nguyên văn:

   ```
   Đọc lại nguyên văn, chậm rãi, tách từng chữ số: 'Dạ, mã danh bộ của Quý
   Khách là Hai - Hai - Không - Hai - Ba - Hai - Năm - Một - Bảy - Bảy -
   Năm. Quý Khách xác nhận giúp em có đúng không ạ?' - không nói gì thêm,
   không thêm bớt.
   ```

3. Phát `samples/6a_xac_nhan_dung.wav` (giả lập khách trả lời "đúng rồi")
   ngay sau khi AI nói xong.
4. Log TOÀN BỘ event thô ra `.jsonl`, in riêng: (a) `previous_item_id`
   trên `conversation.item.input_audio_transcription.completed` có tồn
   tại không, có khớp với `item_id` của item AI không; (b) toàn bộ nội
   dung thô (không lọc) của mọi `conversation.item.added`/`.done` để soi
   trực tiếp bằng mắt.

## Kết quả thật

- `conversation.item.input_audio_transcription.completed`: **không có
  field `previous_item_id`** - chỉ có `item_id`, `transcript`. Xác nhận
  đúng nghi ngờ ở trên.
- `item` bên trong `conversation.item.added`/`.done`: cũng **không có
  `previous_item_id`** ở cấp `item` - chỉ có `item.id`, `item.role`,
  `item.status`, `item.content`.
- Thứ tự đến (mốc thời gian tương đối tính từ lúc probe bắt đầu, đọc trực
  tiếp từ log `.jsonl` của lần chạy thật):

  | +ms  | Event                                        | role/ghi chú |
  |------|-----------------------------------------------|--------------|
  | 2549 | `response.created`                             | AI bắt đầu đọc lại |
  | 3645 | `conversation.item.added`                      | `assistant` |
  | 5467 | `response.output_audio_transcript.done` ("ai-said") | text đầy đủ câu đọc lại |
  | 5470 | `conversation.item.done`                       | `assistant` |
  | 5471 | `response.done`                                | status `completed` |
  | 8010 | `conversation.item.added`                      | `user`, `status` đã là `"completed"` ngay lúc thêm |
  | 8011 | `conversation.item.done`                       | `user` |
  | 8342 | `conversation.item.input_audio_transcription.completed` | transcript-ready, `item_id` khớp đúng `item.id` của dòng +8010/+8011 |

  Không có xen kẽ: item của khách (`role:"user"`) LUÔN xuất hiện SAU
  `conversation.item.done` của lượt AI đọc lại, khoảng cách ~2.5s (đúng
  bằng thời lượng phát audio "đúng rồi" trong kịch bản này). `item_id`
  của item khách sau đó dùng lại được ở `transcript-ready`
  (`item_id` trùng khớp) - đây là chỗ nối 2 tín hiệu lại với nhau.

## Cơ chế ĐÚNG (thay thế bước 1 cũ)

Không dùng `previous_item_id` (không tồn tại đúng chỗ cần). Dùng **thứ tự
đến của `conversation.item.added` với `item.role === "user"`**:

1. Khi `danh-bo-flow`/matcher (Giai đoạn 6b, chưa viết) thấy AI vừa đọc
   xong câu xác nhận (tín hiệu `"ai-said"` đã có sẵn), CHỜ tín hiệu
   `"user-item-added"` MỚI TIẾP THEO (không lấy "N event gần nhất" -
   đúng đúng tinh thần cảnh báo gốc ở bước 1, chỉ sai chỗ dùng field
   nào).
2. Giữ lại `itemId` của tín hiệu đó.
3. Khi tín hiệu `"transcript-ready"` (từ
   `conversation.item.input_audio_transcription.completed`) đến, đối
   chiếu `itemId` - nếu trùng, đây chính là transcript của lượt trả lời
   vừa khớp cặp ở bước 1-2.

## Thay đổi code

`src/session/turn-signal.js`: thêm case `"conversation.item.added"`,
CHỈ chuẩn hoá khi `rawEvent.item?.role === "user"` thành
`{ kind: "user-item-added", itemId }`; các `role` khác (vd `"assistant"`)
giữ nguyên `"ignored"` như trước (đã có tín hiệu `"ai-said"` phục vụ đủ).
Cập nhật comment đầu file (danh sách event cố ý ignored) cho khớp.

`test/turn-signal.test.mjs`:
- Test cũ `"[Giai doan 5a] replay fixture tool-call that..."` (replay
  `test/fixtures/tool-call-events.jsonl`) có sẵn 1 event
  `conversation.item.added` (`role:"user"`) thật (dòng đầu cuộc gọi mẫu,
  từ log Giai đoạn 5a) - trước đây rơi vào `ignored`, nay được tính vào
  `"user-item-added"`. Cập nhật tally: `ignored: 8 → 7`, thêm
  `"user-item-added": 1`.
- Thêm test riêng cho case mới, dùng lại đúng dữ liệu thật ở trên (không
  bịa fixture), cộng thêm 2 case biên: `role !== "user"` vẫn `ignored`;
  thiếu `item.id` không crash (trả `itemId: null`).

Kết quả: 238/238 (local, `node --test`), 253/253 (máy chủ dự án).

## Việc CHƯA làm (nằm ngoài phạm vi đính chính này)

Đính chính này CHỈ sửa nền tảng chuẩn hoá tín hiệu (`turn-signal.js`).
Các hàm matcher thật (khớp cặp end-to-end trong `danh-bo-flow`/tool
handler mới, trích số từ câu model đọc lại, so sánh với giá trị tool,
cache vào `callState`, lớp trọng tài gpt-5.1 ở bước 2.5) CHƯA được viết -
xem `docs/roadmap.md` mục Giai đoạn 6b để biết thứ tự làm tiếp theo.
