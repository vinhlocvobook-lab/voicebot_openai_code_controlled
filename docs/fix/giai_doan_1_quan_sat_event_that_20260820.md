# Giai đoạn 1 - Quan sát luồng event thật (20/08/2026)

## Tóm tắt hiện trạng (cập nhật 21/08/2026 - đọc trước khi đọc chi tiết bên dưới)

File này được viết TUẦN TỰ theo thời gian, có vài kết luận giữa chừng sau đó bị sửa lại (đúng thói quen `docs/fix/` - giữ lại lịch sử suy luận). Muốn biết kết luận ĐANG ÁP DỤNG, đọc tóm tắt này thay vì đọc tuần tự:

1. `semantic_vad`/`server_vad` (dù model nào, dù chỉnh ngưỡng nào) đều KHÔNG đợi được qua khoảng ngừng tự nhiên giữa các cụm số khi đọc danh bộ - xác nhận bằng thực nghiệm nhiều lần.
2. `create_response:false` (locked mode) là bắt buộc cho giai đoạn thu số, nhưng KHÔNG tự nó ngăn VAD tách 1 lượt đọc thành nhiều `conversation.item` - code vẫn phải tự gom nhiều mảnh.
3. `turn_detection: null` (tự app commit) giải quyết triệt để việc bị tách mảnh - NHƯNG chỉ kiểm chứng được ở kịch bản KHÔNG dùng SIP (app tự append audio). Dự án sản xuất CHỈ dùng SIP + 1 WebSocket control-plane, Node không có audio thô để tự làm việc này - nên hướng này KHÔNG dùng được cho bản sản xuất (xem `docs/roadmap.md` mục "Ràng buộc kiến trúc").
4. Vì (3) không dùng được, Giai đoạn 6 quay lại hướng gom nhiều mảnh transcript qua `previous_item_id` (Phương án A) hoặc để model tự thu thập + code đối chiếu (Phương án B) - xem `docs/roadmap.md` Giai đoạn 6 để biết chi tiết 2 phương án.
5. Transcript (`gpt-4o-transcribe`) có thể lệch 1 chữ số ngay cả khi không bị tách mảnh - luôn cần bước đọc lại xác nhận với khách, không tin 100% transcript đầu vào.

## Mục đích

Trước khi viết `turn-signal.js`/`turn-controller.js` (Giai đoạn 2-3), cần tận
mắt thấy thứ tự event thực tế từ OpenAI Realtime API - không đọc lại code cũ
suy đoán. Dùng `scripts/probe-realtime.mjs`: mở WebSocket thuần (không qua
Asterisk/SIP, không qua business logic), cấu hình giống hệt "normal mode"
của production (`semantic_vad`, `eagerness:"low"`, `create_response:true`,
`interrupt_response:true`, transcription `gpt-4o-mini-transcribe`), phát 5
file audio test riêng biệt, log toàn bộ event ra `logs/probe-*.jsonl` + bản
console.log được lưu lại ở `logs/probe-*.txt`.

## Kết quả từng file

**1. `1_hoa_don_tien_nuoc_24k.wav` (5.72s, câu hỏi thường)**
Chuỗi event chuẩn: `speech_started(+3511ms) -> speech_stopped(+7681ms) ->
committed -> conversation.item.added/done -> response.created ->
response.output_audio.delta... -> response.done`. Transcript khớp đúng
100% câu đã đọc. Dùng làm baseline đối chiếu với các file sau.

**2. `2_22082351775.wav` (16.88s, đọc dãy số danh bộ)**
`speech_started` ở +3917ms nhưng `speech_stopped`/`committed` chốt NGAY ở
+5582ms - chỉ ~1.6 giây audio được commit (ước lượng chỉ khoảng 2 số đầu).
Transcript trả về: `"হয় হয়।"` - chữ Bengal vô nghĩa, dấu hiệu rõ ràng của
một đoạn audio bị cắt quá ngắn bị nhận diện sai. Ngay sau đó (+6606ms) có
`speech_started` LẦN HAI (khách vẫn đang đọc tiếp) nhưng script đóng kết
nối sau `response.done` đầu tiên nên không bắt được phần còn lại.

=> TÁI HIỆN ĐÚNG loại lỗi mà `session-ws.js` bản cũ từng vấp hàng chục lần
("model đọc số bay ra không đúng, VAD cắt mất số giữa chừng" - xem comment
[MỨC C - đợt 5] trong file đó). Đây là bằng chứng THẬT, tự tay tạo ra
được, không còn là suy đoán từ log sản xuất nữa.

**3. `3_ngap_ngung.wav` (16.44s, cùng dãy số nhưng có ngập ngừng đầu câu)**
`speech_started` ở +3215ms, `speech_stopped` ĐỢI tới +17857ms (~14.6 giây
audio liên tục). Transcript về ĐÚNG NGUYÊN VĂN: `"À, để anh xem, số danh
bộ là 2208-2351-775"`.

=> Cùng một dãy số, cùng có yếu tố "ngập ngừng", nhưng LẦN NÀY VAD không
cắt giữa chừng. Giả thuyết: KHÔNG PHẢI sự ngập ngừng làm VAD cắt sớm, mà
là KHOẢNG NGỪNG THẬT (im lặng) giữa các cụm số. File 3 có thể đã đọc liền
mạch (kể cả phần "À để anh xem" cũng là lời nói liên tục, không phải im
lặng), còn file 2 nhiều khả năng có những khoảng dừng giữa các cụm số đủ
dài để `semantic_vad (eagerness:low)` coi là hết lượt.

CẦN XÁC NHẬN LẠI với người ghi âm: lúc đọc file 2, có dừng hẳn (im lặng)
giữa các cụm số hay đọc liền một hơi? Đây sẽ là dữ liệu nền tảng để thiết
kế `turn_detection` cho `call-flow/danh-bo-collect.js` (Giai đoạn 6).

**4. `4_tap_am.wav` (5.85s, tạp âm nền, không nói gì)**
Không có `speech_started` nào xuất hiện trong suốt ~5.85s phát + 1.5s im
lặng thêm vào - phải Ctrl+C mới thoát được (script chưa có timeout khi
không phát hiện lượt nói nào - hạn chế của `probe-realtime.mjs`, không
phải hành vi VAD). Tin tốt: ở `eagerness:"low"`, tạp âm nền KHÔNG kích
hoạt nhầm `speech_started` trong lần thử này.

**5. Smoke test bằng text (không audio)**
Chạy đúng như thiết kế, xác nhận kết nối/cấu hình session hoạt động tốt
trước khi thử audio thật.

## Phát hiện quan trọng nhất: transcript về SAU khi response đã bắt đầu

Ở cả file 2 và file 3, event `conversation.item.input_audio_transcription
.completed` đến SAU `response.created` và XEN GIỮA các
`response.output_audio.delta` - tức là model đã bắt đầu tạo câu trả lời
(dựa trên audio thô nó tự nghe) TRƯỚC KHI transcript text mà mình đọc được
kịp xuất hiện.

=> Xác nhận bằng THỰC NGHIỆM điều đã ghi trong project memory
(`voicebot-transcript-debug-only.md`): transcript CHỈ để debug, KHÔNG phải
thứ model dùng để quyết định - model quyết định dựa trên audio thô nó tự
nghe, transcript là một luồng song song CHẬM HƠN, chỉ để code (và người)
quan sát.

## Kết luận / việc cần làm tiếp

1. Xác nhận lại với người ghi âm về cách đọc file 2 (dừng hẳn giữa các
   cụm số hay không) - sẽ quyết định cách diễn giải giả thuyết ở trên.
2. Khi thiết kế `call-flow/danh-bo-collect.js` (Giai đoạn 6): không thể
   dựa vào `semantic_vad` mặc định cho giai đoạn đọc số - đúng ý hệt lý
   do bản cũ đã chuyển sang `create_response:false` ("locked mode") cho
   giai đoạn này. Giờ đã có bằng chứng tự tay tái hiện, không còn là
   "nghe nói vậy".
3. `probe-realtime.mjs` cần thêm timeout an toàn (vd 20s không có
   `speech_started` thì tự đóng) -> chưa sửa, đang chờ quyết định có làm
   luôn ở Giai đoạn 1 hay để sau.
4. Điểm 2 (transcript đến sau response.created) cần được phản ánh vào
   thiết kế `turn-signal.js` (Giai đoạn 2): module này KHÔNG được dùng để
   quyết định "model có nên nói không" (quá muộn, response đã chạy rồi) -
   chỉ dùng để LOG/quan sát và cho các quyết định KHÔNG liên quan tới tạo
   response (vd đếm số, phát hiện từ khoá xác nhận/phủ định sau khi
   response đã xong).

## Bổ sung 21/08/2026: ràng buộc SIP-only làm Thí nghiệm C không áp dụng được cho bản sản xuất

Đã đối chiếu với code thật của bản sản xuất (`voice_bot/src/session-ws.js`,
`call-manager.js`) VÀ xác nhận lại với chủ dự án: dự án CHỈ dùng SIP
(OpenAI Realtime Calls API) + 1 WebSocket control-plane, KHÔNG dùng
AudioSocket. `session-ws.js` KHÔNG có lần gọi `input_audio_buffer.append`
hay `.commit` nào - audio đi thẳng từ SIP trunk vào OpenAI, Node chỉ nghe
event.

`scripts/probe-realtime.mjs` (nguồn của kết luận Thí nghiệm C bên dưới -
"tắt hẳn VAD, app tự commit") mở MỘT WebSocket THUẦN, KHÔNG qua SIP, và
TỰ NÓ append audio rồi tự gọi commit - nó đóng vai nguồn audio. Đây là
điểm khác biệt then chốt: kết luận "turn_detection:null + app tự commit
giải quyết triệt để" MỚI CHỈ được kiểm chứng NGOÀI SIP. Với kiến trúc SIP-
only thật sự, còn 2 câu hỏi CHƯA có câu trả lời:

1. `input_audio_buffer.commit` do Node gọi trên một session SIP (audio
   đến từ trunk, không phải do Node append) có tác dụng gì không - hay
   OpenAI coi buffer đó luôn rỗng vì Node chưa từng append gì?
2. Kể cả commit có tác dụng, Node lấy tín hiệu "khách đã ngừng nói" ở đâu
   để biết LÚC NÀO gọi commit - không còn VAD server (đã tắt), không có
   audio thô cục bộ (AudioSocket không dùng)?

=> KẾT LUẬN CUỐI CÙNG của Thí nghiệm C ("tắt VAD là hướng đơn giản và
chắc chắn hơn") CẦN SỬA LẠI thành: "...trong điều kiện có audio thô cục
bộ (vd qua AudioSocket)". Với ràng buộc SIP-only thật sự của dự án, hướng
khả thi là quay lại kết quả của Thí nghiệm A (gom nhiều mảnh transcript
qua `previous_item_id` ở tầng ứng dụng) - xem `docs/roadmap.md` Giai đoạn
6, Phương án A. Xem chi tiết ràng buộc và 2 phương án đề xuất (A: kế thừa
hướng Thí nghiệm A; B: model tự thu thập + code đối chiếu transcript) ở
`docs/roadmap.md`.

## Dữ liệu gốc

`logs/probe-*.jsonl` (không commit lên git - đã chặn trong `.gitignore`).

## Đính chính (bổ sung sau khi trao đổi với người ghi âm)

Giả thuyết "khoảng ngừng giữa các cụm số" ở trên CHƯA ĐỦ CĂN CỨ. Người ghi
âm cho biết: file 2 có tạp âm ở ĐOẠN CUỐI, file 3 KHÔNG có tạp âm. Hai file
đang khác nhau ở NHIỀU biến cùng lúc (có/không tạp âm, có/không câu dẫn "À
để anh xem", có thể cả cách ngắt nhịp đọc số) - không tách được biến nào
là nguyên nhân thật sự.

Lưu ý: tạp âm ở đoạn cuối file 2 (16.88s) khó giải thích được lần cắt sớm
ở +5582ms (chỉ ~1.6s sau khi bắt đầu nói) - quá xa thời điểm tạp âm cuối
file. Nên tạp âm cuối file khó là thủ phạm TRỰC TIẾP của lần cắt sớm đó,
nhưng vẫn có thể là một biến gây nhiễu khác (vd ảnh hưởng tới
`speech_started` lần hai ở +6606ms).

=> CẦN TEST LẠI với biến được tách riêng - 3 file mới, mỗi file chỉ đổi
ĐÚNG MỘT biến so với baseline:
- `5_so_lien_mach_sach.wav`: đọc một dãy số (bịa) LIÊN MẠCH, phòng yên
  tĩnh, không câu dẫn.
- `6_so_ngat_quang_sach.wav`: CÙNG dãy số đó, dừng ~0.7-1s giữa mỗi cụm
  2-3 số, phòng yên tĩnh, không câu dẫn. (So sánh trực tiếp với file 5 -
  chỉ khác đúng một biến: có/không khoảng ngừng.)
- `7_so_lien_mach_co_tap_am.wav`: đọc liền mạch như file 5, nhưng có tạp
  âm nền suốt lúc ghi. (Tách riêng ảnh hưởng của tạp âm khỏi khoảng
  ngừng.)

Chưa chạy - đang chờ người ghi âm chuẩn bị 3 file này.

## Cập nhật 20/08/2026 (2): đổi transcription model

Áp dụng thay đổi transcription config (`scripts/probe-realtime.mjs`):
`gpt-4o-mini-transcribe` -> `gpt-4o-transcribe`, thêm `language: "vi"` +
`prompt` ngữ cảnh domain (dùng ý hệt đoạn config mà dự án bản cũ đã dùng
cho SIP, có lý do riêng - xem comment trong file).

QUAN TRỌNG: thay đổi này CHỈ nằm trong `audio.input.transcription`, HOÀN
TOÀN TÁCH BIỆT khỏi `audio.input.turn_detection` (VAD). Đúng tinh thần
phát hiện ở trên (transcript chỉ để debug, không ảnh hưởng lúc model
quyết định nói) - đổi transcription model KHÔNG làm thay đổi thời điểm
`speech_started`/`speech_stopped`/`committed`/`response.created`.

=> KHÔNG cần chạy lại 3 file kiểm chứng VAD (5/6/7) vì đổi này. Nhưng NÊN
chạy lại đúng file `2_22082351775.wav` (file đã cho transcript vô nghĩa
"হয় হয়।") với config mới, xem `gpt-4o-transcribe`
+ `language:"vi"` + prompt domain có sửa được lỗi phiên âm sai ngôn ngữ
đó hay không - đây là một trục quan sát khác (chất lượng transcript),
độc lập với trục VAD-cắt-sớm ở trên.

## Kết luận cuối cùng (20/08/2026, sau khi test lại có kiểm soát biến)

Đã chạy 7 file: `2_22082351775.wav` (đọc lại, model transcription mới),
`6_ngap_ngung.wav`, và 5 file `..._lienmach_noise{1..5}.wav` (đọc liền mạch
+ tạp âm ở các mức độ khác nhau). Kết quả (số gốc `22082351775`, 11 chữ số):

| File | Kiểu đọc | Tạp âm | Bị cắt sớm? | Transcript |
| --- | --- | --- | --- | --- |
| `2_22082351775.wav` | có khoảng ngừng | không | CÓ (+5506ms, ~1.7s) | "Hai hai" |
| `6_ngap_ngung.wav` | ngập ngừng, có ngừng | không | CÓ (+4919ms, ~2.5s) | "202002" |
| `..._lienmach_noise1.wav` | liền mạch | có | Không (+9972ms, trọn vẹn) | "2202 3251 775." |
| `..._lienmach_noise2.wav` | liền mạch | có | Không (+10227ms, trọn vẹn) | "2202 3251 7755" |
| `..._lienmach_noise3.wav` | liền mạch | có | Không (+10182ms, trọn vẹn) | "2202 3251 7755" |
| `..._lienmach_noise4.wav` | liền mạch | có (ồn hơn?) | Cắt gần cuối + response bị cancel | "22020325077575" (garbled) |
| `..._lienmach_noise5.wav` | liền mạch | có (ồn nhất?) | VAD KHÔNG nhận ra lời nói - phải Ctrl+C | (không có) |

KẾT LUẬN: đúng như giả thuyết ban đầu - KHOẢNG NGỪNG GIỮA CÁC CỤM SỐ là
nguyên nhân khiến `semantic_vad (eagerness:low)` cắt sớm, KHÔNG PHẢI tạp
âm (3/5 file có tạp âm vẫn đợi trọn vẹn hết câu). Đổi transcription model
(`gpt-4o-transcribe`) KHÔNG sửa được việc cắt sớm (đúng dự đoán - đây là
hai cơ chế độc lập), nhưng CÓ sửa được triệu chứng "chữ là vô nghĩa":
transcript của đoạn bị cắt lần này là "Hai hai" (đúng tiếng Việt) thay vì
"হয় হয়।" (chữ Bengal) như trước khi đổi model.

PHÁT HIỆN PHỤ: file `noise5` lộ ra lỗi NGƯỢC LẠI - tạp âm quá lớn khiến
VAD không nhận ra có người đang nói, bot sẽ im lặng vô thời hạn nếu không
có lưới an toàn. Đây là lý do watchdog (Giai đoạn 7) không thể bỏ qua.

PHÁT HIỆN PHỤ 2: mỗi lần VAD cắt sớm, hệ thống sinh `response.created`
rồi gần như ngay sau đó bị `response.done status="cancelled"` (do
`interrupt_response:true` phát hiện khách vẫn đang nói tiếp) - cơ chế
ngắt hoạt động đúng thiết kế, nhưng trong luồng đọc số thật sẽ nghe như
bot bị "giật" giữa chừng.

=> ÁP DỤNG CHO GIAI ĐOẠN 6 (`call-flow/danh-bo-collect.js`): không thể
dùng `semantic_vad` (dù eagerness thấp) cho giai đoạn đọc số - cần
`create_response:false` (locked mode, đúng ý hệt hướng bản cũ) VÌ khách
hàng thực tế sẽ dừng giữa các cụm số (hoàn toàn tự nhiên khi đọc dãy 11
chữ số), và thí nghiệm này chứng minh VAD không thể đợi qua những khoảng
dừng đó một cách đáng tin cậy dù eagerness đã là mức thấp nhất.

## So sánh model: gpt-realtime-2.1-mini vs gpt-realtime-2.1 (20/08/2026)

Chạy lại TOÀN BỘ các file test (1, 2, 2_lienmach + noise1-5, 3, 4, 6) với
`OPENAI_REALTIME_MODEL=gpt-realtime-2.1` (bản đầy đủ, thay vì mini) - chỉ
đổi biến môi trường, không sửa code (script đã đọc model từ env sẵn).

| File | mini - cắt sớm? | đầy đủ - cắt sớm? |
| --- | --- | --- |
| `1_hoa_don...wav` | Không, trọn vẹn | Không, trọn vẹn |
| `2_22082351775.wav` (có khoảng ngừng) | CÓ (+5506ms) -> "Hai hai" | CÓ, còn sớm hơn (+4805ms) -> "Hai hai" |
| `2_..._lienmach.wav` (liền mạch, sạch - file mới) | (chưa test với mini) | CẮT NHẸ (+7359ms, thiếu ~1s cuối) -> "2202 3251 77" (thiếu số cuối) |
| `2_..._lienmach_noise1/2/3.wav` | Không, trọn vẹn cả 3 | Không, trọn vẹn cả 3 (transcript chính xác hơn một chút) |
| `2_..._lienmach_noise4.wav` | Cắt gần cuối + cancel | Cắt gần cuối + cancel (giống hệt pattern) |
| `2_..._lienmach_noise5.wav` (ồn nặng) | VAD không nhận ra lời nói | VAD không nhận ra lời nói (giống hệt) |
| `3_ngap_ngung.wav` | Không, trọn vẹn | Không, trọn vẹn |
| `4_tap_am.wav` | Không kích hoạt (đúng) | Không kích hoạt (đúng) |
| `6_ngap_ngung.wav` (có ngừng) | CÓ (+4919ms) -> "202002" | CÓ (+4798ms) -> "2022022" |

KẾT LUẬN: đổi sang `gpt-realtime-2.1` (bản đầy đủ) KHÔNG giải quyết được
vấn đề cắt sớm. Cả hai file "khó" (có khoảng ngừng thật) vẫn bị cắt ở CẢ
HAI model - bản đầy đủ còn cắt file 2 SỚM HƠN một chút (4805ms so với
5506ms của mini). Đáng chú ý hơn: file `lienmach.wav` mới (đọc liền mạch,
sạch, không tạp âm) - kịch bản lẽ ra "dễ" nhất - cũng bị cắt mất số cuối
với bản đầy đủ.

=> Củng cố thêm (không làm lung lay) kết luận trước: không thể tin
`semantic_vad` (dù model nào) sẽ luôn đợi đúng ranh giới lượt nói khi có
khoảng ngừng tự nhiên trong lời nói - đây là giới hạn của cơ chế VAD ngữ
nghĩa, KHÔNG PHẢI giới hạn riêng của bản mini. Quyết định dùng
`create_response:false` cho giai đoạn thu số ở Giai đoạn 6 giờ có thêm
một lớp bằng chứng nữa, ĐỘC LẬP với việc chọn model nào cho phần còn lại
của bot - không cần đổi model riêng cho giai đoạn này.

## Thí nghiệm mở rộng: create_response:false có ngăn VAD tách lượt nói không? Và server_vad có khá hơn semantic_vad không? (20/08/2026, 2 model)

Câu hỏi còn lại sau khi đã xác định "cần create_response:false cho Giai
đoạn 6": khi tắt create_response, VAD (`input_audio_buffer.speech_started`
/ `speech_stopped` / `committed`) có CÒN tiếp tục tự tách 1 câu trả lời
liên tục (đọc 11 số danh bộ, có ngừng tự nhiên giữa các cụm) thành nhiều
`conversation.item` riêng không - hay giữ nguyên 1 buffer liên tục cho tới
khi app chủ động gửi `response.create`? Đây là câu hỏi kiến trúc cốt lõi
cho `call-flow/danh-bo-collect.js`.

Đã sửa `scripts/probe-realtime.mjs` thêm 2 biến môi trường
`PROBE_CREATE_RESPONSE` và `PROBE_TURN_TYPE`/`PROBE_SILENCE_MS`, chạy lại
trên CẢ HAI model (`gpt-realtime-2.1` và `gpt-realtime-2.1-mini`), 2 file
có khoảng ngừng thật (`2_22082351775.wav`, `6_ngap_ngung.wav`).

### Kết quả A - create_response:false (semantic_vad, eagerness low)

| Model | File | Số `input_audio_buffer.committed` | Các mảnh transcript (theo thứ tự) |
| --- | --- | --- | --- |
| gpt-realtime-2.1 | `2_22082351775.wav` | 4 | "Hai hai" -> "Không tám" -> "Hai ba năm một." -> "775." |
| gpt-realtime-2.1-mini | `2_22082351775.wav` | 4 | "Hai hai" -> "Không tám" -> "2351" -> "775." |
| gpt-realtime-2.1 | `6_ngap_ngung.wav` | 3 | "2202" -> "3251." -> "775." |
| gpt-realtime-2.1-mini | `6_ngap_ngung.wav` | 3 | "22002" -> "3251." -> "775" |

**Số liệu tham khảo cho ngưỡng "khoảng lặng dài hơn giữa các cụm" (Phương án A, Giai đoạn 6):** đo trực tiếp từ log thí nghiệm này (`audio_end_ms` của lần `speech_stopped` trước, so với `audio_start_ms` của lần `speech_started` kế tiếp) - khoảng ngừng GIỮA CÁC CỤM SỐ trong 2 file test dao động khoảng **416ms - 1348ms** (cả 2 model, cả 2 file). Đây là số đo từ `semantic_vad` (không phải năng lượng âm thanh thô), chỉ mang tính tham khảo ban đầu - nhưng đáng lưu ý: khoảng dừng CUỐI CÂU thật (khi khách đã đọc xong) có thể KHÔNG dài hơn nhiều so với khoảng dừng GIỮA các cụm số (cùng một người, cùng một nhịp thở) - chỉ dựa vào độ dài im lặng để phân biệt "đang dừng giữa chừng" và "đã nói xong" có thể KHÔNG đủ tin cậy một mình, nên ưu tiên tín hiệu "đã đủ 11 chữ số" làm điều kiện kết thúc chính, im lặng dài chỉ là lưới an toàn phụ.

KẾT LUẬN QUAN TRỌNG NHẤT: `create_response:false` KHÔNG ngăn VAD tách lượt
nói. Mỗi khi người nói ngừng giữa các cụm số, server vẫn tự `committed`
một item MỚI (có `previous_item_id` trỏ về item trước - server biết đây
là 1 chuỗi liên tục, nhưng vẫn là nhiều item vật lý riêng, nhiều event
`transcription.completed` riêng). `create_response:false` CHỈ làm đúng
một việc: không tự động sinh câu trả lời sau mỗi lần committed (xác nhận:
không có event `response.created` nào trong cả 4 lần chạy này) - còn việc
tách đoạn vẫn diễn ra nguyên vẹn, giống hệt khi bật create_response.

=> HỆ QUẢ THIẾT KẾ CHO GIAI ĐOẠN 6: `danh-bo-collect.js` KHÔNG THỂ coi
"1 lần committed = 1 câu trả lời đầy đủ". Phải GOM (concat) transcript
qua nhiều item liên tiếp (dùng `previous_item_id` để biết chuỗi nào thuộc
cùng 1 lượt thu thập) cho tới khi có tín hiệu KẾT THÚC THẬT SỰ - ví dụ:
đã gom đủ 11 chữ số (khớp pattern danh bộ), hoặc hết một khoảng im lặng
dài hơn nhiều so với khoảng ngừng bình thường giữa các cụm (cần đo đạc,
xem số liệu audio_end_ms/audio_start_ms trong log để chọn ngưỡng), hoặc
khách xác nhận bằng lời/DTMF. Đây là phần logic MỚI cần thiết kế riêng,
chưa có trong bản cũ (bản cũ dùng watchdog+timer đơn giản hơn vì luồng
nghiệp vụ đơn giản hơn).

### Kết quả B - server_vad thay semantic_vad (create_response:true, để so sánh loại VAD)

| Model | silence_duration_ms | Cắt ở đâu? | Transcript nhận được | response.done |
| --- | --- | --- | --- | --- |
| gpt-realtime-2.1 | 800 | Cụm số đầu tiên | "Hai hai." | cancelled (barge-in khi khách nói tiếp) |
| gpt-realtime-2.1 | 1200 | Cụm số đầu tiên (vẫn cắt) | "22" | cancelled |
| gpt-realtime-2.1-mini | 800 | Cụm số đầu tiên | "22" | cancelled |
| gpt-realtime-2.1-mini | 1200 | Cụm số đầu tiên (vẫn cắt) | "Hai hai." (transcript đến SAU khi response đã cancel) | cancelled |

KẾT LUẬN: tăng `silence_duration_ms` lên 1200ms (cao hơn nhiều so với mặc
định 500ms) VẪN KHÔNG đủ để vượt qua khoảng ngừng thật giữa cụm số đầu và
cụm số thứ hai trong file ghi âm này - nghĩa là khoảng ngừng thực tế dài
hơn 1200ms. Đổi sang `server_vad` (kiểu cũ, dựa ngưỡng năng lượng cố
định) KHÔNG giải quyết được vấn đề, chỉ là đổi tên cơ chế - vẫn bị cắt y
hệt `semantic_vad`. `interrupt_response:true` vẫn hoạt động đúng (huỷ
response đang phát khi phát hiện khách nói tiếp), ở cả hai loại VAD.

### Kết luận chung cho Giai đoạn 6

Không có tổ hợp `turn_detection` nào (loại VAD, model, ngưỡng) tự nó giải
quyết được bài toán thu số danh bộ có ngừng tự nhiên. `create_response:false`
là BẮT BUỘC (đúng), nhưng CHƯA ĐỦ một mình - cần thêm logic gom nhiều
mảnh transcript thành 1 câu trả lời hoàn chỉnh ở tầng ứng dụng
(`call-flow/danh-bo-collect.js`), dựa vào `previous_item_id` để xâu chuỗi
và một điều kiện kết thúc riêng (đủ số chữ số hoặc im lặng dài). Đây sẽ
là yêu cầu thiết kế rõ ràng khi bắt đầu Giai đoạn 6, không còn là giả
định nữa.

## Thí nghiệm C: tắt hẳn VAD server (turn_detection:null), tự commit buffer 1 lần (20/08/2026, 2 model)

> **⚠️ CẬP NHẬT 21/08/2026: kết luận của thí nghiệm này KHÔNG áp dụng được cho bản sản xuất.** Dự án chỉ dùng SIP (OpenAI Realtime Calls API), Node không tự append/commit audio thô - xem mục "Bổ sung 21/08/2026: ràng buộc SIP-only..." bên dưới và "Ràng buộc kiến trúc" ở đầu `docs/roadmap.md`. Phần dưới đây vẫn đúng về mặt kỹ thuật (giải thích VÌ SAO ý tưởng này hoạt động), nhưng đừng dừng lại ở dòng "Kết luận cuối cùng" cuối mục này - nó đã bị sửa lại, xem ghi chú ở cuối mục.

Ý tưởng: nếu VAD (cả semantic_vad lẫn server_vad) là nguyên nhân tách lượt
nói thành nhiều mảnh (xem thí nghiệm A/B ở trên), thử tắt hẳn nó đi - app
tự quyết định khi nào "chốt" (commit) buffer, không để server tự đoán.
Sửa `scripts/probe-realtime.mjs` thêm `PROBE_TURN_TYPE=none`
(`turn_detection: null`): script phát hết audio (cả đoạn có ngừng) rồi tự
gửi `input_audio_buffer.commit` ĐÚNG MỘT LẦN, sau đó tuỳ chọn có gọi
`response.create` thủ công hay không.

Chạy trên cả 2 model, 2 file có khoảng ngừng thật, cả 2 trường hợp
create_response false/true:

| Model | File | create_response | Số lần `committed` | Transcript (MỘT mảnh duy nhất) |
| --- | --- | --- | --- | --- |
| gpt-realtime-2.1-mini | `2_22082351775.wav` | false | 1 | "2208 23 51 77 5" |
| gpt-realtime-2.1-mini | `2_22082351775.wav` | true | 1 | "220823515775" |
| gpt-realtime-2.1-mini | `6_ngap_ngung.wav` | false | 1 | "2202 3251 775" |
| gpt-realtime-2.1 | `2_22082351775.wav` | false | 1 | "22082351775" |
| gpt-realtime-2.1 | `2_22082351775.wav` | true | 1 | "2208 23 51 77 5" |
| gpt-realtime-2.1 | `6_ngap_ngung.wav` | false | 1 | "220203251775" |

KẾT QUẢ: CẢ 6/6 LẦN CHẠY chỉ có ĐÚNG MỘT `input_audio_buffer.committed`
và ĐÚNG MỘT `conversation.item.input_audio_transcription.completed` -
KHÔNG còn bị tách thành nhiều mảnh nữa, dù audio có khoảng ngừng tự nhiên
giữa các cụm số dài bao nhiêu. Đây là khác biệt rõ ràng so với thí
nghiệm A (cùng 2 file này, cùng 2 model, nhưng dùng VAD thì bị tách 3-4
mảnh).

=> XÁC NHẬN: nguyên nhân gốc rễ của việc tách lượt nói là cơ chế VAD
(server tự quyết định điểm cắt), KHÔNG PHẢI bản thân Realtime API hay
model. Khi app tự kiểm soát hoàn toàn thời điểm commit (`turn_detection:
null`), server chỉ transcribe NGUYÊN VĂN những gì có trong buffer tại
thời điểm commit - kể cả khoảng ngừng bên trong.

RỦI RO CÒN LẠI (không liên quan tới tách lượt nói, là chất lượng nhận
dạng giọng nói thuần tuý): transcript đôi khi lệch 1 chữ số so với thực
tế dù là 1 mảnh duy nhất - vd cùng 1 người đọc, bản `create_response:true`
của mini trả về "220823515775" (12 chữ số, dù 22082351775 chỉ có 11), bản
full/`6_ngap_ngung` trả về "220203251775" (cũng dư 1 số). Đây là lỗi của
model transcribe (`gpt-4o-transcribe`), không phải lỗi tách lượt - cần có
cơ chế xác nhận lại với khách (đọc lại số vừa nhận để khách xác nhận
đúng/sai) ở Giai đoạn 6, không thể tin 100% transcript đầu vào.

ĐÁNH ĐỔI cần lưu ý: khi tắt VAD hoàn toàn, KHÔNG còn `interrupt_response`
tự động nào cả (không có VAD nào để phát hiện khách nói tiếp giữa chừng
mà huỷ response) - cả 2 lần create_response:true đều kết thúc bình thường
`response.done status=completed`, không có lần nào bị `cancelled`. Với
"locked mode" (đang đọc số, muốn khách đọc hết không bị ngắt) đây là
ĐIỀU MONG MUỐN, không phải nhược điểm.

### Kết luận cuối cùng cho kiến trúc Giai đoạn 6

Đổi lại đề xuất trước (gom nhiều mảnh transcript qua `previous_item_id`):
CÁCH ĐƠN GIẢN VÀ CHẮC CHẮN HƠN là dùng `turn_detection: null` cho cả giai
đoạn thu thập mã danh bộ, rồi TỰ APP (không phải VAD của OpenAI) quyết
định khi nào commit - ví dụ dựa vào: đã nhận đủ số khung PCM tương ứng
với ~X giây (ước lượng thời gian đọc 11 số), hoặc tự theo dõi năng lượng
âm thanh thô (buffer đã yên lặng liên tục Y giây) ở tầng audiosocket
trước khi gọi `input_audio_buffer.commit`. Nhờ đó:
- Luôn nhận được ĐÚNG MỘT transcript cho cả câu trả lời, không cần logic
  gom/xâu chuỗi nhiều item.
- Không có nguy cơ bị `interrupt_response` huỷ response giữa chừng.
- Nhược điểm duy nhất: mất luôn cơ chế "server tự phát hiện người nói
  xong" - app phải tự làm việc này (có thể đơn giản: chờ tới khi audio
  buffer thô liên tục yên lặng qua 1 ngưỡng, hoặc chờ hết thời lượng tối
  đa hợp lý).
- Vẫn cần có bước "xác nhận lại danh bộ với khách" ở Giai đoạn 6 vì
  transcript có thể lệch 1 chữ số ngay cả khi không bị tách lượt nói.

(**LƯU Ý (21/08/2026): kết luận trên đã được sửa lại ở mục "Bổ sung
21/08/2026" phía trên - `turn_detection: null` không áp dụng được cho bản
sản xuất vì kiến trúc chỉ SIP-only, không có audio thô cục bộ.**)
