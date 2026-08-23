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
