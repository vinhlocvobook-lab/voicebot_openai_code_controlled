# Giai đoạn 6a - Rà soát các kịch bản đã/chưa test (24/08/2026)

Viết theo yêu cầu chủ dự án sau khi Giai đoạn 6a được đóng trong
`docs/roadmap.md`: "các kịch bản nào bạn đã test rồi, kết quả ra sao, rà
soát xem có kịch bản nào chưa test - ví dụ khách nói ngập ngừng, đọc mã
danh bộ có khoảng nghỉ, không liên tục...".

Kết luận ngắn gọn trước: **Giai đoạn 6a PASS ở đúng 1 kịch bản đầu-cuối
qua audio thật** (đọc số liên tục, rõ ràng, xác nhận đúng ngay lần đầu).
Các kịch bản còn lại - bao gồm chính xác ví dụ chủ dự án nêu (ngập ngừng,
có khoảng nghỉ) - đã có SẴN dữ liệu âm thanh thật và đã dùng để đo hành vi
VAD, nhưng CHƯA từng chạy qua chính state machine `danh-bo-flow.js` bằng
audio thật. Phần lớn còn lại chỉ được unit test bằng dữ liệu giả lập (tự
viết text, không qua STT thật).

## Mức 1 - Chạy trọn đầu-cuối qua Realtime API thật + audio TTS thật

`scripts/checkpoint-giai-doan-6a.mjs`, 2 lần chạy PASS liên tiếp
(`logs/checkpoint6a-1787559917938.txt`, `logs/checkpoint6a-1787560395048.txt`).

**Đúng 1 kịch bản duy nhất**: khách hỏi hoá đơn mà KHÔNG đọc danh bộ (kích
`DANH_BO_MISSING`) → bot hỏi lại → khách đọc 11 chữ số LIÊN TỤC, RÕ RÀNG,
tách từng chữ số (`samples/6a_doc_so_22023251775.wav`, do TTS đọc, không
có khoảng nghỉ bất thường/ngập ngừng) → bot đọc lại xin xác nhận → khách
xác nhận "Dạ đúng rồi ạ" NGAY LẦN ĐẦU → code tự tra cứu lại → đọc kết quả
thật.

Kết quả: đúng 2 lần gọi `get_bill`, danh bộ thu thập đúng
`22023251775`, tra cứu ra đúng dữ liệu thật (kỳ 8/2026, 428.413đ). 2 bug
thật phát hiện qua chính kịch bản này (VAD-switch race, model tự gọi tool
khi nghe preamble - xem lịch sử commit `giai-doan-6a-danh-bo-collect`) đã
sửa.

**Chưa test ở mức này**: xác nhận SAI rồi đọc lại, xin nhắc lại câu hỏi,
đọc lại số mới giữa lúc xác nhận, quá số lần thử (giveUp), watchdog hết
hạn, đọc số có khoảng nghỉ/ngập ngừng, đọc số liền mạch không nghỉ, có tạp
âm nền, đọc dư/thiếu số, dùng 3 tool khác `get_bill`
(`compare_usage`/`get_outages`/`create_ticket`) bị chặn bởi
`DANH_BO_MISSING`.

## Mức 2 - Có audio thật, có API thật, nhưng CHỈ đo hành vi VAD (probe-danh-bo-vad.mjs) - CHƯA chạy qua danh-bo-flow.js

`scripts/probe-danh-bo-vad.mjs` chạy thật với 3 file audio, mục đích là
kiểm chứng cấu hình VAD "digits" (`buildTurnDetectionConfig`) TRƯỚC khi
`danh-bo-flow.js` được viết dựa vào nó - KHÔNG phải chạy qua chính state
machine. Dữ liệu thật (grep trực tiếp từ log `.jsonl`, không suy đoán):

| File audio | Khách đọc thế nào | Số mảnh VAD tách | Transcript từng mảnh | `response.created` tự sinh |
|---|---|---|---|---|
| `2_22082351775.wav` | bình thường, có ngừng giữa các cụm số | 2 | `"2208"` + `"2351 775."` | 0 |
| `2_22082351775_lienmach.wav` | liền mạch, không ngừng | 1 | `"2202 3251 775."` | 0 |
| `6_ngap_ngung.wav` | **ngập ngừng** (đúng ví dụ chủ dự án nêu) | 2 | `"2202.3251"` + `"775."` | 0 |

(log: `logs/probe-danh-bo-vad-2_22082351775-1787540601007.jsonl`,
`logs/probe-danh-bo-vad-2_22082351775_lienmach-1787544064500.jsonl`,
`logs/probe-danh-bo-vad-6_ngap_ngung-1787543963312.jsonl`)

Kết quả này CHỈ xác nhận: (a) VAD "digits" mode không tự sinh response nào
(0/3 lần, đúng thiết kế), (b) VAD THẬT SỰ tách audio ngập ngừng/có khoảng
nghỉ thành nhiều mảnh (không phải giả định) - đúng lý do
`danh-bo-collect.js` phải CỘNG DỒN nhiều mảnh chứ không thay thế.

**CHƯA xác nhận**: nếu đưa CHÍNH 2 mảnh `"2202.3251"` + `"775."` (từ file
ngập ngừng thật) qua `danh-bo-flow.js#handleSignal()` thật (không phải qua
`noteDanhBoDigits()` bằng tay trong unit test), candidate cuối có ra đúng
`22023251775` không - vì `normalizeDanhBo()` strip ký tự không phải số
(dấu `.` trong `"2202.3251"` sẽ bị bỏ, không phải lỗi, nhưng chưa có bằng
chứng THẬT xác nhận đường đi đầy đủ transcript thật → `noteDanhBoDigits` →
`danhBoCandidate` cho ra đúng số với chính bộ dữ liệu ngập ngừng này).

## Mức 3 - Chỉ unit test bằng dữ liệu giả lập (tự viết text, KHÔNG qua STT thật)

Bao phủ rộng về mặt LOGIC THUẦN (66 test: `danh-bo-collect.test.mjs` 20,
`danh-bo-confirm.test.mjs` 12, `danh-bo-flow.test.mjs` 18,
`resolve-danh-bo-ref.test.mjs` 5, cộng phần liên quan trong
`dispatch-tool-call.test.mjs`), gồm các nhánh:

- Gom nhiều mảnh transcript giả lập thành đủ 11 số; tạp âm bị STT dịch
  lung tung (không phải số) không làm hỏng session.
- Khách báo SAI → reset, đọc lại; khách xin nhắc lại câu xác nhận; khách
  đọc lại 1 dãy số MỚI giữa lúc đang chờ xác nhận (đủ/chưa đủ 11 số); câu
  trả lời không rõ ràng → hỏi lại.
- Quá ngưỡng `maxAttempts` (mặc định 3) → `giveUp()` + câu xin lỗi;
  watchdog hết hạn → `giveUp()`; watchdog được reset khi có hoạt động;
  `start()` gọi lại giữa chừng bị bỏ qua, gọi lại sau done/failed hoạt
  động bình thường.
- `isAffirmative`/`isNegative`/`wantsRepeat`: nhiều case tiếng Việt (từ
  "được", "ừ"/"ờ" đứng một mình, các từ chứa "ờ" nhưng KHÔNG PHẢI xác nhận
  như "dời"/"giờ"/"chờ", câu hỏi không bao giờ tính là xác nhận, phủ định
  được ưu tiên kiểm tra trước).

**Giới hạn quan trọng của mức này**: toàn bộ text đầu vào là DO MÌNH TỰ
VIẾT để mô phỏng transcript, KHÔNG phải transcript thật do `gpt-4o-
transcribe` tạo ra từ audio thật. Chưa có bằng chứng thật là khi khách
THẬT SỰ nói "không đúng" / "sai rồi" / "đọc lại giúp em" qua điện thoại,
STT có phiên ra đúng dạng câu mà các test này giả định hay không.

## Kịch bản CHƯA được test bằng bất kỳ hình thức nào (kể cả unit test)

- 3 tool còn lại bị chặn bởi `DANH_BO_MISSING`
  (`compare_usage`/`get_outages`/`create_ticket`) - checkpoint thật CHỈ
  dùng `get_bill`. Logic dùng chung (`handleDanhBoFlowDone` không phân
  biệt tên tool) nhưng chưa có bằng chứng thật cho 3 tool kia.
- 2 lần `DANH_BO_MISSING` liên tiếp trong CÙNG 1 cuộc gọi (vd khách hỏi
  hoá đơn trước, hỏi báo sự cố sau, cả 2 đều cần danh bộ) - có tận dụng
  đúng `callState.danhBo` đã biết từ lần trước không, hay kích hoạt lại
  toàn bộ luồng thu thập.
- Tạp âm nền TRONG LÚC đọc số (có sẵn `samples/4_tap_am.wav` và 5 file
  `2_22082351775_lienmach_noise1-5.wav` nhưng chưa dùng cho riêng luồng
  danh bộ này).
- Khách đọc THỪA số (hơn 11 số) hoặc dừng giữa chừng rồi im lặng kéo dài.
- `checkWatchdog`/`giveUp` bằng 1 cuộc gọi thật để im lặng đủ lâu (hiện
  chỉ gọi `checkWatchdog(nowMs)` bằng tay trong unit test).

## Phát hiện phụ - khoảng trống thiết kế (quan sát được TÌNH CỜ, không phải test có chủ đích)

Ở 1 trong các lần chạy `checkpoint-giai-doan-6a.mjs` (`logs/checkpoint6a-
1787558819667.txt`, TRƯỚC lần PASS cuối), STT nghe nhầm audio sạch thành
`22202751775` (đúng phải là `22023251775`). Khách hàng (audio xác nhận
đóng cứng "đúng rồi") đã "xác nhận" con số SAI này, `danhBoFlow` chuyển
sang `done`, code tự tra cứu lại và nhận `CUSTOMER_NOT_FOUND` - bot đọc
đúng câu báo lỗi đó cho khách nghe, rồi **DỪNG HẲN, không có cơ chế nào
mời khách đọc lại**.

Đây không phải bug (code không crash, không đưa nhầm dữ liệu của khách
khác - `resolveDanhBoRef` vẫn đúng thiết kế an toàn) nhưng là 1 khoảng
trống trải nghiệm thật sự: MỘT KHI khách đã xác nhận (dù xác nhận nhầm số
do nghe sai từ đầu), `handleDanhBoFlowDone()` không phân biệt nhánh
`success:false` với `success:true` - chỉ đọc verbatim `output.message` rồi
xong, không quay lại đề nghị đọc lại số hay chuyển máy. Rủi ro thật: khách
hàng THẬT có thể gặp đúng tình huống này (không phải giả định) vì đây là
dữ liệu quan sát trực tiếp từ 1 lần chạy thật, không phải suy đoán.

Chưa có quyết định sửa - nêu ra để chủ dự án cân nhắc phạm vi: thuộc Giai
đoạn 6a (mở rộng `handleDanhBoFlowDone`) hay để lại cho Giai đoạn 6b (nơi
vốn đã có kế hoạch xử lý sâu hơn các trường hợp dữ liệu không nhất quán).

## Cập nhật 24/08/2026 #2 - kết quả sau khi lấp 2 kịch bản ưu tiên (ngập ngừng + tạp âm)

Theo quyết định "tiếp tục 6a trước khi qua 6b" (bàn với chủ dự án cùng
ngày), đã lấp thêm 2 trong 4 việc ưu tiên. Kết quả:

### Đọc ngập ngừng qua audio thật, chạy trọn qua `danh-bo-flow.js` thật

`node scripts/checkpoint-giai-doan-6a.mjs samples/6_ngap_ngung.wav`
(`logs/checkpoint6a-1787565645860.txt`) - PASS cả 4 tiêu chí, candidate
gom đúng `22023251775` từ transcript thật bị VAD tách mảnh
(`"2202.3251"` + `"775."`), tra cứu lại đúng dữ liệu thật.

**Nhưng lộ ra 1 bug thật MỚI, CÙNG LOẠI với bug `tool_choice` đã sửa ở
`handleDanhBoFlowDone` (xem lịch sử commit `giai-doan-6a-danh-bo-collect`,
"sua 24/08/2026 #4")**: `get_bill` bị gọi 3 lần thay vì 2 - lần giữa có
args ĐÃ ĐÚNG (`"22023251775"`) nhưng `callState.danhBo` CHƯA được set (vẫn
đang ở phase "confirming", khách CHƯA xác nhận xong) nên
`resolveDanhBoRef` đúng đắn trả về `DANH_BO_MISSING` (AN TOÀN - không có
dữ liệu sai lọt ra) - nhưng vẫn là model TỰ Ý gọi tool trong lúc nghe
`askPrompt()`/`confirmPrompt()`, vì CẢ 4 lượt `say()` trong
`danh-bo-flow.js` (khác với 4 lượt trong `handleDanhBoFlowDone` đã sửa
trước đó) chưa từng kèm `toolChoice`. **Đã sửa** (cùng cách: thêm
`toolChoice:"none"` vào cả 4 lượt `say()` của `danh-bo-flow.js`), test
232/232 local, 247/247 device, đã commit.

### Tạp âm lúc đọc số - qua `probe-danh-bo-vad.mjs` đối chiếu trực tiếp với `danh-bo-collect.js` thật

3 file (`2_22082351775_lienmach_noise1/3/5.wav`, mã danh bộ gốc
`22082351775` - KHÔNG dùng để tra cứu thật vì chưa xác nhận có dữ liệu
billing, chỉ đối chiếu candidate). Kết quả:

| File | Transcript thật | Candidate gom được | Đúng/sai |
|---|---|---|---|
| noise1 (nhẹ) | `"2202 3251 775"` | `22023251775` | **SAI** (nghe nhầm `082`→`023`) |
| noise3 (vừa) | `"2202 3251 7755"` | `22023251775` (12 số gom được, lấy 11 số đầu) | **SAI** (cùng kiểu nhầm `082`→`023`, thêm dư 1 số) |
| noise5 (nặng) | *(không có mảnh nào)* | `null` (0 số) | VAD không phát hiện được giọng nói nào |

Đây KHÔNG phải bug code - `danh-bo-collect.js` gom đúng những gì STT trả
về, `resolveDanhBoRef` vẫn đúng thiết kế an toàn (chỉ tin
`callState.danhBo` sau khi khách xác nhận bằng lời). Nhưng đây là bằng
chứng THẬT (không phải giả định) cho đúng rủi ro Giai đoạn 6b đã lường
trước trong roadmap (mục "RỦI RO CẦN LƯU Ý ở Phương án B"): khi STT nghe
sai một cách "tự tin" (ra đúng 11 số, trông hợp lệ, không phải lỗi ngẫu
nhiên - CẢ 2 lần noise1/noise3 đều nhầm CÙNG MỘT KIỂU `082`→`023`), an
toàn duy nhất còn lại là khách hàng tự nghe ra bot đọc lại SAI rồi nói
"không đúng" - code hiện tại (6a) không có cơ chế độc lập nào để tự phát
hiện việc này. Nhiễu nặng (noise5) thì an toàn hơn theo nghĩa khác: VAD
không detect được gì cả nên không có candidate sai nào để đọc lại, nhưng
khách sẽ phải đọc lại từ đầu (không tự động, cần watchdog hoặc khách chủ
động thử lại).

Còn lại 2 việc ưu tiên (xác nhận SAI qua audio thật, sửa lỗ hổng
confirm-sai-rồi-fail) - chưa làm, sẽ cập nhật tiếp file này khi có kết
quả.
