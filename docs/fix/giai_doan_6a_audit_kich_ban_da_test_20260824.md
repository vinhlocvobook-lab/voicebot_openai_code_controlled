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
hạn, đọc số có khoảng nghỉ/ngập ngừng, đọc số liền mạch không nghỉ, đọc
dư/thiếu số, dùng 3 tool khác `get_bill`
(`compare_usage`/`get_outages`/`create_ticket`) bị chặn bởi
`DANH_BO_MISSING`. ~~có tạp âm nền~~ - **đã lấp**, xem "Cập nhật 24/08/2026
#5" bên dưới (PASS với noise1, cả nhánh tra cứu thành công lẫn nhánh lỗi hệ
thống).

## Mức 2 - Có audio thật, có API thật, nhưng CHỈ đo hành vi VAD (probe-danh-bo-vad.mjs) - CHƯA chạy qua danh-bo-flow.js

`scripts/probe-danh-bo-vad.mjs` chạy thật với 3 file audio, mục đích là
kiểm chứng cấu hình VAD "digits" (`buildTurnDetectionConfig`) TRƯỚC khi
`danh-bo-flow.js` được viết dựa vào nó - KHÔNG phải chạy qua chính state
machine. Dữ liệu thật (grep trực tiếp từ log `.jsonl`, không suy đoán):

| File audio | Khách đọc thế nào | Số mảnh VAD tách | Transcript từng mảnh | `response.created` tự sinh |
|---|---|---|---|---|
| `2_22082351775.wav` | bình thường, có ngừng giữa các cụm số | 2 | `"2208"` + `"2351 775."` | 0 |
| `2_22082351775_lienmach.wav` [^ten-file-nham] | liền mạch, không ngừng | 1 | `"2202 3251 775."` | 0 |
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
- ~~Tạp âm nền TRONG LÚC đọc số~~ - **đã test ở Mức 1 với noise1** (PASS,
  xem "Cập nhật 24/08/2026 #5"). `samples/4_tap_am.wav` và noise2/noise4/
  noise5 (vừa/nặng hơn) vẫn chưa dùng qua checkpoint thật - noise5 riêng đã
  biết trước (Mức 2) là VAD không phát hiện được giọng nói, khả năng cao
  checkpoint sẽ timeout ở bước chờ "asking"/"confirming", chưa xác nhận
  thật.
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

## Đính chính 24/08/2026 #3 - tên file ghi âm `..._lienmach*.wav` đặt NHẦM số, kéo theo 1 kết luận sai ở mục "Tạp âm" bên trên

Chủ dự án báo lại: **`2_22082351775_lienmach.wav` và cả 5 file
`2_22082351775_lienmach_noise1-5.wav` - dù tên file ghi `22082351775` -
THẬT SỰ đọc số `22023251775`** (đặt tên nhầm lúc thu âm). Đây CHÍNH LÀ mã
danh bộ đã xác nhận có dữ liệu billing thật (`MA_DANH_BO` trong
`checkpoint-giai-doan-6a.mjs`), khác với suy đoán trước đó (comment cũ
trong `probe-danh-bo-vad.mjs` cho rằng nhóm file này đọc 1 mã KHÁC,
`22082351775`, chưa xác nhận có dữ liệu billing).

**Ảnh hưởng trực tiếp tới bảng kết quả "Tạp âm" ở mục Cập nhật #2 phía
trên**: 3 lần chạy `probe-danh-bo-vad.mjs` cho noise1/noise3/noise5 khi đó
đã truyền SAI `expectedDanhBo=22082351775` (theo đúng tên file, lúc đó
chưa biết tên file nhầm) để đối chiếu candidate. Kết quả:

| File | Candidate gom được (không đổi, vẫn ĐÚNG dữ liệu STT thật) | Kết luận CŨ (SAI, so với 22082351775) | Kết luận ĐÚNG (so với 22023251775 - số THẬT SỰ được đọc) |
|---|---|---|---|
| noise1 (nhẹ) | `22023251775` | SAI (nghe nhầm "082"→"023") | **KHỚP ĐÚNG** - STT nghe ĐÚNG, không hề nhầm |
| noise3 (vừa) | `22023251775` (từ 12 số gom được, lấy 11 số đầu) | SAI (cùng kiểu nhầm, dư 1 số) | **KHỚP ĐÚNG** ở 11 số đầu - STT nghe ĐÚNG phần lõi 11 số, chỉ dư 1 số cuối (`danh-bo-collect.js` đã tự cắt đúng) |
| noise5 (nặng) | `null` (0 số, VAD không phát hiện giọng nói) | không đổi | không đổi - kết luận này KHÔNG phụ thuộc expectedDanhBo, vẫn đúng |

**Rút lại hoàn toàn kết luận "STT nghe nhầm một cách tự tin (082→023)"** ở
mục Cập nhật #2 - đây là suy diễn từ 1 giá trị đối chiếu (`expectedDanhBo`)
bị sai do tên file nhầm, KHÔNG phải hành vi thật của STT. Số liệu THẬT
(chưa từng thay đổi, chỉ có giá trị đối chiếu là sai) cho thấy điều
NGƯỢC LẠI: nhiễu nhẹ/vừa KHÔNG làm STT nghe sai chữ số nào trong lõi 11 số
(`gpt-4o-transcribe` vẫn nghe đúng qua tạp âm ở 2 mức thử nghiệm này) -
noise3 chỉ dư thêm 1 chữ số ở cuối (được xử lý an toàn bởi thiết kế cắt-11-
số-đầu có sẵn của `danh-bo-collect.js`, không phải lỗi). Rủi ro thật duy
nhất còn lại từ dữ liệu này là ở noise5 (nhiễu nặng): VAD không phát hiện
được giọng nói nào, không liên quan tới việc nghe nhầm chữ số.

**Hệ quả tích cực chưa khai thác**: vì noise1.wav/noise3.wav (dạng
`_lienmach_noise*`) đọc ĐÚNG mã có dữ liệu billing thật (`22023251775`),
2 file này giờ CÓ THỂ chạy thẳng qua `checkpoint-giai-doan-6a.mjs` (đã hỗ
trợ sẵn tham số dòng lệnh, không cần sửa code) để có 1 bài test tạp âm ở
**Mức 1** (chạy trọn qua `danh-bo-flow.js` + tra cứu billing thật) thay vì
chỉ dừng ở Mức 2 (đối chiếu candidate qua probe) như trước - đúng mục còn
thiếu đã liệt kê ở "Kịch bản CHƯA được test" phía trên ("Tạp âm nền TRONG
LÚC đọc số"). Lệnh chạy (không cần sửa gì, `MA_DANH_BO` trong checkpoint
đã sẵn là `22023251775`, khớp đúng):

```
node scripts/checkpoint-giai-doan-6a.mjs samples/2_22082351775_lienmach_noise1.wav
node scripts/checkpoint-giai-doan-6a.mjs samples/2_22082351775_lienmach_noise3.wav
```

Đã sửa lại comment/ví dụ liên quan trong `scripts/probe-danh-bo-vad.mjs`
("sua 24/08/2026 #8") để không còn truyền nhầm `22082351775` cho nhóm file
này nữa.

## Cập nhật 24/08/2026 #4 - đã chạy `checkpoint-giai-doan-6a.mjs` thật với noise1/noise3

Kết quả (chủ dự án tự chạy trên máy, dán lại log thật):

**noise1 (nhẹ)**: `danhBoFlow` kết thúc ở `done`, `callState.danhBo` đúng
`22023251775` - **phần thu thập + xác nhận số qua tạp âm nhẹ, chạy trọn
qua chính `danh-bo-flow.js` bằng audio thật, THÀNH CÔNG** (đúng đây là mục
tiêu chính của bài test tạp âm, khác với "tra cứu lại có thành công hay
không" là bước SAU đó). Nhưng tiêu chí (d) báo `false` - vì lần gọi lại
`get_bill` (sau xác nhận) THẬT SỰ đã được gửi đi đúng (log thật: request
GET dùng `danhba=22023251775` - đúng `callState.danhBo`, KHÔNG dùng
`rawArgs` gốc rác `"undefined"` mà model đã tự bịa lúc bị ép gọi tool -
bằng chứng thật thêm 1 lần nữa cho thiết kế an toàn của
`resolveDanhBoRef`), nhưng KHÔNG kịp có phản hồi (thành công hay lỗi) trước
khi `checkpoint-giai-doan-6a.mjs` thoát tiến trình. Nguyên nhân: script
checkpoint có `await sleep(6000)` cố định sau khi `danhBoFlow` xong, nhưng
`tongdai-api.js#callApi()` tự đặt `AbortController` chờ tới
`TONGDAI_API_TIMEOUT_MS` (mặc định 15000ms) trước khi tự biến thành
`TIMEOUT` - 6s là KHÔNG ĐỦ AN TOÀN cho trường hợp mạng/tunnel chậm. Đây là
**giới hạn của SCRIPT CHECKPOINT (hạ tầng test), không phải bug ở
`dispatch-tool-call.js`/`danh-bo-flow.js`** - đã sửa (`sua 24/08/2026 #9`,
tăng lên 18000ms = 15000ms timeoutMs thật + 3000ms dư).

**noise3 (vừa)**: `danhBoFlow` kết thúc ở `done`, `callState.danhBo` đúng
`22023251775` - CŨNG thành công ở bước thu thập/xác nhận. Lần gọi lại
`get_bill` LẦN NÀY kịp có phản hồi: `CONNECTION_ERROR` thật (không kết nối
được tới máy chủ tongdai - lỗi hạ tầng/tunnel thời điểm chạy, không liên
quan tạp âm/STT). **Đây là bằng chứng THẬT ĐẦU TIÊN xác nhận nhánh "lỗi hệ
thống" của fix #7 (`handleDanhBoFlowDone`, xem `dispatch-tool-call.js` "them
24/08/2026 #7") hoạt động ĐÚNG THIẾT KẾ qua Realtime API thật + mạng thật**:
code nói ĐÚNG NGUYÊN VĂN câu xin lỗi + chuyển máy
(`LOOKUP_SYSTEM_ERROR_TEXT`), KHÔNG mời đọc lại (đúng quyết định thiết kế
đã chốt - lỗi hệ thống doc lại vô ích), KHÔNG gọi thêm `get_bill`/
`danhBoFlow.start()` nào nữa (đúng 2 lần gọi tool, dừng đúng lúc).

**Tóm lại sau lần chạy này**: mục tiêu ban đầu của bài test tạp âm (thu
thập/xác nhận số qua tạp âm chạy trọn qua state machine thật) đã **PASS ở
cả noise1 và noise3**. Phần "tra cứu lại thành công với dữ liệu thật" chưa
có bằng chứng THÀNH CÔNG (chỉ có bằng chứng nhánh lỗi hệ thống hoạt động
đúng) do 2 lần chạy đều gặp trục trặc hạ tầng mạng/tunnel thời điểm đó,
không phải do code. Đã tăng thời gian chờ trong script (18000ms) - cần chạy
lại để xác nhận.

## Cập nhật 24/08/2026 #5 - chạy lại noise1 với wait 18000ms - PASS, có bằng chứng THẬT cho CẢ 2 nhánh của fix #7

Chủ dự án chạy lại `node scripts/checkpoint-giai-doan-6a.mjs
samples/2_22082351775_lienmach_noise1.wav` 2 lần liên tiếp, chủ động test
cả 2 tình huống hạ tầng:

**Lần 1 - API server (tongdai) đang KHÔNG kết nối được**: `get_bill` lần
gọi lại trả về `CONNECTION_ERROR` thật (lần này wait đủ 18s nên có phản hồi
rõ ràng, không còn bị cắt ngang như "Cập nhật #4"). Nhánh lỗi hệ thống của
`handleDanhBoFlowDone` (fix #7) chạy đúng: nói đúng nguyên văn
`LOOKUP_SYSTEM_ERROR_TEXT`, dừng lại (không mời đọc lại, không gọi thêm
tool) - khớp `logs/checkpoint6a-1787569983338.txt`.

**Lần 2 - API server OK**: `get_bill` lần gọi lại **THÀNH CÔNG THẬT** -
kỳ 8/2026, sản lượng 24 m³, tổng tiền 428.413đ, đã thanh toán 22/08/2026
(cùng dữ liệu billing thật đã thấy ở lần PASS đầu tiên của Giai đoạn 6a).
`turnController.say()` đọc verbatim đúng `output.message`, không đi qua
nhánh lỗi nào. **KẾT QUẢ: PASS** cả 4 tiêu chí (a)-(d) -
`logs/checkpoint6a-1787570060983.txt`.

Vậy audio tạp âm nhẹ (noise1) giờ đã có bằng chứng THẬT cho **toàn bộ 3
nhánh liên quan**: (1) thu thập/xác nhận số qua tạp âm chạy trọn qua
`danh-bo-flow.js` thật, (2) tra cứu lại THÀNH CÔNG với dữ liệu billing
thật (đúng use-case chính), (3) tra cứu lại THẤT BẠI vì lỗi hệ thống, code
xử lý đúng thiết kế fix #7 (xin lỗi + chuyển máy, không mời đọc lại vô
ích). Cả 2 lần đều dùng rawArgs GỐC là chuỗi rác model tự bịa (`"undefined"`
lần trước, `""` lần lỗi hệ thống, `"?"` lần thành công) - `resolveDanhBoRef`
đều bỏ qua đúng thiết kế, chỉ dùng `callState.danhBo` thật.

**Coi như đã đóng mục "Tạp âm nền TRONG LÚC đọc số" ở Mức 1** (trước đây
liệt kê trong "Kịch bản CHƯA được test" của Mức 1, phía trên) - đã chạy
trọn qua Realtime API thật + audio tạp âm thật + tra cứu billing thật,
PASS. `MAX_DANH_BO_LOOKUP_RETRIES` (nhánh lỗi dữ liệu, mời đọc lại tối đa 2
lần) của fix #7 vẫn CHƯA có bằng chứng thật qua audio (chỉ có unit test) -
cần 1 kịch bản audio riêng (model đọc/nghe SAI 1 số dẫn tới
`CUSTOMER_NOT_FOUND` thật) để test.

## Cập nhật 24/08/2026 #6 - "xác nhận SAI qua audio thật" (việc ưu tiên cuối cùng) - PASS, kèm 1 bug thật phát hiện trong CHÍNH SCRIPT CHECKPOINT

Viết mới `scripts/checkpoint-giai-doan-6a-xac-nhan-sai.mjs` (không sửa
`checkpoint-giai-doan-6a.mjs` cũ - giữ nguyên quan hệ tách file như
5a/5b) + thêm audio `samples/6a_xac_nhan_sai.wav` ("Dạ, sai rồi ạ." - khớp
`PHU_DINH_RE` thật của `danh-bo-confirm.js`, không đoán wording) qua
`scripts/gen-sample-6a.mjs` (đã thêm cơ chế bỏ qua file đã tồn tại, tránh
vô tình ghi đè 3 file audio cũ đang PASS bằng 1 bản TTS mới).

Kịch bản: đọc số (đúng) → bot đọc lại xin xác nhận → khách nói "sai rồi ạ"
(audio thật) → chờ `danh-bo-flow.js` thật tự quay lại "asking" → đọc lại
đúng số (lần 2) → xác nhận "đúng" → hoàn tất → tra cứu lại billing thật.

**Bug thật phát hiện (trong chính script checkpoint, KHÔNG PHẢI code app)**:
lần chạy đầu tiên, `createDanhBoFlow({ say: turnController.say, ... })`
truyền THẲNG giá trị hàm `turnController.say` - bị CHỐT CỨNG tại thời điểm
đó, TRƯỚC khi đoạn code "spy" (đếm/ghi log các lượt `say()`) gán lại
property `turnController.say`. Hậu quả: toàn bộ lời nói của
`danh-bo-flow.js` (askPrompt/confirmPrompt/giveUp/hỏi lại không rõ ràng)
**vẫn chạy ĐÚNG THẬT** (gọi thẳng hàm gốc, vẫn gửi `response.create` thật
bình thường - KHÔNG ảnh hưởng hành vi bot thật) nhưng **bị spy bỏ sót hoàn
toàn** - `askCount`/`confirmCount` luôn ra 0. Bug này tồn tại TỪ ĐẦU trong
`checkpoint-giai-doan-6a.mjs` gốc (cùng 1 cách truyền tham số) - nghĩa là
dòng "So lan turnController.say() (spy)" in ra ở TẤT CẢ các lần chạy
checkpoint 6a trước đây (kể cả 2 lần PASS đầu tiên, ngập ngừng, tạp âm) đã
LUÔN THIẾU các lượt nói của `danh-bo-flow.js`, chỉ đếm đúng phần của
`dispatch-tool-call.js` (module này gọi qua `turnController.say(...)` -
tra property MỖI LẦN gọi nên không dính bug). Đã sửa CẢ 2 file (đổi thành
1 hàm gián tiếp tra lại property mỗi lần gọi, không phụ thuộc thứ tự khởi
tạo). **Không ảnh hưởng tới kết quả PASS/FAIL đã ghi nhận trước đó** (các
tiêu chí (a)-(d) của `checkpoint-giai-doan-6a.mjs` không phụ thuộc đếm lời
nói của `danh-bo-flow.js`) - chỉ ảnh hưởng tới độ đầy đủ của dòng debug in
ra, và ảnh hưởng trực tiếp tới 2 tiêu chí MỚI (e)/(f) của script "xác nhận
sai" (không thể nào đúng nếu không sửa).

**2 lần chạy thật sau khi sửa spy**:
- Lần 1: STT lại nghe thiếu số ở LƯỢT ĐỌC LẠI (sau khi báo sai) - dừng ở
  "asking", không phải bug (cùng loại biến động STT đã ghi nhận trước đó,
  không phải lỗi code) - phải chạy lại.
- Lần 2: **PASS cả 6 tiêu chí (a)-(f)**. Trình tự `say()` thật quan sát
  được đúng như thiết kế: hỏi đọc số (lần 1) → đọc lại xin xác nhận (lần
  1, bị từ chối) → hỏi đọc số (lần 2) → đọc lại xin xác nhận (lần 2, được
  xác nhận) → preamble tra cứu lại → đọc kết quả billing thật (kỳ 8/2026,
  428.413đ). `callState.danhBo` đúng `22023251775`, đúng 2 lần gọi
  `get_bill` (1 `DANH_BO_MISSING` + 1 thành công), không có lần gọi thừa
  nào (không lặp vô hạn, không bỏ qua bước nào) - `logs/checkpoint6a-sai-
  1787571221856.txt`.

## Tổng kết - cả 4 việc hardening ưu tiên đã xong

Tính đến đây, cả 4 việc đã thống nhất làm trước khi qua Giai đoạn 6b đều
đã có bằng chứng PASS thật qua Realtime API + audio thật: (1) ngập ngừng,
(2) tạp âm, (3) xác nhận SAI rồi đọc lại, (4) vá khoảng trống "xác nhận
đúng nhưng tra cứu lại vẫn thất bại". Test: 237/237 local, 252/252 device.
Đã đồng bộ lại `docs/roadmap.md` (mục Giai đoạn 6a) với tóm tắt + số liệu
mới nhất.

**Còn lại CHƯA test** (mức độ ưu tiên thấp hơn, chưa có kế hoạch cụ thể -
xem "Kịch bản CHƯA được test bằng bất kỳ hình thức nào" phía trên, đã cập
nhật gạch bỏ mục tạp âm): 3 tool khác `get_bill` bị chặn bởi
`DANH_BO_MISSING`, 2 lần `DANH_BO_MISSING` liên tiếp trong cùng 1 cuộc
gọi, đọc thừa/thiếu số rồi im lặng kéo dài, watchdog bằng 1 cuộc gọi thật,
`MAX_DANH_BO_LOOKUP_RETRIES` (fix #7, nhánh lỗi dữ liệu) qua audio thật.

[^ten-file-nham]: Tên file ghi `22082351775` nhưng THẬT SỰ đọc
    `22023251775` - xem "Đính chính 24/08/2026 #3" bên dưới. Transcript ở
    bảng này không đổi (dữ liệu STT thật), chỉ là tên/nhãn mã danh bộ gán
    cho file bị nhầm lúc thu âm.
