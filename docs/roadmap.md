# Lo trinh viet lai (voice-bot-trungan v2)

Nguyen tac chung: moi giai doan viet it nhat co the, tu kiem chung duoc
(test/log ro rang) truoc khi qua giai doan ke tiep. Moi giai doan la MOT
commit git rieng de de rollback.

- [x] **Giai doan 0 - Khung xuong.** `package.json` (chua co dependency),
  cay thu muc rong theo lop (`src/session`, `src/call-flow`, `src/domain`,
  `src/integrations`, `src/logging`, `docs/fix`, `test`). Muc tieu: `npm
  start` chay, log ra "OK", chua ket noi gi ca.

- [~] **Giai doan 1 - Nhin tan mat luong event that.** Script
  `scripts/probe-realtime.mjs` da viet xong (khong qua Asterisk, khong qua
  business logic) - mo WebSocket thuan toi Realtime API, gui
  `session.update` giong het "normal mode" cua production, log toan bo
  event tho ra `logs/probe-*.jsonl`. CHUA CHAY THU (can OPENAI_API_KEY that
  + mang that, ca hai deu khong co trong moi truong dieu khien tu xa - phai
  tu chay tren may that). Chi danh dau [x] xong khi da tu chay va tu giai
  thich duoc thu tu `speech_started -> speech_stopped -> committed ->
  transcription.completed` tu log that.

- [ ] **Giai doan 2 - `src/session/turn-signal.js`.** Ham thuan: input la
  event tho (lay tu fixture cua Giai doan 1), output la object luot chuan
  hoa. Test bang cach replay fixture, khong can goi OpenAI that.

- [ ] **Giai doan 3 - `src/session/turn-controller.js`.** Cua duy nhat gui
  `response.create`/`cancel`, API toi gian `say({mode, text|instructions|
  toolChoice})`, tu quan race (`_responseActive`, `gen` token). Test bang
  WS gia (mock `ws.send`) cho tung race da biet o ban cu (hai response
  cung gui, retry mo coi, cancel nham response) truoc khi tich hop.

- [ ] **Giai doan 4 - Checkpoint goi thu dau-cuoi dau tien.** Chi
  implement phase "hoi dap tu do" (`create_response:true`, model tu tra
  loi). `src/session/session-ws.js` la orchestrator mong noi cac lop lai.

- [ ] **Giai doan 5 - Chuyen logic nghiep vu co chon loc.** Dua
  `tools.js`, `system-prompt.js`, `db.js`, `api.js`,
  `danh-bo-arbiter.js` tu project cu sang `src/domain/` / `src/
  integrations/` - ra soat: giu phan nghiep vu that, bo phan chi ton tai
  de va race cua kien truc cu (turn-controller da lo viec do). Doi chieu
  voi cac quyet dinh da ghi trong project memory (transcript chi de
  debug, gate xac nhan loi noi cho danh bo trong tai, SDT test hardcode)
  de khong danh mat bai hoc.

- [ ] **Giai doan 6 - Phase phuc tap nhat: danh bo.**
  `src/call-flow/danh-bo-collect.js` va `danh-bo-confirm.js` duoi dang
  bang matcher (khong phai if/else long nhau). Test tung matcher bang
  fixture transcript rieng le, roi moi test tich hop qua harness cua
  Giai doan 1.

- [ ] **Giai doan 7 - `src/session/watchdogs.js`.** Luoi an toan dung
  chung (mute watchdog, vad-restore watchdog). Test gia lap tinh huong
  "quen trigger response" de xac nhan watchdog cuu duoc.

- [ ] **Giai doan 8 - Noi Asterisk/AudioSocket that.** Chuyen
  `audiosocket.js`, `call-manager.js` sang cuoi cung - sau khi toan bo
  logic phia tren da test duoc ma khong can dien thoai that.

- [ ] **Giai doan 9 - Doi chieu voi bo test cu.** Chuyen/thich nghi 4 file
  trong `test_case/*.test.mjs` cua ban cu (`danh_bo_20260726`,
  `danh_bo_verify_flow`, `speak_verbatim`, `muc_c_khong_cam`) sang chay
  tren ban moi - dieu kien "duoc phep thay the ban cu" chi khi pass het.

## Quy uoc

- File/thu muc: kebab-case, khong dau cach, khong hau to "copy"/"v2"/
  "backup" (git da giu lich su).
- Thuat ngu nghiep vu tieng Viet (danh bo, xac nhan...) giu nguyen trong
  ten - la ngon ngu nghiep vu ca team dang dung.
- `src/session/` duoc phep biet ve WebSocket/Realtime event.
  `src/domain/` KHONG duoc import gi tu `ws` - logic nghiep vu thuan,
  test duoc khong can mo ket noi that.
- Moi thay doi kien truc lon o `src/session/` nen co 1 file ghi lai trong
  `docs/fix/` (giong thoi quen `docs/fix/` cua ban cu), giai thich VI SAO
  chu khong chi DA DOI GI.
