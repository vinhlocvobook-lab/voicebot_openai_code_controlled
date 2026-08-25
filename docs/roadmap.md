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

- [x] **Giai đoạn 4 - Checkpoint gọi thử đầu-cuối đầu tiên.** Chỉ
  implement phase "hỏi đáp tự do" (`create_response:true`, model tự trả
  lời, code KHÔNG gọi `say()`). `src/session/session-ws.js` là
  orchestrator mỏng: tách `createSessionWs({ws, log})` (logic thuần, nhận
  message tho -> `normalizeTurnEvent` -> `turnController.handleSignal`,
  test bằng WS giả) và `connectRealtimeSession(opts)` (mở kết nối thật,
  cần `WebSocketImpl` truyền vào - không tự import "ws" để phần thuần
  không phụ thuộc mạng). `test/session-ws.test.mjs`: 7/7 test pass (tổng
  25/25 gồm cả Giai đoạn 2+3).

  Checkpoint chạy thật (`scripts/checkpoint-giai-doan-4.mjs` - CHỈ để
  test, tự đẩy audio từ file WAV mẫu vào, khác `session-ws.js` thật
  không tự làm việc này - xem "Ràng buộc kiến trúc"; cũng khác
  `probe-realtime.mjs` của Giai đoạn 1, giữ nguyên không sửa): chạy với
  `samples/1_hoa_don_tien_nuoc_24k.wav` - transcript ra đúng nguyên câu
  "Xin chào, cho tôi hỏi hóa đơn tiền nước tháng này là bao nhiêu?"
  (không bị VAD cắt vụn vì không có khoảng ngừng dài), `response-started`
  ở +7543ms, `response-ended` (status completed) ở +12650ms, không có
  event lỗi nào - luồng hỏi đáp tự do chạy trọn vẹn qua đúng 3 lớp
  turn-signal -> turn-controller -> session-ws. Log:
  `logs/checkpoint4-1_hoa_don_tien_nuoc_24k-<timestamp>.txt`.

  Quyết định thiết kế đã bàn (21/08/2026, chưa sửa code): `turn-controller.js`
  GIỮ NGUYÊN như Giai đoạn 3 - response do server tự tạo (không qua
  `say()`) hiện chưa được track là active (hàng đợi rỗng -> cảnh báo rồi
  bỏ qua có ý, thấy rõ trong log: "hang doi rong"). Chủ động KHÔNG đoán
  trước cách xử lý đúng (huỷ được lúc nào, nội dung đã nói có phù hợp để
  cắt hay không) - để dành làm thí nghiệm thật khi thực sự cần thiết kế
  ngắt lời (dự kiến Giai đoạn 7).

  Bug nhỏ phát hiện + đã sửa: trong `checkpoint-giai-doan-4.mjs`,
  `txtStream.end()` là bất đồng bộ, gọi `process.exit()` ngay sau đó làm
  mất phần tóm tắt cuối chưa kịp flush xuống đĩa (dữ liệu event chính vẫn
  ghi đủ, chỉ mất khối tóm tắt PASS/FAIL) - sửa bằng cách đợi callback của
  `.end()` rồi mới `exit()`. Không ảnh hưởng tới kết quả checkpoint (kết
  luận PASS lấy trực tiếp từ dữ liệu event thô, không cần dòng tóm tắt).

- [ ] **Giai đoạn 5 - Chuyển logic nghiệp vụ có chọn lọc.** Đưa
  `tools.js`, `system-prompt.js`, `api.js`, `log-api.js`,
  `danh-bo-arbiter.js` từ project cũ sang `src/domain/` / `src/
  integrations/` - rà soát: giữ phần nghiệp vụ thật, bỏ phần chỉ tồn tại
  để vá race của kiến trúc cũ (turn-controller đã lo việc đó). Đối chiếu
  với các quyết định đã ghi trong project memory (transcript chỉ để
  debug, gate xác nhận lời nói cho danh bộ trọng tài, SĐT test hardcode)
  để không đánh mất bài học.

  **Sửa 22/08/2026: `db.js` KHÔNG còn được port** - dự án không kết nối
  MariaDB trực tiếp nữa. Bản đang dùng để ghi log cuộc gọi/ticket là
  `log-api.js` (gọi REST tới `voicebot-log-api.php`, cùng khuôn mẫu với
  `api.js`) - đã port thành `src/integrations/calllog-api.js`.

  Đã port (22/08/2026), theo đúng khuôn mẫu: đọc cấu hình từ biến môi
  trường LƯỜI (trong hàm, không phải hằng số tính 1 lần lúc import) để
  test được dễ dàng bằng cách giả lập `globalThis.fetch` (bản cũ vốn đã
  quy ước test theo cách này); bỏ phụ thuộc cứng vào `logger.js`/
  `api-trace.js` cũ (chưa có bản mới), thay bằng hook tuỳ chọn.
  - `src/integrations/tongdai-api.js` (từ `api.js`) - 9 hàm gọi API
    Tổng đài (tra hóa đơn, sản lượng, cúp nước, báo sự cố, chuyển máy...),
    giữ nguyên các fix kỹ thuật thật (Agent undici riêng cho TLS
    self-signed, timeout, unwrap response 2 lớp). 13 test (giả lập
    `fetch`, không gọi API thật).
  - `src/integrations/calllog-api.js` (từ `log-api.js`) - ghi log cuộc
    gọi/ticket qua REST, giữ nguyên tắc BẮT BUỘC "lỗi ghi log không được
    làm sập cuộc gọi" (mọi hàm không bao giờ throw). `getDanhBoHistory`
    (gợi ý danh bộ theo lịch sử SĐT) cũng port ở đây - CHỈ trả dữ liệu
    thô, phần gate xác nhận vẫn thuộc Giai đoạn 6, không tự tin dùng ở
    đây. 15 test.
  - Tổng test: 53/53 pass (`node --test`). Thêm `undici` vào
    dependencies; `.env.example` bổ sung `TONGDAI_API_*` và
    `LOG_API_*`/`VOICEBOT_LOG_FOLDER_ON_API_SERVER`.

  Còn lại của Giai đoạn 5 (chưa làm): `tools.js`/`system-prompt.js`
  phần nghiệp vụ KHÔNG liên quan danh bộ (tra hóa đơn, tra thủ tục,
  chuyển tổng đài, để lại lời nhắn...) sang `src/domain/`, dùng interface
  tạm `resolveDanhBoRef` cho tới khi Giai đoạn 6 thay bằng bản thật có
  gate. `danh-bo-arbiter.js` hoãn toàn bộ sang Giai đoạn 6.

  **Giai đoạn 5b (bổ sung 23/08/2026)** - tên gọi cho đúng phần "còn lại"
  này, đặt song song với 5a cho dễ theo dõi. Quyết định thứ tự (đã bàn
  với chủ dự án): làm domain handlers (billing.js trước, dùng
  `resolveDanhBoRef` tạm "tin thẳng" giá trị model gửi vào tool - KHÔNG
  xác thực gì) TRƯỚC Giai đoạn 6 (thu thập/xác nhận danh bộ), dù về mặt
  sản phẩm phải CÓ danh bộ mới gọi được `get_bill`. Lý do: Giai đoạn 6 là
  phase rủi ro cao nhất (VAD tách số, xác nhận, trọng tài) - tách domain
  layer ra làm trước, kiểm chứng bằng unit test (fetch giả lập) + mã danh
  bộ gài cứng trong checkpoint script (không cần chờ luồng thu thập thật),
  để khi làm Giai đoạn 6 đã có sẵn "nửa sau" ổn định mà thử. `resolveDanhBoRef`
  và `resolveDanhBo` thật (Giai đoạn 6) dùng CHUNG 1 hợp đồng
  (`{ok:true, value}` / `{ok:false, error}`) - khi Giai đoạn 6 xong chỉ
  cần đổi 1 dòng import ở các domain handler, không sửa logic bên trong.
  An toàn vì Giai đoạn 9 chỉ cho thay bản cũ khi TOÀN BỘ roadmap (kể cả
  Giai đoạn 6 có gate) đã pass hết - `resolveDanhBoRef` tạm không bao giờ
  chạm khách hàng thật.

  Nhánh riêng: `giai-doan-5b-domain-handlers` (tách từ
  `giai-doan-5a-tool-call` ngày 23/08/2026, cùng lý do như 5a: dễ theo
  dõi tiến độ và rollback/tái sử dụng riêng nếu cần).

- [x] **Giai đoạn 5a - "Bước 0": quan sát event tool-call thật trước khi
  làm domain layer.** (Bổ sung 22/08/2026, phát hiện qua câu hỏi của
  người dùng khi review roadmap: "domain làm ở Giai đoạn 5 có hợp lý
  không, có cần làm gì trước không?") `turn-signal.js` hiện KHÔNG có
  case nào cho event tool/function-call trong `normalizeTurnEvent` - chỉ
  có speech-started/stopped, buffer-committed, transcript-ready,
  response-started/ended, error. Nghĩa là chưa có gì trong project mới
  phát hiện được "model vừa gọi tool" - chặn cả phần domain của Giai
  đoạn 5 lẫn tool `confirm_danh_bo` của Giai đoạn 6b không thể được gọi
  trong cuộc gọi thật. Hình dạng event tool-call thật của Realtime API
  CHƯA từng được quan sát trong project này (`probe-realtime.mjs` Giai
  đoạn 1 và `checkpoint-giai-doan-4.mjs` Giai đoạn 4 chưa từng cấu hình
  `tools` trong `session.update`) - theo đúng nguyên tắc "quan sát trước
  khi thiết kế" đã dùng cho VAD ở Giai đoạn 1, không đoán theo tài liệu
  chung chung.

  Tool-calling không phụ thuộc audio hay text (tính năng ở tầng
  session/response), nên không cần SIP/Asterisk hay chuẩn bị file âm
  thanh - dùng lại đúng kiểu "text smoke test" có sẵn trong
  `probe-realtime.mjs`.

  Nhánh riêng: `giai-doan-5a-tool-call` (tách từ `giai-doan-5-nghiep-vu`
  theo yêu cầu 22/08/2026, để dễ theo dõi tiến độ và rollback/tái sử
  dụng riêng nếu cần).

  Đã làm (22/08/2026): `scripts/probe-tool-call.mjs` (`npm run
  probe:tool`) - kết nối WebSocket thuần (không qua business logic),
  cấu hình đúng 1 tool thật copy nguyên từ
  `voice_bot/src/system-prompt.js` (`TOOLS[0]`, `get_bill` - không bịa
  tool "đồ chơi"), gửi 1 câu hỏi văn bản chắc chắn kích hoạt tool này,
  rồi đi hết vòng đời thật: model xin gọi tool → script giả lập trả kết
  quả (`function_call_output`) → gọi `response.create` tiếp → model đọc
  câu trả lời. Log cả raw (`.jsonl`) lẫn tóm tắt (`.txt`) ra `logs/`.

  Đã chạy thật (22/08/2026, `OPENAI_API_KEY` thật + mạng) - kết quả xác
  nhận toàn bộ giả thuyết thiết kế:
  - Tool-call KHÔNG phải 1 lifecycle riêng - nó là 1 output item nằm
    TRONG 1 response bình thường (cùng response còn có audio
    "commentary" model tự nói trước khi gọi tool, dù không hề cấu hình
    system prompt yêu cầu việc này - hành vi mặc định của
    `gpt-realtime-2.1-mini`). `response-started`/`response-ended` báo
    đúng như cũ, không cần sửa `turn-controller.js`.
  - Event tốt nhất để chuẩn hoá: `response.function_call_arguments.done`
    - gọn, mang đủ `response_id`/`item_id`/`call_id`/`name`/`arguments`
    (chuỗi JSON đầy đủ) trong 1 event, không cần ráp từ delta hay đọc
    lồng trong `item` như `response.output_item.done`.
  - Vòng đời `function_call_output` giả lập → `response.create` → model
    đọc lại đúng dữ liệu giả - xác nhận format gửi về đúng.

  Đã làm tiếp (22/08/2026): thêm `kind: "tool-call-requested"` vào
  `normalizeTurnEvent` (`src/session/turn-signal.js`), mang
  `{responseId, itemId, callId, name, arguments}` - `arguments` GIỮ
  NGUYÊN chuỗi JSON thô (không `JSON.parse` ở đây, quyết định 22/08/2026
  để còn debug được khi model sinh JSON hỏng - bên gọi tự parse). Fixture
  `test/fixtures/tool-call-events.jsonl` copy nguyên dữ liệu thật từ lần
  chạy trên. 54/54 test pass.

  Đã làm tiếp (22/08/2026): `src/call-flow/dispatch-tool-call.js` -
  dispatcher nhận tín hiệu `tool-call-requested`, tra `handlers[name]`,
  `JSON.parse` `arguments` (bắt lỗi JSON hỏng), gọi handler, luôn trả về
  `{success:true, ...}` hoặc `{success:false, error_code, message}` -
  không bao giờ throw ra ngoài, giữ đúng nguyên tắc "lỗi không được làm
  sập cuộc gọi" như `tongdai-api.js`/`calllog-api.js`. Thêm 8 test (62/62
  tổng). Mở rộng `connectRealtimeSession` (`src/session/session-ws.js`)
  nhận thêm `tools`/`toolChoice` tùy chọn, chỉ thêm vào `session.update`
  khi thực sự truyền vào - không đổi hành vi Giai đoạn 4 khi không dùng.

  Đã phát hiện (22/08/2026, từ dữ liệu thật ở `probe-tool-call.mjs`):
  `response.function_call_arguments.done` (nguồn tín hiệu
  `tool-call-requested`) đến TRƯỚC `response.done` (nguồn
  `response-ended`) trong CÙNG 1 response. `dispatch-tool-call.js` gọi
  `turnController.say()` ngay sau khi xử lý xong tool-call - nghĩa là
  `say()` có thể được gọi trong lúc `turn-controller.js` còn coi response
  đó là "active" (`response-ended` chưa tới), có nguy cơ khiến
  `turn-controller.js` gửi thêm 1 `response.cancel` cho 1 response đang
  tự hoàn tất bình thường (không cần huỷ). CHỦ ĐÍCH KHÔNG sửa trước - để
  `scripts/checkpoint-giai-doan-5a.mjs` (chạy THẬT `session-ws.js` +
  `dispatch-tool-call.js` cùng nhau qua 1 kết nối WebSocket thật,
  `get_bill` là handler GIẢ LẬP, CHƯA nối `tongdai-api.js` thật - có ý,
  xem comment đầu file) tự quan sát hiện tượng này trước, đúng nguyên
  tắc "quan sát trước khi thiết kế".

  [fix 22/08/2026] Trong lúc viết `checkpoint-giai-doan-5a.mjs`, phát
  hiện `GET_BILL_TOOL.description`, `USER_TEXT` (và `TRANSCRIBE_PROMPT`
  kế thừa nguyên từ `probe-realtime.mjs` Giai đoạn 1) đang dùng tiếng
  Việt KHÔNG dấu - không có lý do kỹ thuật, chỉ là mang nhầm thói quen
  viết comment (luôn không dấu trong project này) sang các trường DỮ
  LIỆU thực sự được gửi qua API cho model đọc (khác comment - không ai
  đọc, chỉ model đọc). Tiếng Việt không dấu làm mờ nghĩa hơn với model
  (`GET_BILL_TOOL.description` ảnh hưởng lúc model quyết định gọi tool),
  không mô phỏng đúng STT thật vốn luôn trả về có dấu (`USER_TEXT`), và
  tệ nhất là tự làm giảm hiệu quả của chính nó (`TRANSCRIBE_PROMPT` vốn
  dùng để mồi model transcribe đúng chính tả). Đã sửa cả 3 sang có dấu
  đầy đủ, khớp văn phong `voice_bot/src/system-prompt.js` (bản
  production thật). `scripts/probe-tool-call.mjs` GIỮ NGUYÊN không sửa -
  file đó đã quan sát xong, log/fixture thật
  (`test/fixtures/tool-call-events.jsonl`) đã lấy từ đúng lần chạy đó,
  sửa lại sẽ làm code và log cũ không còn khớp nhau. Nhân đây quyết định
  luôn: từ giờ nội dung tài liệu (`docs/*.md`) viết tiếng Việt CÓ dấu
  cho dễ đọc - RIÊNG comment trong code vẫn giữ quy ước không dấu như cũ
  (không ảnh hưởng API, đã dùng xuyên suốt project).

  Đã chạy thật lần 1 (22/08/2026, `logs/checkpoint5a-1787392228657.txt`)
  - xác nhận ĐÚNG nghi ngờ: `dispatch-tool-call.js` gọi `say()` ngay khiến
  `turn-controller.js` gửi 1 `response.cancel` thừa cho response đang tự
  hoàn tất, bị OpenAI từ chối (`error: response_cancel_not_active`).
  KHÔNG phá hỏng cuộc gọi (response vẫn `completed` bình thường, dữ liệu
  không mất) nhưng là nhiễu/lãng phí 1 vòng gọi API mỗi lần có tool-call -
  xem trực quan bằng `npm run diagram --
  logs/checkpoint5a-1787392228657.txt`.

  Đã sửa (22/08/2026): `dispatch-tool-call.js` không còn gọi `say()` ngay
  sau `function_call_output` nữa - gửi kết quả ngay (giữ lợi thế tốc độ,
  tool có thể chạy trong lúc model còn đang nói câu "để tôi xem thử..."),
  nhưng CHỈ gọi `say()` sau khi thấy đúng tín hiệu `response-ended` của
  CHÍNH response chứa tool-call đó - `handleSignal()` giờ nhận mọi tín
  hiệu (không riêng `tool-call-requested`), giữ 1 `Set` các responseId
  đang "nợ" 1 lần `say()`. 10 test (2 test mới: response-ended của
  response khác không bị "ăn nhầm"; thiếu responseId thì `say()` ngay -
  phòng thủ, chưa gặp với dữ liệu thật).

  Chạy thật lần 2 (`logs/checkpoint5a-1787470375067.txt`) hết hẳn
  `response.cancel`/`error`, nhưng lộ ra 1 lỗi TÍCH HỢP khác: cuộc gọi bị
  treo tới TIMEOUT 20s, vì `checkpoint-giai-doan-5a.mjs` trước đó chỉ
  chuyển tín hiệu `tool-call-requested` cho dispatcher - `response-ended`
  không bao giờ tới nơi, nên `say()` không bao giờ được gọi. Sửa: chuyển
  MỌI tín hiệu cho `dispatcher.handleSignal()` (tự bỏ qua kind/responseId
  không liên quan, đã có test riêng).

  Chạy thật lần 3 (`logs/checkpoint5a-1787470917606.txt`) - **PASS**: gửi
  `function_call_output` ngay ở +2837ms, `response-ended` tới ở +2839ms,
  `-> response.create` (say() hoãn) chỉ xuất hiện NGAY SAU dòng đó, không
  còn `response.cancel`/`error` nào, 2/2 response hoàn tất, model đọc
  đúng kết quả giả lập. Xem trực quan bằng
  `logs/checkpoint5a-1787470917606.sequence.html`.

  Đã chạy thật thêm qua đường AUDIO+VAD thật (23/08/2026,
  `scripts/checkpoint-giai-doan-5a-audio.mjs`, tái dùng cách stream WAV
  của Giai đoạn 4) - trả lời câu hỏi còn treo từ Giai đoạn 4: cảnh báo
  "hàng đợi rỗng" (response do server tự tạo qua `semantic_vad`, không
  qua `say()`, chưa từng được `turn-controller.js` track là active) CÓ
  xảy ra thật khi có tool-call, nhưng KHÔNG ảnh hưởng gì tới fix `say()`
  hoãn - vì `dispatch-tool-call.js` theo dõi độc lập bằng `responseId`
  thô, không phụ thuộc `turn-controller.js` có track hay không. Log:
  `logs/checkpoint5a-audio-5a_hoi_tien_nuoc_22082351775_24k-*.txt`.

  Hiện tượng phụ quan sát được (không phải bug): response 1 (commentary
  trước tool-call) đôi khi bị OpenAI tự huỷ (`status:"cancelled"`) - do
  `semantic_vad`+`interrupt_response` phát hiện khách nói tiếp giữa chừng
  (file mẫu có khoảng ngừng giữa 2 câu). Xác nhận KHÔNG phải do code tự
  gửi `response.cancel` (không có dòng `-> response.cancel` nào trong
  log ở thời điểm đó) - hành vi hoàn toàn phía server, không cần sửa gì.

  Bổ sung quan sát (23/08/2026, theo yêu cầu chủ dự án): log/diagram
  trước đó thiếu 3 điều khi debug - lời AI nói, input/output khi gọi
  tool, và input của chính `say()`. Đã bổ sung:
  - `turn-signal.js`: thêm `kind:"ai-said"` (từ
    `response.output_audio_transcript.done`, dùng field `transcript` -
    xác nhận bằng dữ liệu thật trong
    `logs/probe-tool-call-1787384731754.jsonl`, không đoán). Tiện thể sửa
    1 bug có sẵn ở `log-to-sequence.js`: `summarizeSignal()` đọc nhầm
    `signal.transcript` thay vì `signal.text` cho tín hiệu
    `transcript-ready`, khiến diagram từ trước tới giờ luôn in ra
    "undefined" thay vì lời khách nói thật.
  - `dispatch-tool-call.js`: thêm 3 dòng log tách biệt quanh 1 lần gọi
    tool (mỗi dòng bắt 1 loại lỗi khác nhau nếu có) - input nhận được
    (trước khi gọi handler), output handler trả về, và payload THẬT gửi
    lên OpenAI (khác output ở chỗ đã "bọc" call_id +
    `JSON.stringify(output)` - lỗi bọc sai sẽ thấy ở đây mà không thấy ở
    dòng output).
  - `turn-controller.js`: thêm log input (`opts`) ngay dòng đầu `say()` -
    đặt ở ĐÂY (không phải ở từng nơi gọi) vì đây là cửa DUY NHẤT được
    phép gửi `response.create` - mọi nơi gọi say() (dispatch-tool-call.js,
    checkpoint script, sau này call-flow/*) tự động được log, không cần
    nhớ thêm ở từng chỗ gọi. Log đặt TRƯỚC bước validate nên vẫn thấy
    được input ngay cả khi say() sau đó ném lỗi.
  - 2 checkpoint script (`giai-doan-5a.mjs`/`-audio.mjs`): nâng điều kiện
    PASS từ "2 response kết thúc" lên "3 response kết thúc"
    (`RESPONSES_ENDED_FOR_PASS`) - để tự xác nhận `say()` hoãn không chỉ
    ĐƯỢC GỌI (đã thấy dòng `-> response.create`) mà còn THỰC SỰ HOÀN TẤT
    1 response mới (`response.done`), không cần chờ tới khi nối SIP thật
    mới biết được điều này.
  - Tổng test: 80/80 pass (`node --test`, từ 74 lên 80 qua 3 lần bổ sung
    trên).

  Giai đoạn 5a coi như đóng hẳn - vòng nối dây tool-calling đã kiểm
  chứng qua CẢ text lẫn audio+VAD thật, quan sát được đầy đủ input/output
  ở mọi điểm nối (turn-signal → dispatch-tool-call → turn-controller →
  OpenAI). Còn cần làm: quay lại viết domain handlers còn lại của Giai
  đoạn 5 (`billing.js`/`outages.js`/`tickets.js`/`call-control.js`/
  `procedures.js`/`tool-router.js`, dùng `resolveDanhBoRef` tạm).

- [x] **Giai đoạn 5b - Domain handlers còn lại + tool-router.js.** (Đóng
  23/08/2026, nhánh `giai-doan-5b-domain-handlers`.) Port đủ 5 file domain
  còn lại của Giai đoạn 5 + nối dây thành 1 `handlers` map dùng chung.

  - `src/domain/resolve-danh-bo-ref.js` - stub tạm TIN THẲNG giá trị model
    gửi (không xác thực/gate), CÙNG hợp đồng `{ok:true,value}`/
    `{ok:false,error}` với `resolveDanhBo` thật (Giai đoạn 6) - khác 1 điểm
    so với kế hoạch ban đầu: `error` là OBJECT (không phải chuỗi JSON đã
    stringify như bản cũ) để khớp quy ước chung của kiến trúc mới (domain
    handler trả object thường, `dispatch-tool-call.js` là nơi DUY NHẤT gọi
    `JSON.stringify()`).
  - `src/domain/billing.js` (từ `fetchBilling`/`handleGetBill`/
    `handleCompareUsage` + `docTienVN`/`fmtNgay`/`simplifyRow`/
    `prevPeriod`) - giữ nguyên quirk backend thật (không truyền ky/nam mà
    *_NOT_FOUND → tự lùi 1 kỳ, gọi lại đúng 1 lần). **Gọi thật tới API Tổng
    đài CNTA qua tunnel (mã danh bộ `22023251775`, chủ dự án tự chạy lệnh)
    phát hiện 1 lỗi thật**: `NgayThanhToan` API trả `"DD/MM/YYYY HH:MM:SS"`,
    không phải ISO `"YYYY-MM-DD..."` như comment/giả định kế thừa từ bản cũ
    - `fmtNgay` sửa lại nhận cả 2 định dạng, có test dùng đúng dữ liệu thật
      làm fixture.
  - `src/domain/outages.js` (`handleGetOutages`) - xác nhận qua
    `getThongBaoCupNuoc` thật, không lệch gì với giả định.
  - `src/domain/tickets.js` (`handleCreateTicket`) - xác nhận qua `baoSuCo`
    thật (chủ dự án tự tạo 1 phiếu test thật, nội dung đánh dấu rõ
    "[TEST KY THUAT]" để phân biệt sự cố thật) - không lệch, `data` API trả
    về là mảng (khác billing.js) nhưng handler không đụng vào cấu trúc bên
    trong nên không ảnh hưởng.
  - `src/domain/call-control.js` (`handleTransferToAgent`/
    `handleLeaveCallbackMessage`/`handleEndCall`/`handleWaitForUser`) -
    xác nhận `getAvailableAgents` thật, không lệch. **Tự phát hiện qua lúc
    viết test** (không phải từ ban cũ): `Promise.race` chờ timeout không
    tự huỷ nhánh THUA - mỗi lần gọi `transfer_to_agent` để lại 1 timer
    "treo" ~4.5s vô ích, đã sửa bằng `clearTimeout` trong `finally`.
  - `src/domain/procedures.js` + `procedures-data.js` (từ
    `normalizeProcedureArgs`/`handleGetProcedureInfo`/
    `handleCheckMissingDocs`/`toSpoken`/`docMatches` + dữ liệu 4 thủ tục) -
    file domain LỚN NHẤT, giữ nguyên toàn bộ các tầng heuristic chuẩn hoá
    tham số (mỗi tầng từng sửa 1 lỗi thật của model, có ghi ngày tháng cụ
    thể trong code cũ) và gate xác nhận đối tượng theo `callState`
    (`daHoiDoiTuong`) - không gọi API mạng nên không cần xác nhận dữ liệu
    thật, chỉ unit test trên chính dữ liệu `PROCEDURES` thật.
  - `src/domain/tool-router.js` - gộp cả 5 module trên thành 1
    `handlers` map đúng 10 tên tool (xác nhận từ `system-prompt.js#TOOLS`,
    không đoán). **Giải quyết 1 trong 2 khoảng cách kiến trúc đã ghi nhận
    khi viết từng file domain**: `callState` được closure theo TỪNG CUỘC
    GỌI (`createToolRouter({..., callState})`, giống cách
    `createTurnController(ws)` đã làm) - mọi hàm trong `handlers` chỉ còn
    đúng 1 tham số `(args) => output`, khớp đúng ý `dispatch-tool-call.js`
    đang cần, KHÔNG phải sửa gì ở Giai đoạn 5a. Có test xác nhận trực tiếp
    `callState` (gate `daHoiDoiTuong` của procedures.js) được giữ xuyên
    suốt qua NHIỀU lần gọi tool khác nhau trong cùng 1 router.

  Tổng test: 169/169 pass (`node --test`, từ 118 lên 169 qua Giai đoạn 5b).

  **Khoảng cách kiến trúc đã ghi nhận ở đây - ĐÃ SỬA (bổ sung 23/08/2026).**
  `dispatch-tool-call.js` (`waitingForResponseEnded` đổi từ `Set` sang `Map`
  để nhớ lại được cả output của tool, không chỉ responseId) nay đọc output
  tool để quyết định cách gọi `say()`: có `action:"no_reply"` (hiện tại chỉ
  `wait_for_user` trả) → KHÔNG gọi `say()`, để model thật sự im lặng; có
  `doc_cho_khach` (call-control.js/procedures.js) → `say({mode:"verbatim",
  text: doc_cho_khach})` thay vì mode "auto", tránh model tự tóm tắt/diễn
  đạt lại làm rơi chi tiết bắt buộc. Không có cả 2 field → giữ hành vi cũ.
  5 test mới, tổng 174/174 pass. Còn lại CHƯA xử lý, cố ý để nguyên:
  `action:"end_call"`/`"transfer_to_agent"` - cần gọi API thật để cúp/
  chuyển máy (SIP thật), chờ Giai đoạn 8.

- [x] **Checkpoint end-to-end Giai đoạn 5b (đóng 23/08/2026).** Nối
  `tool-router.js` (với 5 hàm THẬT của `tongdai-api.js` tiêm vào, không
  còn hàm giả lập) vào 1 cuộc gọi Realtime thật, qua `dispatch-tool-call.js`
  + `session/turn-controller.js` - lần đầu tiên toàn bộ dây chuyền domain
  handler chạy trong 1 cuộc gọi thật, không chỉ unit test với fake. 3 file
  mới: `scripts/gen-sample-5b.mjs` (tạo mẫu audio bằng TTS thật, đọc mã
  danh bộ `22023251775` tách từng chữ số), `scripts/checkpoint-giai-doan-
  5b.mjs` (bản text) và `-audio.mjs` (bản audio) - cả 2 dùng `GET_BILL_TOOL`
  nguyên văn từ `system-prompt.js`, có "spy" quanh `get_bill`/`turnController.say`
  để đối chiếu ĐÚNG dữ liệu thật + đúng nhánh `say()`, không chỉ xác nhận
  giao thức chạy trọn như checkpoint 5a.

  **Phát hiện + sửa 1 lỗi thật ở `dispatch-tool-call.js` (fix 23/08/2026 #2)**,
  chỉ lộ ra khi dùng API thật (độ trễ mạng thật, không phải hàm giả lập gần
  tức thời): `waitingForResponseEnded` (fix #1) ghi `responseId -> output`
  SAU khi `await handler()` xong - nhưng dữ liệu thật cho thấy
  `response.done` của OpenAI về gần như ngay sau khi model phát xong lệnh
  gọi hàm (~6ms), KHÔNG đợi tool chạy xong (2483ms với API thật) - `response-
  ended` đến và bị bỏ qua (map còn rỗng) TRƯỚC khi entry được tạo, `say()`
  không bao giờ được gọi, cuộc gọi treo tới timeout. Sửa: tách trạng thái
  theo `responseId` thành `{ended, hasOutput, output}`, đăng ký entry NGAY
  (trước `await`) - `say()` luôn chạy đúng 1 lần bất kể `response-ended`
  tới trước hay sau khi tool xong. 2 test mới dùng Promise treo (resolve
  bằng tay) mô phỏng đúng thứ tự thật, tổng 176/176 pass.

  Cũng phát hiện tiêu chí PASS của chính checkpoint (kế thừa từ bản 5a) sai:
  `RESPONSES_ENDED_FOR_PASS=3` nhưng dữ liệu thật cho thấy 1 vòng tool-call
  bình thường chỉ có ĐÚNG 2 response (response 1: hỏi + gọi tool, kết thúc
  ngay không đợi tool; response 2: `say()` tạo ra để đọc kết quả) - không
  có response thứ 3 nào. Sửa về 2 (lỗi ở tiêu chí checkpoint, không phải lỗi
  code).

  **Kết quả cuối**: bản text **PASS** hoàn toàn - dữ liệu hoá đơn là dữ
  liệu THẬT (mã danh bộ `22023251775`: kỳ 8/2026, 428.413đ, đã thanh toán
  22/08/2026), `say()` đúng nhánh mode "auto". Bản audio: vòng đời tool-call
  + `say()` đúng (2/2 response kết thúc, `say()` đúng mode auto) nhưng vẫn
  báo `CUSTOMER_NOT_FOUND` - KHÔNG phải lỗi code: STT phiên đúng "2202 325
  1775" (khớp `22023251775`), nhưng model khi điền `ma_danh_bo` đánh rơi 1
  chữ số, ghi thành `"2203251775"` (10 số). Đây là vấn đề thu thập/xác nhận
  danh bộ qua giọng nói, để lại CHO Giai đoạn 6a/6b xử lý, không sửa ở đây.

- [x] **Giai đoạn 6a - Phương án A: code/VAD gom transcript (danh bộ).**
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

  **Đóng 24/08/2026.** Đúng thiết kế ở trên, cộng thêm những gì chỉ lộ ra
  khi chạy thật (bằng chứng, không đoán):

  - `scripts/probe-danh-bo-vad.mjs` (thí nghiệm thật trước khi viết state
    machine) xác nhận 3 điều: `create_response:false` ở VAD mode "digits"
    hoạt động đúng (0/3 lần có `response.created` tự sinh, kể cả khi phát
    audio ngay không đợi xác nhận); VAD vẫn tách 1 lượt đọc thành nhiều
    mảnh `transcript-ready` (2/3 file test bị tách 2 mảnh) - bắt buộc CODE
    tự gom, không được coi "1 lần gom = 1 câu trả lời đầy đủ"; có "cửa sổ
    hở" ~200-250ms giữa lúc gọi `setVadMode("digits")` và lúc
    `session-updated` xác nhận server đã áp dụng xong (đo được cả 3/3 lần
    chạy) - đúng lớp bug bản cũ từng gặp (dot 15, 04/08/2026: model trả
    lời SAI đúng trong cửa sổ đó, bị hiểu nhầm là khách phủ định, khoá
    chết vĩnh viễn 1 mã danh bộ ĐÚNG) mà bản cũ chưa từng sửa tận gốc.
  - `src/call-flow/danh-bo-flow.js` - state machine DUY NHẤT điều phối:
    5 phase (`idle -> arming -> asking -> confirming -> done | failed`).
    Phase "arming" (MỚI, bản cũ KHÔNG có) chặn TẬN GỐC "cửa sổ hở" trên -
    bỏ qua CÓ Ý mọi tín hiệu (kể cả `transcript-ready`) cho tới khi thấy
    `session-updated`. Nối lại các mảnh đã viết/test riêng:
    `session-ws.js#setVadMode` (đổi VAD sang "digits"/"normal"),
    `turn-controller.js#say` (không viết lại `_speakVerbatim` của bản cũ -
    cơ chế generation/queue của Giai đoạn 3 đã lo hết race), `danh-bo-
    collect.js` (gom/chuẩn hoá chữ số qua nhiều `transcript-ready`), `danh-
    bo-confirm.js` (phân loại đúng/sai/xin đọc lại/đọc số mới/không rõ
    ràng). QUYẾT ĐỊNH CỐ Ý (dẫn chứng, không đoán): KHÔNG mở khoá
    `create_response` cho bước xác nhận như "unlocked"/"confirm_tool" bản
    cũ từng thử - "unlocked" từng làm SẬP 1 cuộc gọi thật trên đúng model
    đang dùng (model tự gọi tool với số bịa khi mới nghe 4/11 số, xem
    `fix_migrate_gpt_realtime_21_20260730.md`); CODE luôn chủ động gọi
    `say()` ở cả 2 bước asking và confirming, không thử nghiệm lại 2
    phương án đó.
  - `src/domain/resolve-danh-bo-ref.js` - bản THẬT thay stub tạm của Giai
    đoạn 5b, giữ nguyên hợp đồng `{ok:true,value}`/`{ok:false,error}` nên
    `billing.js`/`outages.js`/`tickets.js` không phải sửa gì. Quyết định cốt
    lõi: `rawArg` (giá trị model tự điền vào tham số tool) BỊ BỎ QUA HOÀN
    TOÀN - CHỈ tin `callState.danhBo` (do `danh-bo-flow.js` ghi vào SAU KHI
    khách xác nhận bằng lời thật). Dẫn chứng buộc phải làm vậy: checkpoint
    Giai đoạn 5b (audio, 23/08/2026) cho thấy model nghe ĐÚNG "2202 325
    1775" nhưng tự viết lại thành "2203251775" (rớt 1 số) rồi TỰ TIN gọi
    thẳng `get_bill`; cộng bằng chứng cũ (`fix_migrate_gpt_realtime_21_
    20260730.md`, đợt "unlocked") model từng tự gọi tool với số bịa khi
    mới nghe 4/11 số - không có lý do gì để tin `rawArg`.
  - `src/call-flow/dispatch-tool-call.js` - nối `DANH_BO_MISSING` (do
    `resolve-danh-bo-ref.js` trả ra khi `callState.danhBo` chưa có) vào
    `danhBoFlow.start()`, CODE chủ động chiếm lượt nói thay vì để model tự
    xử lý. Thêm `handleDanhBoFlowDone(result)`: khi `danhBoFlow` xong
    thành công, CODE (không phải model) tự gọi LẠI đúng tool + rawArgs GỐC
    đã tạo ra `DANH_BO_MISSING` ban đầu (nhớ trong `pendingDanhBoRetry`),
    nói 1 câu "preamble" ngắn trong lúc chờ (độ trễ mạng thật đã đo
    ~2483ms), rồi đọc verbatim đúng `output.message` của kết quả thật -
    không để model tự diễn đạt lại (rủi ro đọc sai số tiền/ngày tháng đã
    được `docTienVN()`/`fmtNgay()` định dạng riêng cho TTS). Khi
    `danhBoFlow` bỏ cuộc: `giveUp()` (trong `danh-bo-flow.js`) tự nói 1 câu
    xin lỗi + đề nghị chuyển máy, đúng nguyên tắc "Tool Failures" của
    skill `realtime-voice-prompting` - quyết định này đến từ 1 buổi đóng
    vai (CSKH + khách hàng) bàn kỹ trước khi viết code, không đoán.
  - `scripts/gen-sample-6a.mjs` + `scripts/checkpoint-giai-doan-6a.mjs` -
    checkpoint đầu-cuối THẬT (Realtime API thật + audio TTS thật, 3 file
    mẫu: mở đầu không đọc danh bộ, đọc 11 chữ số `22023251775`, xác nhận
    "đúng rồi") - lần đầu tiên toàn bộ dây chuyền Giai đoạn 6a (`danh-bo-
    flow.js`/`danh-bo-collect.js`/`danh-bo-confirm.js`/`resolve-danh-bo-
    ref.js`/`dispatch-tool-call.js#handleDanhBoFlowDone`) chạy trong 1
    cuộc gọi thật, không chỉ unit test với fake.

  **2 bug thật phát hiện qua checkpoint chạy thật (24/08/2026), cả 2 đã
  sửa và xác nhận lại bằng chính checkpoint đó:**

  1. *VAD-switch race*: `onDone` của `danhBoFlow` gọi `setVadMode("normal")`
     TRƯỚC khi `handleDanhBoFlowDone()` (bất đồng bộ, chờ kết quả thật từ
     `tongdai-api.js`) hoàn tất - tạo khoảng hở để VAD tự kích response của
     CHÍNH model trong lúc code còn đang xử lý, sinh ra 1 lần gọi `get_bill`
     thứ 3 với mã danh bộ BỊA (`"222217775"`, không khớp số thật). Sửa:
     `await handleDanhBoFlowDone()` xong rồi mới `setVadMode("normal")`.
  2. *Model tự gọi tool khi nghe preamble*: câu preamble ("...sẽ tra cứu
     ngay giúp khách...", mode "guided") không hề chặn `tool_choice` - vì
     `get_bill` vẫn khai báo suốt session, model tự hiểu câu đó thành chỉ
     thị hành động và TỰ BỊA 1 lần gọi `get_bill` khác (mã danh bộ bịa dạng
     `"2,2,2,5,1,1,7,7,5,2"`), chạy đua với lần gọi trực tiếp của code. Sửa:
     `turn-controller.js#buildResponsePayload` cho phép MỌI mode (không chỉ
     `"tool"`) được kèm `toolChoice` tuỳ chọn; `handleDanhBoFlowDone()` thêm
     `toolChoice:"none"` vào cả 4 lượt `say()` của nó - không lượt nói nào
     trong hàm đó còn được phép để model tự gọi thêm tool nào nữa.

  **Kết quả cuối**: `checkpoint-giai-doan-6a.mjs` **PASS** 2 lần chạy thật
  liên tiếp (Realtime API thật + audio TTS thật) - đúng 2 lần `get_bill`
  (không còn lần 3 hallucinate), `callState.danhBo` khớp đúng
  `22023251775`, tra cứu lại đúng dữ liệu thật (kỳ 8/2026, 428.413đ, đã
  thanh toán 22/08/2026). 1 lần chạy trung gian (trước khi sửa xong cả 2
  bug) từng bị STT nghe nhầm vài chữ số của chính audio mẫu - không phải
  bug code, chỉ là nhiễu STT/TTS ngẫu nhiên giữa các lần chạy (không phải
  vấn đề của Giai đoạn 6a - Giai đoạn 6b sẽ xử lý bài toán đối chiếu
  transcript rộng hơn).

  Tổng test hiện tại (24/08/2026, sau khi lấp xong cả 4 việc hardening ưu
  tiên bên dưới): 237/237 (local, `node --test`), 252/252 (trên máy chủ dự
  án - lệch 15 do có thêm `test/calllog-api.test.mjs` không có ở bản upload
  cục bộ, đã biết là chênh lệch vô hại).

  **Cập nhật 24/08/2026 - đóng cả 4 việc hardening ưu tiên (quyết định "làm
  tiếp 6a trước khi qua 6b")**: (1) đọc ngập ngừng qua audio thật - PASS,
  lộ + sửa 1 bug cùng loại `tool_choice` ở chính `danh-bo-flow.js`; (2) tạp
  âm lúc đọc số qua audio thật (`noise1`/`noise3`) - PASS cả nhánh tra cứu
  thành công lẫn nhánh lỗi hệ thống, sau khi phát hiện + sửa 1 lỗi đặt tên
  file mẫu nhầm số danh bộ; (3) xác nhận SAI rồi đọc lại qua audio thật
  (`checkpoint-giai-doan-6a-xac-nhan-sai.mjs`, script mới) - PASS, khách
  báo sai đúng 1 lần, bot tự hỏi lại/đọc lại đúng 1 lần rồi hoàn tất; (4) vá
  khoảng trống thiết kế "xác nhận đúng danh bộ nhưng tra cứu lại vẫn thất
  bại" (`dispatch-tool-call.js#handleDanhBoFlowDone`) - lỗi hệ thống thì
  xin lỗi + chuyển máy ngay, lỗi dữ liệu thì tự mời đọc lại tối đa 2 lần,
  đã có bằng chứng thật qua checkpoint cho cả 2 nhánh. Chi tiết đầy đủ (log
  thật, bảng kết quả từng lần chạy) xem
  `docs/fix/giai_doan_6a_audit_kich_ban_da_test_20260824.md`.

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
     dùng THỨ TỰ ITEM để khớp ĐÚNG CẶP, không chỉ lấy "N event gần nhất"
     (tránh khớp nhầm do độ trễ bất đồng bộ đã ghi nhận ở Giai đoạn 1 -
     transcript có thể đến sau `response.created`).
     **Đính chính 24/08/2026** (xem `docs/fix/giai_doan_6b_dinh_chinh_
     pairing_previous_item_id_20260824.md`): câu trên VIẾT SAI khi đề xuất
     ngày 21/08/2026 - đã ĐOÁN là dùng được field `previous_item_id`, CHƯA
     chạy thật để kiểm chứng. Chạy thật `scripts/probe-confirm-danh-bo.mjs`
     (API thật) cho thấy `previous_item_id` KHÔNG TỒN TẠI trên
     `conversation.item.input_audio_transcription.completed`, và trên
     `item` của `conversation.item.added`/`.done` chỉ có `item.id`, không
     có `previous_item_id`. Cơ chế ĐÚNG (đã xác nhận bằng mốc thời gian
     thật trong log .jsonl của probe): `conversation.item.added`
     (`role:"user"`) của khách LUÔN đến SAU `conversation.item.done`
     (`role:"assistant"`) của lượt AI đọc lại, không xen kẽ - nên khớp
     cặp bằng THỨ TỰ đến (item khách gần nhất sau lượt AI đọc lại), rồi
     đối chiếu chéo `item.id` đó với `item_id` của
     `conversation.item.input_audio_transcription.completed` khi transcript
     sẵn sàng. `src/session/turn-signal.js` đã chuẩn hoá
     `conversation.item.added` (`role:"user"`) thành tín hiệu
     `"user-item-added"` (giữ `itemId`) để phục vụ đúng cơ chế này.
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

  **Cập nhật 24/08/2026 - bắt đầu triển khai (nhánh
  `giai-doan-6b-model-collection`)**: rà soát lại thiết kế trên trước khi
  viết code (theo đúng nguyên tắc "hiểu và kiểm soát trước") - phát hiện
  bước 1 dựa vào `previous_item_id`, một field CHƯA từng được kiểm chứng
  thật. Chạy `scripts/probe-confirm-danh-bo.mjs` (probe thật, không đoán)
  xác nhận field đó không tồn tại trên các event liên quan, tìm ra cơ chế
  đúng (khớp cặp theo THỨ TỰ item) - xem đính chính ở bước 1 trên và
  `docs/fix/giai_doan_6b_dinh_chinh_pairing_previous_item_id_20260824.md`.
  Đã chuẩn hoá nền tảng cho cơ chế này: `src/session/turn-signal.js` thêm
  tín hiệu `"user-item-added"` (từ `conversation.item.added`,
  `role:"user"`). Test: 238/238 (local), 253/253 (máy chủ dự án).

  **Cập nhật 25/08/2026 - viết matcher thuần (bước 1-4)**: thêm
  `src/call-flow/danh-bo-readback-match.js` gồm 2 hàm THUẦN, test bằng
  fixture riêng lẻ (đúng thứ tự đã ghi ở trên, CHƯA tích hợp qua harness):
  (1) `createReadbackMatcher()` - khớp cặp "AI vừa đọc lại" với "khách trả
  lời ngay sau đó" theo THỨ TỰ item (tín hiệu `"user-item-added"` +
  `"transcript-ready"`, đúng cơ chế đã đính chính ở trên), vòng đời 1 phiên/
  1 lần đọc lại (giống `createDanhBoSession()` của Giai đoạn 6a); (2)
  `resolveConfirmDanhBo({toolValue, aiReadbackText})` - trích số từ CHÍNH
  câu AI đọc lại (dùng lại `normalizeDanhBo()`/`viDigitsFromWords()` đã có
  sẵn ở `danh-bo-collect.js`, không viết hàm trích số riêng) rồi so sánh với
  giá trị tool `confirm_danh_bo` gửi lên - trả về `"match"`/`"override"`/
  `"unclear"` (bước 3/4/6 một phần). CHƯA làm (cần thảo luận thiết kế thêm,
  xem chú thích đầu file `danh-bo-readback-match.js`): khi nào gọi `arm()`
  (lớp tích hợp - tool-handler cho `confirm_danh_bo`, chưa viết), định
  nghĩa tool + system prompt, bước 5 (cache vào `callState`), bước 6 (nhánh
  "không kết luận được" đầy đủ - phụ thuộc watchdog Giai đoạn 7), bước 2.5
  (trọng tài gpt-5.1). Test: 251/251 (local), 266/266 (máy chủ dự án).

  **Cập nhật 25/08/2026 - đã trả lời câu hỏi "khách trả lời NGẮT QUÃNG"
  (chủ dự án hỏi trực tiếp, đã kiểm chứng bằng audio THẬT tự ghi âm)**:
  xem `docs/fix/giai_doan_6b_dinh_chinh_pairing_previous_item_id_20260824.md`
  mục "Cập nhật 25/08/2026" để biết đầy đủ bằng chứng. Tóm tắt: `previous_
  item_id` trên `input_audio_buffer.committed` (KHÁC event với cái đã đính
  chính ở bước 1 trên, KHÔNG mâu thuẫn - đây là việc nối các mảnh CỦA CÙNG
  1 lượt nói, khác việc ghép cặp KHÁC VAI) THẬT SỰ dùng được, xác nhận
  bằng 2 file khách tự ghi âm có khoảng ngừng rõ (4 mảnh và 2 mảnh, previous_
  item_id nối đúng 100% cả 2 lần). Lộ ra `createReadbackMatcher()` (viết
  24/08/2026) SAI - chỉ lấy mảnh đầu, bỏ sót phần "đúng"/"sai" nếu nó nằm ở
  mảnh sau. ĐÃ SỬA: gom TOÀN BỘ mảnh tới khi thấy tín hiệu `"response-
  started"` (điểm dừng - CHƯA được probe xác nhận trực tiếp, chỉ là giả
  định hợp lý, ghi rõ trong code). Test cập nhật dùng đúng dữ liệu thật 3
  lần chạy, 251/251 (local, không đổi số lượng test).

  **Cập nhật 25/08/2026 #2 - thảo luận hướng đi phần còn lại + bắt đầu viết
  tool schema/system-prompt nháp.** Bàn với chủ dự án (đối chiếu sâu với
  `voice_bot/docs/fix/fix_migrate_gpt_realtime_21_20260730.md`, đầy đủ, không
  chỉ đoạn đã đọc trước đó) trước khi viết: Phương án B **không** giống bản
  `day_so` đã bỏ của dự án cũ như lo ngại ban đầu - bước 3/4 của thiết kế
  KHÔNG BAO GIỜ dùng thẳng `toolValue`, luôn đối chiếu/ghi đè bằng số trích
  từ chính câu AI đọc lại; bước 2.5 (trọng tài) là lớp bản cũ chưa từng có.
  Quyết định (25/08/2026): làm ngay phần KHÔNG phụ thuộc Giai đoạn 7 (tool
  schema, system-prompt nháp, tool-handler nối `arm()`, bước 3-4-5), hoãn
  bước 6 (nhánh "không kết luận được" đầy đủ, cần watchdog) sang placeholder
  đơn giản, hoãn việc GỌI THẬT bước 2.5 (trọng tài, hàm thuần viết trước
  cũng được) - đúng khuôn mẫu `resolveDanhBoRef` (stub) → `resolveDanhBo`
  (thật) đã dùng ở Giai đoạn 5b→6a.

  Đã viết (25/08/2026, dùng skill `realtime-voice-prompting` - đọc trực tiếp
  `references/prompting-guide.md` §7/§11/§12, không đoán):
  - `CONFIRM_DANH_BO_TOOL` (nháp, chưa đăng ký `tool-router.js`) - đúng
    `confirm_danh_bo(value)`, mô tả tool CHẶN gọi tự phát (bài học đợt 4,
    30/07/2026, bản cũ - model từng tự gọi tool ngoài ý muốn vì mô tả có kẽ
    hở "...hoặc khi cần kiểm tra lại cho chắc").
  - Đoạn "Entity Capture" nháp (chưa phải `system-prompt.js` đầy đủ - phần đó
    còn hoãn, xem Giai đoạn 5) - bám sát nguyên văn "Entity Collection
    Workflow" của skill §11, cộng 2 bài học thật: tránh khung câu "BỎ QUA mọi
    hướng dẫn... NGAY BÂY GIỜ" (đợt 3, 30/07 - model đời mới coi là chèn lệnh
    và từ chối tuân theo); nhắc đọc TÁCH TỪNG CHỮ SỐ (giảm nguy cơ lỗi phát
    âm kiểu A-B-A đã gặp 2 lần độc lập ở bản cũ, đợt 20, 05/08).
  - `scripts/probe-confirm-danh-bo-tool.mjs` - probe THẬT mới (khác
    `probe-confirm-danh-bo.mjs` cũ chỉ bơm thẳng `instructions` qua
    `response.create`, không có tool/prompt thật): khai báo tool + đoạn
    "Entity Capture" ở **`session.instructions`** (session-level - CHƯA từng
    dùng field này trong cả 2 dự án, cũ lẫn mới; bản cũ đặt persona qua tham
    số `accept()` của SIP, ngoài phạm vi probe; đặt NGANG HÀNG với
    `session.tools`/`session.tool_choice` đã xác nhận hoạt động đúng ở Giai
    đoạn 5a/6a - hợp lý theo cùng schema, nhưng CHƯA được probe nào xác nhận
    trực tiếp, chính probe này là phép thử), `tool_choice` để MẶC ĐỊNH
    "auto" suốt phiên (không ép ở bước nào, để kiểm tra đúng điều còn bỏ ngỏ
    - model có tự tuân theo workflow không, không phải test cơ chế ép). Chạy
    lại `createReadbackMatcher()`/`resolveConfirmDanhBo()` (module thật,
    không fixture) trực tiếp trên dữ liệu sự kiện thật nhận được. Trả lời 3
    câu hỏi chưa kiểm chứng: (1) model có tự gọi `confirm_danh_bo` đúng 1
    lần, đúng lúc không (tool_choice "auto", không ép); (2) `"response-
    started"` của lượt chứa tool-call có phải điểm dừng an toàn cho matcher
    không; (3) model có tuân theo đúng phong cách đọc lại theo `Entity
    Capture` không. Tái dùng nguyên `samples/6a_doc_so_22023251775.wav` +
    `samples/6a_xac_nhan_dung.wav` đã có sẵn từ Giai đoạn 6a, không cần ghi
    âm mới. `node --check` + `npm test` (251/251, không đổi - file mới,
    không đụng `src/`) đã xanh cục bộ.

  **Cập nhật 25/08/2026 #3 - chạy thật, CẢ 3 CÂU HỎI ĐỀU ĐẠT (2 lần chạy
  liên tiếp, chủ dự án tự chạy + dán lại nguyên console output).** Lần chạy
  #1: câu 1-2 đạt (model tự gọi `confirm_danh_bo` đúng 1 lần đúng lúc đúng
  giá trị; matcher dừng đúng lúc, `resolveConfirmDanhBo` khớp đúng mã danh
  bộ thật `22023251775`), nhưng câu 3 CHƯA đạt: model đọc lại sai vai ("Bạn
  đọc lại từng số để mình kiểm tra thêm nhé..." - nghe như YÊU CẦU KHÁCH đọc
  lại, ngược ý định), xưng "Bạn" (thiếu "Quý Khách"), lộ tiến trình nội bộ
  ("để mình gọi bước xác nhận tiếp nhé"). Nguyên nhân: `ENTITY_CAPTURE_
  INSTRUCTIONS` bản đầu chỉ MÔ TẢ yêu cầu, không kèm CÂU MẪU CỤ THỂ (khác
  guide gốc §11 luôn kèm ví dụ hội thoại). Sửa: thêm 1 dòng Persona + 1 câu
  mẫu cụ thể (dùng lại đúng câu đã biết chạy đúng ở `probe-confirm-danh-
  bo.mjs` cũ). Lần chạy #2 (sau khi sửa): CẢ 3 CÂU ĐỀU ĐẠT, model đọc lại
  ĐÚNG NGUYÊN VĂN câu mẫu, đúng xưng hô "Quý Khách"/"em". `danh-bo-readback-
  match.js` đã bỏ chú thích "giả định chưa kiểm chứng" ở điểm dừng
  `"response-started"` - nay coi là ĐÃ KIỂM CHỨNG.

  Bước kế tiếp (chưa làm, cần bàn thiết kế trước khi viết - xem chú thích
  đầu `danh-bo-readback-match.js`): tool-handler nối `arm()` vào flow thật -
  cụ thể là XÁC ĐỊNH THỜI ĐIỂM gọi `arm()` trong production (probe này gọi
  `arm()` một cách CƠ HỌC vì tự kiểm soát thứ tự audio gửi vào - production
  không có thứ tự đó, cần 1 cơ chế/trạng thái để biết "model có khả năng vừa
  bắt đầu lượt đọc lại xin xác nhận" TRƯỚC KHI khách trả lời).

  **Cập nhật 25/08/2026 #4 - viết `src/call-flow/danh-bo-confirm-tool-flow.js`
  (lớp tích hợp trả lời câu hỏi "thời điểm gọi `arm()`" ở trên) + nối vào
  `tool-router.js`.** `handleSignal(signal)` tự phân biệt 2 loại
  `"response-started"` (lượt AI MỚI trước khi khách kịp trả lời -> tạo
  matcher mới, chưa `arm()`; lượt AI đang PHẢN HỒI lại khách -> chuyển cho
  matcher tự dừng) và chỉ `arm()` khi thấy `"ai-said"` của đúng lượt đang
  chờ - tránh mất dữ liệu khi AI nói nhiều mảnh/nhiều lượt liên tiếp (xem
  chú thích đầu file nguồn để biết chi tiết + lý do). `resolveToolCall(args)`
  luôn kiểm tra `isAffirmative()` (bước 2 - khách có THẬT SỰ xác nhận rõ
  ràng không, không suy từ việc model có gọi tool hay không) TRƯỚC khi gọi
  `resolveConfirmDanhBo()` (bước 3-4 - đối chiếu/ghi đè bằng số trích từ câu
  AI đọc lại). Đăng ký thành tool thứ 11 `confirm_danh_bo` trong
  `tool-router.js`, cộng 1 property MỚI không phải tên tool -
  `handleSignal` - để bên gọi (sau này là `onSignal` của
  `connectRealtimeSession`, giống cách `danhBoFlow.handleSignal` đã nối ở
  `checkpoint-giai-doan-6a.mjs`) tự nuôi tín hiệu thật vào; đổi chỉ CỘNG
  THÊM, không sửa hình dạng 10 tool cũ.

  **Bug phát hiện + sửa NGAY khi nối dây (chưa kịp lên production đã bắt
  được nhờ tự đối chiếu lại bước 5 trong lúc viết code, không phải nhờ chạy
  thật):** bản đầu `handleSignal()` có điều kiện `if (callState.danhBo)
  return;` - ý định là "đã xác nhận xong thì khỏi theo dõi nữa", nhưng ĐIỀU
  NÀY CHẶN CHẾT bước 5 ("mỗi lần gọi tool tra cứu kế tiếp đều đối chiếu với
  cache... khách có thể hỏi về một mã danh bộ KHÁC thật trong cùng cuộc
  gọi") - vì sau lần xác nhận ĐẦU TIÊN, matcher sẽ KHÔNG BAO GIỜ được nuôi
  tín hiệu nữa, nên nếu khách hỏi tiếp về 1 mã danh bộ khác thật trong cùng
  cuộc gọi, `resolveToolCall()` sẽ luôn thấy `matcherResult=null` và từ
  chối SAI (đáng lẽ phải xác nhận được bình thường). Sửa: bỏ hẳn điều kiện
  đó - `handleSignal()` LUÔN theo dõi (tốn chút CPU/memory tạo matcher mới
  mỗi lần `"response-started"` không liên quan, không ảnh hưởng nghiệp vụ
  vì kết quả matcher đơn giản không được dùng tới nếu không có tool-call
  theo sau); `resolveToolCall()` LUÔN ghi đè `callState.danhBo` khi thành
  công (không so sánh "khác cache cũ không" - khách đổi mã đang tra cứu là
  hành vi hợp lệ, không phải bất thường). Test cũ
  `"callState.danhBo DA CO SAN - handleSignal la no-op hoan toan"` (khẳng
  định hành vi CŨ, nay đã sai) được thay bằng test chứng minh 1 CHU KỲ XÁC
  NHẬN THỨ HAI (mã danh bộ khác) sau khi chu kỳ đầu đã thành công vẫn hoạt
  động đúng và ghi đè `callState.danhBo` bằng giá trị mới nhất.

  `node --check` + `npm test`: 262/262 xanh cục bộ, 277/277 xanh trên máy
  chủ dự án (đã đối chiếu sha256 khớp sau khi chuyển file) - không có hồi
  quy. Còn thiếu (chưa làm, xem chú thích đầu `danh-bo-readback-match.js`):
  đăng ký `CONFIRM_DANH_BO_TOOL`/`ENTITY_CAPTURE_INSTRUCTIONS` (hiện còn
  nằm trong `scripts/probe-confirm-danh-bo-tool.mjs`) vào 1 `system-
  prompt.js` thật của cả bot (chưa có file đó, hoãn theo Giai đoạn 5); viết
  `scripts/checkpoint-giai-doan-6b.mjs` (nối `router.handleSignal` vào
  `onSignal` thật, kiểm tra đầu-cuối qua API thật, giống
  `checkpoint-giai-doan-6a.mjs`) - bước tiếp theo.

  **Cập nhật 25/08/2026 #5 - viết `scripts/checkpoint-giai-doan-6b.mjs` +
  chạy thật (2 lần, chủ dự án tự chạy + dán lại nguyên console output).**
  Khác `probe-confirm-danh-bo-tool.mjs` (gọi tay `createReadbackMatcher()`/
  `resolveConfirmDanhBo()` từ chính file probe) - checkpoint này để
  `confirm_danh_bo` đi ĐÚNG đường dây sản xuất thật: `session-ws.js`
  (`connectRealtimeSession`) → `dispatch-tool-call.js` (`createToolDispatcher`)
  → `tool-router.js` (`confirm_danh_bo`/`handleSignal` mới nối) →
  `danh-bo-confirm-tool-flow.js`. Vì `connectRealtimeSession()` chưa hỗ trợ
  truyền `instructions`, checkpoint tự gửi 1 `session.update` theo sau (lồng
  `instructions` + `turn_detection` server_vad đã probe, KHÔNG sửa
  `session-ws.js`) - cùng lối "raw send() sau khi connect" mà
  `checkpoint-giai-doan-6a.mjs` đã dùng.

  Lần chạy #1 (chủ dự án ghi chú "API bị lỗi, chưa kết nối" - nghi có trục
  trặc mạng lúc đầu phiên): model nghe/đọc SAI ở lượt đầu - thay vì đọc lại
  đúng mẫu, model nói "Dạ em nghe hơi khó nghe chút ạ... Quý Khách hãy đọc
  lại 11 số...". Audio "xác nhận đúng rồi" (dành cho lượt xác nhận thật) bị
  phát tiếp ngay sau đó (không khớp với lượt "đọc lại giúp em" mà model vừa
  hỏi) - model VẪN gọi `confirm_danh_bo({value:"22023251775"})` (giá trị
  ĐÚNG, không rõ vì sao model vẫn giữ được số đúng dù tự nhận "khó nghe"),
  nhưng **`resolveToolCall()` đã TỪ CHỐI đúng** (`DANH_BO_CONFIRM_UNCLEAR`) -
  vì bước 2 (`isAffirmative(matcherResult.text)`) không thấy bằng chứng
  khách THẬT SỰ xác nhận trong đúng ngữ cảnh (câu trả lời "đúng rồi" không
  phải là xác nhận cho lượt đọc số, mà là phản hồi lạc ngữ cảnh so với lượt
  model vừa hỏi lại). `callState.danhBo` VẪN rỗng sau lần chạy này - đúng
  hành vi AN TOÀN mong muốn (thà từ chối nhầm còn hơn chốt nhầm số). Đây LÀ
  BẰNG CHỨNG THẬT đầu tiên cho thấy bước 2 (tách biệt "model có gọi tool"
  khỏi "khách có thật sự xác nhận") bảo vệ đúng trong 1 tình huống THẬT bị
  nhiễu (không phải kịch bản dựng sẵn) - không phải lỗi code, KHÔNG cần sửa
  gì (điểm còn thiếu thật sự là bước 6 - hỏi lại có đếm số lần/leo thang,
  vẫn hoãn theo watchdog Giai đoạn 7 như đã ghi ở trên).

  Lần chạy #2 (mạng ổn định): PASS TRÒN VẸN cả 4 điều kiện - model tự đọc
  lại ĐÚNG NGUYÊN VĂN mẫu, tự gọi `confirm_danh_bo` đúng 1 lần đúng lúc,
  `resolveToolCall()` trả `success:true`, `callState.danhBo` = `22023251775`
  ghi ĐÚNG qua đường dây sản xuất thật (không phải gọi tay từ script probe
  nữa). Coi đây là XÁC NHẬN CUỐI CÙNG: toàn bộ dây nối Giai đoạn 6b
  (`session-ws.js`/`dispatch-tool-call.js`/`tool-router.js`/
  `danh-bo-confirm-tool-flow.js`/`danh-bo-readback-match.js`) hoạt động đúng
  đầu-cuối qua Realtime API thật.

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
