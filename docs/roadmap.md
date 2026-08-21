# Lộ trình viết lại (voice-bot-trungan v2)

Nguyên tắc chung: mỗi giai đoạn viết ít nhất có thể, tự kiểm chứng được
(test/log rõ ràng) trước khi qua giai đoạn kế tiếp. Mỗi giai đoạn là MỘT
commit git riêng để dễ rollback.

## Vì sao chia giai đoạn như vậy (bổ sung 21/08/2026)

Bản cũ (`session-ws.js`) là một file lớn, trộn lẫn nhiều mối lo trong
cùng một chỗ: kết nối WebSocket, quyết định khi nào bot được nói, logic
nghiệp vụ (tra cứu/xác nhận danh bộ), và các đoạn vá race condition -
khi có bug, rất khó biết lỗi nằm ở lớp nào. Mục tiêu của bản viết lại là
TÁCH RIÊNG từng mối lo thành từng lớp độc lập, để mỗi lớp hiểu/test được
riêng biệt.

Nguyên tắc xuyên suốt: xây từ DƯỚI LÊN, lớp sau chỉ được xây khi lớp
trước đã CÓ TEST chứng minh là đúng (không phải "chắc là đúng"). Thứ tự
10 giai đoạn phản ánh đúng thứ tự phụ thuộc đó:

- **Giai đoạn 1** (biết sự thật): quan sát event thật từ OpenAI trước khi
  thiết kế bất kỳ thứ gì lên trên - tránh thiết kế dựa trên đoán rồi phải
  làm lại.
- **Giai đoạn 2-3** (nền tảng kỹ thuật, tách khỏi nghiệp vụ):
  `turn-signal.js` dịch event thô sang hình dạng dễ hiểu (không quyết
  định gì); `turn-controller.js` là nơi DUY NHẤT được ra lệnh nói/dừng
  nói, gom đúng lớp bug hay gặp nhất của bản cũ (race condition) vào MỘT
  chỗ, test kỹ trước khi ai khác được phép gọi.
- **Giai đoạn 4** (kiểm tra nền tảng hoạt động): chỉ làm kịch bản đơn
  giản nhất (hỏi đáp tự do) để xác nhận 2 lớp nền tảng thực sự phối hợp
  được với nhau, trước khi thêm nghiệp vụ phức tạp lên trên - nếu nền có
  vấn đề, phát hiện ở đây, không lẫn với bug nghiệp vụ sau này.
- **Giai đoạn 5-7** (nghiệp vụ, từ dễ đến khó nhất, cộng lưới an toàn):
  chuyển logic nghiệp vụ thật (lọc bỏ phần chỉ tồn tại để vá race của
  kiến trúc cũ); Giai đoạn 6 (danh bộ) là phase rủi ro cao nhất nên để
  sau cùng trong nhóm này, khi nền tảng đã vững; Giai đoạn 7 (watchdogs)
  là lưới an toàn cho các tình huống không lường trước được.
- **Giai đoạn 8** (nối thật): cố tình để CUỐI CÙNG vì một khi có điện
  thoại thật, mỗi lần test là một cuộc gọi thật, không tự động hoá được -
  để dành phần này sau cùng nghĩa là lúc nối dây thật, logic bên trong đã
  được test kỹ bằng script giả lập rồi.
- **Giai đoạn 9** (chốt thay thế): bản mới chỉ được phép thay bản cũ khi
  pass đúng bộ test bản cũ từng dùng để tự tin là đúng.

Mỗi giai đoạn là câu trả lời cho câu hỏi: "làm sao biết bước trước ĐÃ
ĐÚNG trước khi tin tưởng xây tiếp lên trên nó".

## Ràng buộc kiến trúc (bổ sung 21/08/2026, đã xác nhận với chủ dự án)

Bản SẢN XUẤT (`voice_bot`) chỉ dùng SIP (OpenAI Realtime Calls API -
accept/reject/refer/hangup qua `call-manager.js`) + MỘT WebSocket
control-plane để nghe/gửi session event. KHÔNG dùng AudioSocket - Node
KHÔNG BAO GIỜ nhận hay tự append audio thô (xác nhận lại với chủ dự án
21/08/2026; đối chiếu code cũ cũng không có lần gọi
`input_audio_buffer.append`/`.commit` nào trong `session-ws.js`). Hệ quả
cho cả lộ trình này:

- Bất kỳ thiết kế nào giả định "app tự đọc được audio thô để tự làm
  VAD/silence-detection" (vd `turn_detection: null` + app tự gọi
  `input_audio_buffer.commit` - xem "Thí nghiệm C" trong
  `docs/fix/giai_doan_1_quan_sat_event_that_20260820.md`) đều KHÔNG dùng
  được cho bản sản xuất, trừ khi có quyết định riêng (rủi ro cao, cần hỏi
  lại chủ dự án) bật AudioSocket song song SIP - hiện KHÔNG nằm trong
  phạm vi dự án.
- Giai đoạn 8 vì vậy chỉ nối lại SIP thật qua `call-manager.js`, KHÔNG
  "nối AudioSocket" (xem chi tiết ở Giai đoạn 8 bên dưới).
- Giai đoạn 6 (thu thập danh bộ) phải chọn hướng tương thích SIP+WS
  thuần - xem 2 phương án bên dưới.

- [x] **Giai đoạn 0 - Khung xương.** `package.json` (chưa có dependency),
  cây thư mục rỗng theo lớp (`src/session`, `src/call-flow`, `src/domain`,
  `src/integrations`, `src/logging`, `docs/fix`, `test`). Mục tiêu: `npm
  start` chạy, log ra "OK", chưa kết nối gì cả.

- [x] **Giai đoạn 1 - Nhìn tận mắt luồng event thật.** Đã chạy
  `scripts/probe-realtime.mjs` với 5 file audio test (câu hỏi thường, đọc
  số danh bộ, đọc số có ngập ngừng, tạp âm, smoke test text). Phát hiện
  quan trọng: đọc số có khoảng ngừng giữa các cụm -> `semantic_vad
  (eagerness:low)` có thể cắt lượt nói giữa chừng (tái hiện đúng lỗi bản cũ
  từng vấp); transcript luôn đến SAU khi response đã bắt đầu, không dùng để
  quyết định được. Chi tiết + dữ liệu đối chiếu: xem
  `docs/fix/giai_doan_1_quan_sat_event_that_20260820.md`.

- [x] **Giai đoạn 2 - `src/session/turn-signal.js`.** Hàm thuần
  `normalizeTurnEvent(rawEvent)`: nhận 1 event thô, trả về object
  `{kind, ...}` đã chuẩn hoá (speech-started/stopped, buffer-committed
  có previousItemId, transcript-ready, response-started/ended, error,
  ignored). Test ở `test/turn-signal.test.mjs`, replay fixture
  `test/fixtures/turn-signal-events.jsonl` (dạng giống log thật của
  Giai đoạn 1) bằng `node --test` (npm run test) - không gọi OpenAI
  thật. 5/5 test pass.

- [x] **Giai đoạn 3 - `src/session/turn-controller.js`.** Cửa duy nhất
  gửi `response.create`/`cancel`, API tối giản `say({mode: "auto"|
  "guided"|"verbatim"|"tool", ...})`. Chống 3 race đã biết ở bản cũ bằng
  "generation token" + hàng đợi FIFO các response.create đã gửi nhưng
  chưa có response-started: mỗi say() tăng `generation`, huỷ (đúng
  response_id thật nếu đã biết, không đoán mò) mọi thứ đang chờ/đang
  chạy, đánh dấu chúng "đã huỷ"; tín hiệu response-started tiếp theo
  luôn ghép với phần tử ở ĐẦU hàng đợi (đúng thứ tự server xử lý) - nếu
  phần tử đó đã bị đánh dấu huỷ thì đây là tín hiệu "trễ" của generation
  cũ, bị bỏ qua có ý, không được ghi đè state của generation mới (đây là
  điểm mấu chốt: chỉ so generation hiện tại là không đủ, vì đó là 1 biến
  dùng chung, không tự phân biệt được tín hiệu trễ thuộc lần say() nào).
  Test ở `test/turn-controller.test.mjs` bằng WS giả (mock `ws.send`),
  bao phủ: hai response cùng gửi, cancel nhầm response, tín hiệu trễ từ
  generation đã bị huỷ, retry mở khoá, và luồng bình thường. 18/18 test
  pass (`node --test`, gồm cả 5 test của Giai đoạn 2).

- [ ] **Giai đoạn 4 - Checkpoint gọi thử đầu-cuối đầu tiên.** Chỉ
  implement phase "hỏi đáp tự do" (`create_response:true`, model tự trả
  lời). `src/session/session-ws.js` là orchestrator mỏng nối các lớp lại.

- [ ] **Giai đoạn 5 - Chuyển logic nghiệp vụ có chọn lọc.** Đưa
  `tools.js`, `system-prompt.js`, `db.js`, `api.js`,
  `danh-bo-arbiter.js` từ project cũ sang `src/domain/` / `src/
  integrations/` - rà soát: giữ phần nghiệp vụ thật, bỏ phần chỉ tồn tại
  để vá race của kiến trúc cũ (turn-controller đã lo việc đó). Đối chiếu
  với các quyết định đã ghi trong project memory (transcript chỉ để
  debug, gate xác nhận lời nói cho danh bộ trọng tài, SĐT test hardcode)
  để không đánh mất bài học.

- [ ] **Giai đoạn 6a - Phương án A: code/VAD gom transcript (danh bộ).**
  (Quyết định 21/08/2026: tách Giai đoạn 6 cũ thành 6a/6b làm TUẦN TỰ,
  đúng nguyên tắc "viết ít nhất có thể, tự kiểm chứng trước khi qua giai
  đoạn kế" - xem `docs/fix/giai_doan_1_quan_sat_event_that_20260820.md`.
  6a xong, test/commit ổn mới sang 6b, không làm song song.)

  Code/VAD xác định số (kế thừa tinh thần bản cũ, model KHÔNG được tự đưa
  số vào tool). `danh-bo-collect.js`: giữ VAD như hiện tại (chấp nhận VAD
  tách thành nhiều mảnh `input_audio_buffer.committed`), CODE tự gom các
  mảnh transcript liên tiếp bằng `previous_item_id` (đã có sẵn trong
  `turn-signal.js` - trường `buffer-committed.previousItemId`), tự
  quyết định điểm KẾT THÚC một lượt đọc (đủ 11 chữ số, hoặc khoảng lặng
  dài hơn ngưỡng giữa các cụm - tham khảo số liệu 416ms-1348ms đã đo ở
  Giai đoạn 1, nhưng ưu tiên "đủ 11 chữ số" làm điều kiện chính), rồi CODE
  gọi `_speakVerbatim` đọc lại xin xác nhận - đúng tinh thần Thí nghiệm A
  của Giai đoạn 1. TƯƠNG THÍCH SIP+WS thuần, không cần audio thô.
  `danh-bo-confirm.js`: xử lý câu trả lời của khách (đúng/sai/sửa) bằng
  bảng matcher.

  Test từng matcher bằng fixture transcript riêng lẻ, rồi mới test tích
  hợp qua harness của Giai đoạn 1.

- [ ] **Giai đoạn 6b - Phương án B: model tự thu thập + code đối chiếu
  (danh bộ).** Chỉ bắt đầu sau khi 6a đã xong và có kết quả để so sánh.
  Đề xuất 21/08/2026, thực hiện theo đúng "Entity Collection Workflow" của
  OpenAI - skill `realtime-voice-prompting`, `references/prompting-guide.md`
  mục 11. Model được phép tự nghe, chuẩn hoá, VÀ đọc lại TỪNG CHỮ SỐ xin
  khách xác nhận (không đọc nguyên cả số - dễ lộ sai). Chỉ sau khi khách
  xác nhận, model gọi 1 tool RIÊNG `confirm_danh_bo(value)` (KHÔNG gộp
  chung với tool tra cứu - để code có 1 điểm neo rõ ràng để đối chiếu,
  thay vì phải đoán trong cả dòng hội thoại). Code ở tool-handler:
  1. Khớp cặp "câu model vừa đọc lại xin xác nhận" (event
     `response.output_audio_transcript...` - tin cậy cao vì là text gốc
     điều khiển TTS, KHÔNG phải kết quả ASR) với "câu khách trả lời ngay
     sau đó" (`conversation.item.input_audio_transcription.completed`),
     dùng `previous_item_id`/thứ tự item để khớp ĐÚNG CẶP, không chỉ lấy
     "N event gần nhất" (tránh khớp nhầm do độ trễ bất đồng bộ đã ghi
     nhận ở Giai đoạn 1 - transcript có thể đến sau `response.created`).
  2. Trích số từ chính câu model đọc lại (parse text model tự sinh ra -
     dễ hơn nhiều so với parse ASR, vì là chuỗi xác định chứ không phải
     audio) và xác định khách có xác nhận "đúng" hay không (dùng lại bộ
     phát hiện đã có sẵn cho nhánh trọng tài hiện tại).
  3. Nếu giá trị tool nhận được KHỚP với số đã trích từ bước 1-2 (và
     khách đã xác nhận đúng) -> dùng giá trị đó gọi API thật.
  4. Nếu LỆCH -> dùng số ĐÃ ĐƯỢC XÁC NHẬN qua transcript (không phải số
     model vừa gửi vào tool) để gọi API, ĐỒNG THỜI báo lại cho model qua
     tool result giá trị đúng đã dùng, để model nói nhất quán về sau.
  5. Cache số đã xác nhận vào `callState` cho cả cuộc gọi; mỗi lần gọi
     tool tra cứu kế tiếp đều đối chiếu với cache - nếu khác, áp lại
     đúng bước 3-4 (không tự động tin số mới, cũng không tự động chặn -
     khách có thể hỏi về một mã khác thật trong cùng cuộc gọi).
  6. Nếu bước 1 KHÔNG khớp được cặp transcript nào rõ ràng (vd ASR hỏng
     cả câu đọc lại lẫn câu xác nhận) -> KHÔNG mặc định tin số của model
     - rơi vào nhánh "không kết luận được", quay lại xin đọc lại hoặc
     leo thang DTMF (dùng watchdog của Giai đoạn 7).

  RỦI RO CẦN LƯU Ý ở Phương án B, CHƯA được giải quyết chỉ bằng đối
  chiếu transcript: cơ chế này chỉ bắt được lỗi "model NÓI một đằng, GỌI
  TOOL một nẻo" (đúng bug THẬT đã gặp 30/07/2026 - xem memory
  `voicebot-realtime-21-migration`: model tự gọi tool với số bịa khi mới
  nghe 4/11 số). Nó KHÔNG bắt được trường hợp model NGHE SAI từ đầu, đọc
  lại đúng cái SAI đó, khách (lơ đãng/tin tưởng bot) lỡ xác nhận "đúng"
  cho một số sai từ đầu - lúc đó cả 3 lớp (model nói, khách xác nhận,
  model gọi tool) "khớp nhau" nhưng vẫn SAI.

  QUYẾT ĐỊNH (21/08/2026): CÓ giữ lớp trọng tài gpt-5.1 độc lập (bản cũ
  dùng ở nhánh "trọng tài" - xem memory
  `voicebot-danhbo-verbal-confirm-gate`), nhưng CHỈ kích hoạt khi có đủ 2
  nguồn dữ liệu độc lập - một lần đọc+xác nhận duy nhất thì trọng tài
  không có thêm dữ liệu nào để phán xét (chỉ đang phúc tra lại đúng 1
  nguồn). Cơ chế kích hoạt cụ thể - thêm bước 2.5 vào quy trình trên:

  2.5. Sau bước 2 (trích số từ câu model đọc lại), SO SÁNH số đó với
       transcript ASR (`conversation.item.input_audio_transcription.
       completed`) của (các) lượt khách ĐỌC SỐ BAN ĐẦU (không phải câu
       model đọc lại xin xác nhận) - đây là nguồn độc lập, khác kênh với
       những gì model tự nghe. KHỚP -> đủ tin cậy, đi tiếp bước 3 bình
       thường, KHÔNG cần gọi trọng tài (tiết kiệm chi phí/độ trễ cho đa số
       trường hợp). KHÔNG KHỚP (hoặc ASR quá mơ hồ, không trích được số
       rõ ràng) -> yêu cầu khách đọc lại VÀ xác nhận thêm MỘT LẦN NỮA toàn
       bộ chu trình đọc-xác nhận; sau lần 2, gọi trọng tài gpt-5.1 SO SÁNH
       CẢ 2 LẦN (model đọc lại lần 1 + ASR gốc lần 1; model đọc lại lần 2
       + ASR gốc lần 2 + xác nhận lần 2) để đưa phán quyết cuối cùng - lúc
       này trọng tài mới có đủ 2 nguồn độc lập để đối chiếu chéo.

  ĐÁNH ĐỔI đã chấp nhận: ASR (`gpt-4o-transcribe`) tự nó không hoàn hảo
  (Giai đoạn 1 đã ghi nhận có thể lệch 1 chữ số dù model nghe đúng), nên
  bước 2.5 có thể gây một số lần "báo động giả" (bắt khách đọc lại dù
  model đã nghe đúng, chỉ vì ASR lệch) - chấp nhận được vì cái giá nhỏ hơn
  nhiều so với rủi ro đưa nhầm thông tin của khách khác.

  Test từng matcher/cơ chế đối chiếu bằng fixture transcript riêng lẻ,
  rồi mới test tích hợp qua harness của Giai đoạn 1.

- [ ] **Giai đoạn 7 - `src/session/watchdogs.js`.** Lưới an toàn dùng
  chung (mute watchdog, vad-restore watchdog). Test giả lập tình huống
  "quên trigger response" để xác nhận watchdog cứu được.

- [ ] **Giai đoạn 8 - Nối SIP thật qua OpenAI Realtime Calls API.**
  Chuyển `call-manager.js` (accept/reject/refer/hangup) sang cuối cùng -
  sau khi toàn bộ logic phía trên đã test được mà không cần điện thoại
  thật. KHÔNG dùng AudioSocket - `audiosocket.js` của bản cũ KHÔNG được
  mang sang (dự án sản xuất không dùng nó, xem "Ràng buộc kiến trúc" đầu
  file). Nếu về sau muốn thử hướng `turn_detection: null` + app tự VAD
  (Thí nghiệm C, Giai đoạn 1 - hiện KHÔNG khả thi, xem "Ràng buộc kiến
  trúc"), đây là quyết định kiến trúc riêng cần bật lại audio thô, ngoài
  phạm vi lộ trình này - phải hỏi lại chủ dự án trước.

- [ ] **Giai đoạn 9 - Đối chiếu với bộ test cũ.** Chuyển/thích nghi 4 file
  trong `test_case/*.test.mjs` của bản cũ (`danh_bo_20260726`,
  `danh_bo_verify_flow`, `speak_verbatim`, `muc_c_khong_cam`) sang chạy
  trên bản mới - điều kiện "được phép thay thế bản cũ" chỉ khi pass hết.

## Quy ước

- File/thư mục: kebab-case, không dấu cách, không hậu tố "copy"/"v2"/
  "backup" (git đã giữ lịch sử).
- Thuật ngữ nghiệp vụ tiếng Việt (danh bộ, xác nhận...) giữ nguyên trong
  tên - là ngôn ngữ nghiệp vụ cả team đang dùng.
- `src/session/` được phép biết về WebSocket/Realtime event.
  `src/domain/` KHÔNG được import gì từ `ws` - logic nghiệp vụ thuần,
  test được không cần mở kết nối thật.
- Mỗi thay đổi kiến trúc lớn ở `src/session/` nên có 1 file ghi lại trong
  `docs/fix/` (giống thói quen `docs/fix/` của bản cũ), giải thích VÌ SAO
  chứ không chỉ ĐÃ ĐỔI GÌ.
