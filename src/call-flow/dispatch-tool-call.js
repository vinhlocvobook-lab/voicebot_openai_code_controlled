// src/call-flow/dispatch-tool-call.js
//
// Giai doan 5a (xem docs/roadmap.md). Nhan tin hieu da chuan hoa
// kind:"tool-call-requested" tu turn-signal.js (xac nhan bang du lieu
// that o scripts/probe-tool-call.mjs), tra bang `handlers` de tim ham xu
// ly THAT tuong ung ten tool, goi ham, gui ket qua ve OpenAI dang
// function_call_output, roi goi turnController.say() de model noi tiep -
// dung 4 buoc da minh hoa/thao luan voi chu du an truoc khi viet.
//
// Module nay CHI la "tong dai" (routing + luoi an toan) - KHONG tu biet
// get_bill/get_outages/... la gi. Ben goi (checkpoint script, sau nay
// server.js) tu truyen vao `handlers` (vd { get_bill: (args) =>
// getTienNuoc(args.ma_danh_bo, args.ky, args.nam) }) - giu module nay
// khong phu thuoc tongdai-api.js/mang, test duoc bang handler gia.
//
// Nguyen tac BAT BUOC (giong tongdai-api.js/calllog-api.js): LOI O DAY
// KHONG DUOC LAM SAP CUOC GOI - moi loi (tool khong ro, arguments JSON
// hong, handler that bai) deu duoc bat lai, tra ve 1 function_call_output
// BAO LOI cho model (de model tu xin loi khach hoac thu cach khac),
// khong throw ra ngoai handleSignal().
//
// [fix 22/08/2026, xac nhan bang scripts/checkpoint-giai-doan-5a.mjs chay
// that + sequence diagram] KHONG goi turnController.say() NGAY sau khi
// gui function_call_output nua. Du lieu that xac nhan:
// response.function_call_arguments.done (nguon tin hieu tool-call-
// requested) LUON den TRUOC response.done (nguon response-ended) cho
// CUNG 1 response - goi say() ngay o day khien turn-controller.js con
// thay response do "active", tu dong gui THEM 1 response.cancel thua,
// bi OpenAI tu choi (error response_cancel_not_active). Khong pha hong
// cuoc goi (response van tu hoan tat binh thuong), nhung la nhieu/lang
// phi 1 vong goi API moi lan co tool-call.
//
// SUA: gui function_call_output NGAY (khong doi - giu loi the toc do,
// tool co the chay song song luc model con dang noi cau "de toi xem
// thu..."), nhung CHI goi say() sau khi thay dung tin hieu response-
// ended cua CHINH response chua tool-call do. Luc nay turn-controller.js
// da tu don activeResponseId ve rong (qua handleSignal cua no), nen
// say() se khong con thay responseInFlight nua - khong gui cancel thua.
//
// [fix 23/08/2026] Log cu chi in ra "da gui function_call_output" ma
// KHONG in noi dung tool tra ve gi - doc lai log/diagram khong biet duoc
// get_bill/... thuc su tra ve so tien bao nhieu. Them 1 dong log("info")
// ngay sau khi runTool() xong, in ca ten tool + callId + KET QUA day du -
// checkpoint script van dang tee() moi dong log() nay vao file nhu cu,
// khong can sua checkpoint script.
//
// [bo sung 23/08/2026, theo yeu cau chu du an] Them 2 dong log nua, tach
// rieng 3 moc quan sat doc lap (moi moc co the sai theo 1 cach khac nhau,
// nen KHONG gop lam 1 dong):
//   1. INPUT nhan duoc (truoc khi goi handler) - dung rawArgs nguyen van
//      (chuoi JSON tho model gui, GIONG HET field `arguments` cua tin
//      hieu tool-call-requested - xem turn-signal.js) de doi chieu duoc
//      voi dong tool-call-requested da co tren diagram.
//   2. OUTPUT handler tra ve (da co tu ban fix truoc, giu nguyen).
//   3. Payload THAT gui len OpenAI (item conversation.item.create day du,
//      khong chi ten event) - khac voi #2 o cho day la dang DA DUOC BOC
//      (call_id + JSON.stringify(output) lam string long trong `item`),
//      neu co loi boc sai (vd nham call_id, JSON.stringify hong) se thay
//      o day ma khong thay o #2.
//
// [fix 23/08/2026, sau khi dong Giai doan 5b] Doc 2 field dac biet trong
// OUTPUT cua tool (khong phai trong tin hieu) de quyet dinh CACH goi say():
//   - `action:"no_reply"` (hien tai chi wait_for_user tra ve) -> KHONG goi
//     say() - de model THAT SU im lang cho khach noi tiep, thay vi luon
//     tra loi mot cai gi do sau moi tool call (truoc ban fix nay, goi
//     wait_for_user se KHONG co tac dung gi - bot van tu noi binh thuong).
//   - `doc_cho_khach` (call-control.js/procedures.js tra ve khi co kich
//     ban BAT BUOC doc nguyen van - vd huong dan giay to thu tuc, cau hoi
//     xac nhan doi tuong) -> goi say({mode:"verbatim", text: doc_cho_khach})
//     thay vi say({mode:"auto"}) - tranh model tu tom tat/dien dat lai lam
//     rot mat chi tiet bat buoc (dia chi van phong, giay to bat buoc - da
//     tung la loi that o ban cu, xem comment trong procedures.js).
//   - Khong co ca 2 field tren -> giu hanh vi cu: say({mode:"auto"}).
// [CAP NHAT 25/08/2026, Giai doan 8 - DA XU LY, giu doan van cu tren de nho
// lich su] action:"end_call"/"transfer_to_agent" gio DA noi vao API that
// (src/integrations/realtime-calls-api.js#hangupCall/referCall) - xem khoi
// comment rieng "Giai doan 8" ngay duoi day cho thiet ke day du. Tom tat: 2
// action nay VAN di qua sayForOutput() nhu truoc (khong doi cach noi - gio
// ca 2 tool (call-control.js#handleEndCall/handleTransferToAgent) DEU co
// san doc_cho_khach nen se doc dung kich ban co dinh, khong con roi ve say()
// mode "auto"), CHI THEM 1 buoc: sau khi CHINH response do (cau tam biet/
// thong bao) THAT SU ket thuc (tin hieu response-ended cua NO), moi goi
// hangupCall()/referCall() that qua 2 hook `onEndCall`/`onTransferToAgent`
// (optional, factory param moi).
//
// ============================================================================
// GIAI DOAN 8 - noi end_call/transfer_to_agent vao Realtime Calls API THAT:
// ============================================================================
// VAN DE: turnController.say() KHONG tra ve responseId (chi tra ve so
// `generation` noi bo cua turn-controller.js, khong lo ra ngoai) - o day CAN
// biet DUNG responseId cua cau tam biet/thong bao moi goi de cho DUNG tin
// hieu response-ended cua NO (khong phai response chua tool-call goc, cung
// khong duoc doan bang timer co dinh nhu ban cu - xem giai thich dai trong
// src/integrations/realtime-calls-api.js ve 2 setTimeout da bi bo).
//
// CACH GIAI (don gian, khong sua turn-controller.js - module do da on dinh/
// duoc test ky tu Giai doan 3, tranh dung cham khong can thiet): dispatch-
// tool-call.js#handleSignal() gio LANG NGHE THEM kind "response-started"
// (truoc day bo qua im lang). Ngay khi sayForOutput() biet output.action la
// "end_call"/"transfer_to_agent" VA co hook tuong ung, dat co
// `awaitingActionResponseId = true` + nho lai hanh dong vao
// `pendingCallAction`. response-started KE TIEP ma dispatcher nhan duoc se
// duoc coi LA CHINH response do (dung DUNG thu tu FIFO ma turn-controller.js
// da dua vao thiet ke cua no - xem giai thich hang doi trong turn-
// controller.js) - gia dinh nay AN TOAN trong pham vi module nay vi
// sayForOutput() la NOI DUY NHAT trong 1 chu ky tool-call goi say() sau khi
// dat co, khong co say() nao khac chen ngang tu chinh dispatcher nay giua
// luc dat co va luc response-started ke tiep toi (danhBoFlow la luong RIENG,
// khong bao gio chay dong thoi voi 1 tool-call end_call/transfer_to_agent DA
// THANH CONG trong CUNG 1 chu ky). Luu actionResponseId, roi CHO response-
// ended cua DUNG id do moi thuc su goi onEndCall()/onTransferToAgent().
//
// [gioi han da biet, CHUA duoc kiem chung qua API that - ghi ro thay vi im
// lang, giong quy uoc cac gia dinh khac trong file nay] Neu 1 nguon nao do
// KHAC (vd model tu y goi tool khac, hoac 1 code path khac tu goi say())
// chen 1 response.create giua luc dat co va response-started ke tiep, co
// nay se gan NHAM actionResponseId cho response SAI - can checkpoint chay
// that (scripts/checkpoint-giai-doan-8-*.mjs, chua viet) de xac nhan gia
// dinh nay dung trong dieu kien that truoc khi dua vao san xuat.
// ============================================================================
//
// [fix 23/08/2026 #2, phat hien BANG checkpoint-giai-doan-5b.mjs/-audio.mjs
// chay THAT voi tongdai-api.js that (KHONG phai doan)] Ban dau (fix o
// tren) gia dinh ngam: dispatcher se KIP dang ky waitingForResponseEnded
// TRUOC khi response-ended cua response do toi - dung voi handler gia lap
// gan nhu tuc thoi (Giai doan 5a), nhung SAI voi handler that co do tre
// mang. Du lieu that (logs/checkpoint5b-1787506705312.txt): goi that toi
// API CNTA mat 2483ms, nhung response.done cua OpenAI cho response chua
// tool-call ve chi sau ~6ms ke tu luc gui request - OpenAI KHONG doi tool
// chay xong moi dong response (chi doi model PHAT XONG loi goi ham).
// Code cu: goi waitingForResponseEnded.set(responseId, output) SAU khi
// await handler() xong - luc do response-ended cua responseId nay DA toi
// va DA bi bo qua (Map rong luc do, .has() tra false) TRUOC khi entry
// duoc tao - "no" bi mat vinh vien, say() khong bao gio duoc goi, cuoc
// goi treo toi timeout. Du lieu that: CA 2 checkpoint (text lan audio)
// deu "CAN XEM LAI" vi dung ly do nay, khong lien quan billing.js/
// tool-router.js (van tra ve dung du lieu that).
//
// SUA: tach trang thai theo responseId thanh 1 entry {ended, hasOutput,
// output} - dang ky entry NGAY khi biet responseId (truoc khi await
// handler, tuc truoc ca khi co do tre mang nao xay ra), roi:
//   - response-ended toi TRUOC (entry.ended=true) khi handler CHUA xong:
//     luc handler xong, thay entry.ended da true -> goi say() NGAY,
//     khong con gi de cho nua.
//   - response-ended toi SAU (binh thuong, giong Giai doan 5a): luc
//     handler xong, entry.ended con false -> luu output vao entry, cho
//     response-ended toi moi say() (y het hanh vi cu).
// Bat ke thu tu, say() LUON duoc goi dung 1 lan khi CA HAI dieu kien (tool
// xong + response ket thuc) da xay ra - khong con phu thuoc ai toi truoc.
//
// [them 24/08/2026, Giai doan 6a] 2 tham so factory MOI, CA HAI DEU
// OPTIONAL (khong truyen -> giu nguyen 100% hanh vi cu, 20 test cu cua
// Giai doan 5a/5b khong sua gi van phai pass):
//   - `danhBoFlow`: object tra ve boi createDanhBoFlow() (xem src/call-
//     flow/danh-bo-flow.js). Khi 1 tool tra ve output.error_code ===
//     "DANH_BO_MISSING" (hop dong that cua resolveDanhBoRef/tool-router.js,
//     xem resolve-danh-bo-ref.js) VA co danhBoFlow, sayForOutput() KHONG
//     goi turnController.say() binh thuong nua - thay vao do goi
//     danhBoFlow.start(...) de CODE (khong phai model) tu chu dong hoi lai
//     danh bo bang say(mode:"verbatim") rieng cua no (xem ASK_PROMPT trong
//     danh-bo-flow.js). Neu danhBoFlow KHONG duoc truyen (vd checkpoint cu
//     cua Giai doan 5b chua can toi), giu nguyen hanh vi cu: roi xuong cac
//     nhanh action/doc_cho_khach ben duoi (khong khop nhanh nao) -> say()
//     mode auto nhu truoc, model tu xu ly loi DANH_BO_MISSING trong loi noi.
//   - `now`: ham tra ve mocs epoch (mac dinh Date.now()) - CHI dung de
//     truyen nowMs vao danhBoFlow.start(reason, nowMs), giu dung quy uoc
//     "khong tu goi Date.now() ben trong module thuan" cua danh-bo-flow.js
//     (test truyen ham gia co dinh de test tat dinh, khong flaky theo thoi
//     gian thuc chay test).
//
// [them 24/08/2026 #2, Giai doan 6a - "sau khi khach xac nhan xong thi
// sao?"] Sau khi danhBoFlow xong (thanh cong hoac bo cuoc), can 1 ham MOI
// `handleDanhBoFlowDone(result)` - ben goi (lop tich hop that, se viet o
// checkpoint-giai-doan-6a.mjs) tu noi vao onDone cua createDanhBoFlow():
//     const danhBoFlow = createDanhBoFlow({
//       ...,
//       onDone: async (result) => {
//         if (result.ok) callState.danhBo = result.danhBo; // CALLER set,
//           // KHONG PHAI dispatch-tool-call.js - module nay khong nam giu
//           // callState (chi handlers moi dong qua callState, xem tool-
//           // router.js), giu dung ranh gioi da co.
//         await toolDispatcher.handleDanhBoFlowDone(result); // PHAI await
//           // XONG roi moi setVadMode("normal") - xem "sua 24/08/2026 #3"
//           // ngay duoi day, ly do la 1 bug THAT phat hien qua checkpoint.
//         setVadMode("normal"); // CALLER goi - dispatch-tool-call.js
//           // khong nhan setVadMode lam dependency, tranh phinh to tham so
//           // factory chi cho 1 nhanh dung 1 lan.
//       },
//     });
//
// [sua 24/08/2026 #3, PHAT HIEN THAT qua checkpoint-giai-doan-6a.mjs chay
// that lan 2 - "PASS" nhung log cho thay get_bill bi goi 3 LAN thay vi 2]
// Ban dau vi du tren viet setVadMode("normal") TRUOC
// toolDispatcher.handleDanhBoFlowDone(result) (khong await, goi roi bo do).
// Bug: setVadMode("normal") bat lai create_response:true (VAD server tu
// dong tra loi) NGAY LAP TUC, trong khi handleDanhBoFlowDone() con dang
// CHAY BAT DONG BO (await runTool() that toi tongdai-api.js, ~vai giay) -
// trong khoang cho do, VAD moi bat da co the tu kich hoat response cua
// CHINH model (khong phai code chu dong), va model dat trong tinh trang
// "vua nhan duoc function_call_output DANH_BO_MISSING cu, chua co ket qua
// moi" co the TU DOAN/hallucinate 1 loi goi tool khac (quan sat that: goi
// get_bill lan 3 voi ma_danh_bo bi doan sai, KHONG khop danh bo that vua
// xac nhan). May man resolveDanhBoRef() bo qua hoan toan rawArg, chi tin
// callState.danhBo, nen KHONG co du lieu SAI den tay khach - nhung van la
// 1 loi that (ton 1 lan goi API thua, rui ro khach nghe 2 cau tra loi
// chong nhau trong cuoc goi that). Sua: await xong handleDanhBoFlowDone()
// (dam bao say() verbatim cuoi cung da GUI xong response.create) roi MOI
// setVadMode("normal") - luc do khong con "cua so ho hong" nao de VAD tu
// kich hoat response canh tranh nua. turnController.say() ban than no
// hoat dong duoc BAT KE VAD mode nao (VAD chi kiem soat response TU DONG
// cua SERVER, khong lien quan goi say() tuong minh) nen doi khong lam mat
// tac dung cua handleDanhBoFlowDone(), chi tranh khoang ho ma VAD moi bat
// co the chen ngang.
// QUYET DINH THIET KE (chuyen gia CSKH + goc nhin khach hang, xem thao
// luan day du trong hoi thoai voi chu du an 24/08/2026 - KHONG doan, dung
// lai bang chung/quy tac da co san trong du an):
//   - THANH CONG: CODE (khong phai model) tu goi LAI DUNG tool + rawArgs
//     GOC da lam ra DANH_BO_MISSING ban dau (nho trong `pendingDanhBoRetry`
//     duoi day) - KHONG de model tu nho/tu dien lai yeu cau cu. Ly do KY
//     THUAT (khong chi trieu chuong): luot goi lai nay KHONG co function_
//     call moi tu model (khong co call_id moi) de gan function_call_output
//     vao - say({mode:"auto"}) se khong co gi MOI trong conversation de
//     model thuat lai (rui ro model bia/lay du lieu cu). Vi vay dung
//     say({mode:"verbatim", text: output.message}) - CA 4 tool bi chan boi
//     DANH_BO_MISSING (get_bill/compare_usage/get_outages/create_ticket)
//     deu da co san truong `message` duoc viet RIENG cho TTS (vd
//     billing.js#docTienVN doc so tien thanh chu, tranh loi "1.180.266
//     đồng" bi TTS doc sai tung da xac nhan that) - KHONG de model tu dien
//     dat lai co the vo tinh doc sai dung nhung con so nay.
//   - Co 1 cau "preamble" NGAN truoc khi goi lai (mode "guided", KHONG
//     verbatim - khong co du lieu nhay cam nen cho phep model tu bien tau
//     de khong nghe may moc) - dung nguyen tac muc 5 (Preambles) cua
//     realtime-voice-prompting: nen co preamble khi viec sap lam TON THOI
//     GIAN DANG KE - do tre mang goi tongdai-api.js that DA DO duoc
//     ~2483ms (xem ghi chu fix 23/08/2026 #2 o tren), du de khach cam nhan
//     duoc im lang neu khong co preamble.
//   - THAT BAI (giveUp): KHONG noi gi them o day - danh-bo-flow.js#giveUp()
//     (sua cung ngay 24/08/2026) DA TU say() 1 cau xin loi + de nghi
//     chuyen may (dung nguyen tac "Tool Failures" cua realtime-voice-
//     prompting: "offer an alternate path or escalation"), tranh noi 2 lan
//     chong nhau (1 lan tu giveUp(), 1 lan o day).
const RETRY_PREAMBLE_INSTRUCTIONS =
  "Nói thật ngắn gọn, tự nhiên rằng bạn đã có mã danh bộ và sẽ tra cứu ngay giúp khách, không nói gì thêm.";

// [them 24/08/2026 #7, thiet ke da xac nhan voi chu du an 24/08/2026 - "khach
// XAC NHAN DUNG ma danh bo (danhBoFlow phase 'done') nhung LAN GOI LAI tool o
// handleDanhBoFlowDone() (runTool() ben duoi) VAN THAT BAI"] Khoang trong thiet
// ke chua tung duoc xu ly truoc ban fix nay - code cu chi co 3 nhanh
// (doc_cho_khach/output.message/fallback guided), CA 3 deu NGAM DINH lan goi
// lai LUON thanh cong (chi khac cach doc KET QUA THANH CONG, khong nhanh nao
// hoi "neu that bai thi sao"). Phat hien qua 1 checkpoint chay giua chung (xem
// docs/fix/giai_doan_6a_audit_kich_ban_da_test_20260824.md, muc "Phat hien
// phu"), KHONG doan - da doc lai src/domain/billing.js VA
// src/integrations/tongdai-api.js (dong 60-155) de xac dinh CHINH XAC taxonomy
// error_code THAT truoc khi thiet ke:
//   - callApi() (tongdai-api.js) CHI TU TAO ra dung 3 ma loi HE THONG/MANG:
//     TIMEOUT (AbortError do request qua han), CONNECTION_ERROR (loi fetch/
//     mang khac), INVALID_RESPONSE (JSON parse hong). Doc lai KHONG giup gi -
//     ban chat la mang/server dang loi, khong lien quan so khach vua doc.
//   - MOI error_code KHAC (vd CUSTOMER_NOT_FOUND/INVOICE_NOT_FOUND/
//     PRODUCTION_NOT_FOUND) la PASS-THROUGH NGUYEN VAN tu backend that
//     (billing.js#fetchBilling khong sua doi) - dai dien loi DU LIEU (vd danh
//     bo khong khop ho so nao), CO THE do khach doc nham hoac STT nghe nham
//     (xem bang chung STT nghe nham tap am that o docs/fix/giai_doan_6a_audit_
//     ..._20260824.md muc "Cap nhat 24/08/2026 #2").
//
// QUYET DINH THIET KE (roleplay CSKH + goc nhin khach hang cung chu du an, 2
// cau hoi rieng bang AskUserQuestion - xem lich su hoi thoai 24/08/2026):
//   - LOI HE THONG (LOOKUP_SYSTEM_ERROR_CODES duoi day): xin loi + de nghi
//     chuyen may NGAY, KHONG tu mong khach doc lai - doc lai vo ich (loi
//     khong lien quan dung/sai so).
//   - LOI DU LIEU (moi ma con lai, ke ca thieu error_code): CODE tu dong moi
//     khach doc LAI (danhBoFlow.start() lai tu dau, KHONG de model tu quyet
//     dinh phai noi gi) toi da MAX_DANH_BO_LOOKUP_RETRIES lan, co 1 preamble
//     ngan (guided, ngu y co the da NGHE NHAM - KHONG do loi cho khach) TRUOC
//     khi danhBoFlow.start() tu noi ASK_PROMPT cua no. Het luot -> xin loi +
//     chuyen may giong het nhanh loi he thong (khong lap lai van xin loi rieng).
const LOOKUP_SYSTEM_ERROR_CODES = new Set(["TIMEOUT", "CONNECTION_ERROR", "INVALID_RESPONSE"]);
const MAX_DANH_BO_LOOKUP_RETRIES = 2;

const LOOKUP_SYSTEM_ERROR_TEXT =
  "Dạ, em xin lỗi, hệ thống đang gặp sự cố nên chưa tra cứu được thông tin của Quý Khách. Để em chuyển máy cho nhân viên hỗ trợ giúp mình nhé.";

const LOOKUP_DATA_ERROR_PREAMBLE_INSTRUCTIONS =
  "Xin lỗi khách thật ngắn gọn vì có thể đã nghe nhầm mã danh bộ, nói sẽ mời khách đọc lại giúp, không nói gì thêm khác.";

const LOOKUP_RETRY_EXHAUSTED_TEXT =
  "Dạ, em xin lỗi, em vẫn chưa tìm thấy thông tin khớp với mã danh bộ Quý Khách vừa cung cấp. Để em chuyển máy cho nhân viên hỗ trợ kiểm tra giúp mình nhé.";

export function createToolDispatcher({
  send,
  turnController,
  log = () => {},
  handlers = {},
  danhBoFlow = null,
  now = () => Date.now(),
  // [them 25/08/2026, Giai doan 8] Optional - khong truyen thi giu NGUYEN
  // hanh vi cu (chi noi loi tam biet/thong bao, KHONG cup/chuyen may that) -
  // xem khoi comment "GIAI DOAN 8" dau file. async (lyDo) => void, ben goi
  // (server.js/checkpoint that, chua viet) tu bind san callId cua cuoc goi:
  //   onEndCall: (lyDo) => hangupCall(callId),
  //   onTransferToAgent: (lyDo) => referCall(callId, AGENT_QUEUE_URI),
  onEndCall = null,
  onTransferToAgent = null,
} = {}) {
  // responseId -> { ended, hasOutput, output, name, rawArgs } - xem ghi chu
  // fix 23/08/2026 #2 tren day. Thay Map "output don gian" cu (khong con du
  // de chiu duoc thu tu den truoc/sau cua response-ended so voi handler
  // xong). `name`/`rawArgs` them 24/08/2026 #2 - can nho de handleDanhBoFlowDone()
  // biet tool/rawArgs GOC nao can goi lai sau khi danhBoFlow xong.
  const pending = new Map();

  // { name, rawArgs } cua tool-call GOC da lam ra DANH_BO_MISSING gan nhat -
  // xem ghi chu "them 24/08/2026 #2" dau file. Chi 1 slot (khong phai Map)
  // vi danh-bo-flow.js tu no da chi cho 1 luong thu thap tai 1 thoi diem
  // (start() bi bo qua neu dang arming/asking/confirming) - khop dung
  // "1 dispatcher = toi da 1 danhBoFlow dang cho retry" tai 1 thoi diem.
  let pendingDanhBoRetry = null;

  // [them 25/08/2026, Giai doan 8] Xem khoi comment "GIAI DOAN 8" dau file.
  // pendingCallAction: {kind:"end_call"|"transfer_to_agent", lyDo} cua hanh
  // dong CHO cau tam biet/thong bao noi xong, null neu khong co gi dang cho.
  // awaitingActionResponseId: true = response-started KE TIEP nhan duoc se
  // duoc gan cho pendingCallAction nay. actionResponseId: id THAT (sau khi
  // da biet) cua response can cho response-ended.
  let pendingCallAction = null;
  let awaitingActionResponseId = false;
  let actionResponseId = null;

  // [them 24/08/2026 #7] Dem so lan da tu dong moi khach doc LAI ma danh bo vi
  // LAN GOI LAI tool (sau khi xac nhan xong) that bai voi loi DU LIEU (xem
  // ghi chu dau file). Reset ve 0 moi khi 1 chu ky THU THAP MOI thuc su bat
  // dau (trong sayForOutput(), nhanh DANH_BO_MISSING) - KHONG reset o day khi
  // danhBoFlow.start() duoc goi lai TU handleDanhBoFlowDone() (nhanh loi du
  // lieu duoi day), de con dem dung so lan LIEN TIEP trong CUNG 1 chu ky.
  let danhBoLookupRetryCount = 0;

  function getPendingEntry(responseId) {
    let entry = pending.get(responseId);
    if (!entry) {
      entry = { ended: false, hasOutput: false, output: undefined };
      pending.set(responseId, entry);
    }
    return entry;
  }

  // [fix 23/08/2026] Quyet dinh CACH goi say() dua tren output cua tool -
  // dung chung cho ca nhanh binh thuong (cho response-ended) lan nhanh
  // phong thu (thieu responseId, goi say() ngay) de khong lech hanh vi
  // giua 2 nhanh.
  //
  // [them 24/08/2026 #2] Tham so thu 2 `callCtx` ({name, rawArgs} cua CHINH
  // tool-call dang xu ly) - CHI dung o nhanh DANH_BO_MISSING de nho lai vao
  // pendingDanhBoRetry (xem handleDanhBoFlowDone duoi day). Optional - cac
  // nhanh khac (action/doc_cho_khach/auto) khong doc callCtx.
  function sayForOutput(output, callCtx) {
    // [them 24/08/2026, Giai doan 6a] Kiem tra TRUOC ca action/doc_cho_khach
    // - DANH_BO_MISSING la tin hieu dac biet nhat (can CODE chiem lay
    // luot noi, khong de model tu do dat), du thuc te resolve-danh-bo-
    // ref.js hien khong bao gio tra dong thoi ca error_code lan action/
    // doc_cho_khach nen thu tu nay chua tung xung dot voi 2 nhanh duoi.
    if (output?.error_code === "DANH_BO_MISSING") {
      if (danhBoFlow) {
        log(
          "info",
          'dispatch-tool-call: tool tra ve DANH_BO_MISSING - CODE chu dong hoi lai danh bo qua danhBoFlow.start(), KHONG de model tu noi',
        );
        pendingDanhBoRetry = callCtx?.name ? { name: callCtx.name, rawArgs: callCtx.rawArgs } : null;
        danhBoLookupRetryCount = 0; // [them 24/08/2026 #7] chu ky thu thap MOI - reset dem loi tra cuu cua chu ky truoc (neu co)
        if (!pendingDanhBoRetry) {
          log(
            "warn",
            "dispatch-tool-call: DANH_BO_MISSING nhung thieu callCtx (name/rawArgs) - handleDanhBoFlowDone() se khong biet tool nao de goi lai sau khi xac nhan xong",
          );
        }
        danhBoFlow.start("DANH_BO_MISSING", now());
        return;
      }
      log(
        "warn",
        'dispatch-tool-call: tool tra ve DANH_BO_MISSING nhung KHONG co danhBoFlow duoc truyen vao createToolDispatcher() - giu hanh vi cu (say() de model tu xu ly)',
      );
    }
    if (output?.action === "no_reply") {
      log("info", 'dispatch-tool-call: tool tra ve action:"no_reply" - KHONG goi say(), de model im lang cho khach noi tiep');
      return;
    }

    // [them 25/08/2026, Giai doan 8] Xem khoi comment "GIAI DOAN 8" dau file
    // cho ly do KHONG return o day (van can chay tiep xuong doc_cho_khach/
    // say() ben duoi de THAT SU noi cau tam biet/thong bao - o day CHI dat
    // co "dang cho response nay noi xong" truoc khi say() duoc goi).
    if (output?.action === "end_call" || output?.action === "transfer_to_agent") {
      const hook = output.action === "end_call" ? onEndCall : onTransferToAgent;
      if (hook) {
        pendingCallAction = { kind: output.action, lyDo: output.ly_do };
        awaitingActionResponseId = true;
        log("info", `dispatch-tool-call: tool tra ve action:"${output.action}" - se goi API that (${output.action === "end_call" ? "hangupCall" : "referCall"}) sau khi cau tam biet/thong bao noi xong`);
      } else {
        log("warn", `dispatch-tool-call: tool tra ve action:"${output.action}" nhung KHONG co hook tuong ung duoc truyen vao createToolDispatcher() - chi noi loi, KHONG goi API that (giu hanh vi cu)`);
      }
    }

    if (output?.doc_cho_khach) {
      log("info", "dispatch-tool-call: tool co doc_cho_khach - goi say(mode:verbatim) doc nguyen van, khong de model tu dien dat");
      turnController.say({ mode: "verbatim", text: output.doc_cho_khach });
      return;
    }
    turnController.say();
  }

  // [them 25/08/2026, Giai doan 8] Goi THAT sau khi da xac nhan dung tin
  // hieu response-ended cua cau tam biet/thong bao - xem handleSignal() ben
  // duoi. Bat loi rieng (khong throw ra ngoai) - dung nguyen tac BAT BUOC
  // cua module nay: loi o day khong duoc lam sap cuoc goi (hangup/refer that
  // bai thi da khong con gi lam them duoc nua, chi con cach log lai).
  async function fireCallAction(action) {
    try {
      if (action.kind === "end_call" && onEndCall) {
        await onEndCall(action.lyDo);
        log("info", "dispatch-tool-call: da goi onEndCall() (hangupCall that) sau khi cau tam biet noi xong");
      } else if (action.kind === "transfer_to_agent" && onTransferToAgent) {
        await onTransferToAgent(action.lyDo);
        log("info", "dispatch-tool-call: da goi onTransferToAgent() (referCall that) sau khi cau thong bao noi xong");
      }
    } catch (err) {
      log("error", `dispatch-tool-call: ${action.kind} that bai: ${err.message}`);
    }
  }

  // Tra + goi dung 1 tool, LUON tra ve 1 object output (khong bao gio
  // throw) - tach rieng khoi handleSignal() de test duoc doc lap, khong
  // can gia lap send()/turnController.
  async function runTool(name, rawArgs) {
    const handler = handlers[name];
    if (!handler) {
      log("warn", `dispatch-tool-call: khong co handler cho tool "${name}"`);
      return { success: false, error_code: "TOOL_NOT_FOUND", message: `Khong ro tool "${name}".` };
    }

    let args;
    try {
      args = JSON.parse(rawArgs || "{}");
    } catch (err) {
      log("warn", `dispatch-tool-call: arguments JSON hong cho tool "${name}" (${rawArgs}): ${err.message}`);
      return { success: false, error_code: "INVALID_ARGUMENTS", message: "Tham so tool khong hop le." };
    }

    try {
      return await handler(args);
    } catch (err) {
      log("error", `dispatch-tool-call: handler "${name}" loi bat ngo: ${err.message}`);
      return { success: false, error_code: "HANDLER_ERROR", message: "Loi xu ly noi bo." };
    }
  }

  // Ham chinh - goi tu onSignal() cua caller (xem session-ws.js) moi khi
  // co tin hieu MOI, khong chi rieng tool-call-requested nua - can ca
  // response-ended de biet luc nao an toan goi say() (xem ghi chu dau
  // file). Cac kind khac bi bo qua im lang - caller truyen thang moi tin
  // hieu vao day ma khong can tu loc truoc.
  async function handleSignal(signal) {
    if (!signal || typeof signal.kind !== "string") return;

    if (signal.kind === "tool-call-requested") {
      const { callId, name, arguments: rawArgs, responseId } = signal;
      log("info", `dispatch-tool-call: goi tool "${name}" (callId=${callId}) voi input: ${rawArgs}`);

      // [fix 23/08/2026 #2] Dang ky entry NGAY, TRUOC khi await runTool() -
      // xem ghi chu dau file. Neu response-ended cua CHINH responseId nay
      // toi trong luc runTool() con dang cho (do tre mang that), entry da
      // co san de nhanh response-ended (duoi day) danh dau "ended" thay vi
      // bo qua vinh vien nhu code cu.
      const entry = responseId ? getPendingEntry(responseId) : null;

      const output = await runTool(name, rawArgs);
      log("info", `dispatch-tool-call: tool "${name}" (callId=${callId}) tra ve: ${JSON.stringify(output)}`);

      const outgoingItem = {
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      };
      log("info", `dispatch-tool-call: gui len OpenAI: ${JSON.stringify(outgoingItem)}`);
      send(outgoingItem);

      if (entry) {
        if (entry.ended) {
          // response-ended cua response nay DA toi truoc khi tool chay
          // xong (do tre mang that lon hon khoang cach function_call_
          // arguments.done -> response.done cua OpenAI) - khong con gi de
          // cho nua, goi say() NGAY.
          pending.delete(responseId);
          log(
            "info",
            `dispatch-tool-call: response ${responseId} da ket thuc TRUOC khi tool xong (do tre mang) - goi say() ngay`,
          );
          sayForOutput(output, { name, rawArgs });
        } else {
          entry.hasOutput = true;
          entry.output = output;
          entry.name = name;
          entry.rawArgs = rawArgs;
          log(
            "info",
            `dispatch-tool-call: da gui function_call_output, hoan say() toi khi response ${responseId} ket thuc`,
          );
        }
      } else {
        // Phong thu - chua thay xay ra voi du lieu that (turn-signal.js
        // luon dien responseId tu response_id cua event), nhung neu thieu
        // thi khong co gi de cho ca, goi say() ngay - van doc dung output
        // (action/doc_cho_khach) qua sayForOutput, khong lech hanh vi.
        log("warn", "dispatch-tool-call: tin hieu tool-call-requested thieu responseId, goi say() ngay (khong doi duoc)");
        sayForOutput(output, { name, rawArgs });
      }
      return;
    }

    // [them 25/08/2026, Giai doan 8] Xem khoi comment "GIAI DOAN 8" dau file.
    // PHAI dat TRUOC nhanh "tool-call-requested" o duoi trong thu tu code
    // (khong quan trong ve mat chay - day la nhanh if/else if rieng theo
    // signal.kind) nhung dat o day (ngay sau "response-started" concept) de
    // doc theo dung mach: dat co -> nhan response-started -> nhan response-
    // ended cua DUNG id do.
    if (signal.kind === "response-started") {
      if (awaitingActionResponseId) {
        actionResponseId = signal.responseId;
        awaitingActionResponseId = false;
        log(
          "info",
          `dispatch-tool-call: response ${signal.responseId} la cau tam biet/thong bao (${pendingCallAction?.kind}) - cho response-ended cua CHINH no roi moi goi API that`,
        );
      }
      return;
    }

    if (signal.kind === "response-ended") {
      // [them 25/08/2026, Giai doan 8] Kiem tra TRUOC ca nhanh `pending`
      // (tool-call) ben duoi - day la response KHAC (cau tam biet/thong
      // bao), khong nam trong Map `pending` (Map do chi khoa boi responseId
      // cua response CHUA tool-call goc).
      if (actionResponseId !== null && signal.responseId === actionResponseId) {
        const action = pendingCallAction;
        actionResponseId = null;
        pendingCallAction = null;
        if (action) {
          log("info", `dispatch-tool-call: response ${signal.responseId} (cau tam biet/thong bao) da noi xong - goi ${action.kind} THAT`);
          fireCallAction(action);
        }
        return;
      }

      const entry = pending.get(signal.responseId);
      if (!entry) return;
      if (entry.hasOutput) {
        pending.delete(signal.responseId);
        sayForOutput(entry.output, { name: entry.name, rawArgs: entry.rawArgs });
      } else {
        // Tool con dang chay (do tre mang that) - danh dau "da ket thuc",
        // de nhanh tool-call-requested (tren) tu goi say() ngay luc no xong.
        entry.ended = true;
      }
    }
  }

  // [them 24/08/2026 #2, Giai doan 6a] Xem thiet ke day du + vi du wiring o
  // ghi chu dau file (muc "them 24/08/2026 #2"). Ben goi (lop tich hop
  // that) goi ham nay tu onDone cua danhBoFlow SAU KHI da tu set
  // callState.danhBo (neu ok) va setVadMode("normal") - ham nay KHONG lam 2
  // viec do (khong nam giu callState/setVadMode, giu dung ranh gioi module).
  async function handleDanhBoFlowDone(result) {
    const pendingCall = pendingDanhBoRetry;
    pendingDanhBoRetry = null;

    if (!result?.ok) {
      log(
        "info",
        "dispatch-tool-call: danhBoFlow ket thuc KHONG thanh cong - danh-bo-flow.js#giveUp() da tu xin loi roi, khong noi gi them o day",
      );
      return;
    }

    if (!pendingCall) {
      log(
        "warn",
        "dispatch-tool-call: danhBoFlow thanh cong nhung KHONG co pendingDanhBoRetry - khong biet tool/rawArgs goc de tra cuu lai (kiem tra lai wiring: handleDanhBoFlowDone() chi nen duoc goi sau 1 lan DANH_BO_MISSING tu CHINH dispatcher nay)",
      );
      return;
    }

    const { name, rawArgs } = pendingCall;
    log("info", `dispatch-tool-call: danh bo da xac nhan - tra cuu lai tool "${name}" voi rawArgs goc: ${rawArgs}`);

    // [sua 24/08/2026 #4, PHAT HIEN THAT qua checkpoint-giai-doan-6a.mjs
    // chay that lan 3 - xem ghi chu day du trong turn-controller.js#build
    // ResponsePayload "sua 24/08/2026 #4"] CA 4 say() trong ham nay deu them
    // toolChoice:"none" - vi CHINH CODE (runTool() ngay duoi day) da tu lam
    // tron ven viec tra cuu, KHONG luot noi nao o day can/duoc phep de model
    // TU Y goi them tool nao ca (kem ca chinh get_bill) - bug da quan sat
    // that: preamble "se tra cuu ngay" (thieu tool_choice:"none") vo tinh bi
    // model hieu la chi thi HANH DONG, tu bia 1 loi goi get_bill (voi danh
    // bo doan sai) chay dua voi lan goi TRUC TIEP cua runTool() ben duoi.

    // Preamble NGAN truoc khi goi lai (mode "guided", KHONG verbatim - xem
    // giai thich "QUYET DINH THIET KE" dau file) - che do tre mang that
    // (~2483ms da do duoc, xem fix 23/08/2026 #2) truoc khi co ket qua that.
    turnController.say({ mode: "guided", instructions: RETRY_PREAMBLE_INSTRUCTIONS, toolChoice: "none" });

    const output = await runTool(name, rawArgs);
    log("info", `dispatch-tool-call: tra cuu lai "${name}" tra ve: ${JSON.stringify(output)}`);

    if (output?.action === "no_reply") {
      log("info", 'dispatch-tool-call: tra cuu lai tra ve action:"no_reply" - khong say() ket qua');
      return;
    }
    if (output?.doc_cho_khach) {
      turnController.say({ mode: "verbatim", text: output.doc_cho_khach, toolChoice: "none" });
      return;
    }

    // [them 24/08/2026 #7] Xem QUYET DINH THIET KE + taxonomy error_code o
    // dau file. PHAI kiem tra TRUOC nhanh output.message duoi day - ca output
    // THANH CONG (billing.js#handleGetBill) lan THAT BAI (billing.js#fetchBilling
    // tra ve qua handleGetBill) deu co truong `message`, nen chi dung "co
    // message hay khong" se KHONG phan biet duoc 2 truong hop nay.
    if (output?.success === false) {
      if (LOOKUP_SYSTEM_ERROR_CODES.has(output.error_code)) {
        log(
          "warn",
          `dispatch-tool-call: tra cuu lai "${name}" that bai LOI HE THONG (error_code=${output.error_code}) - xin loi + chuyen may ngay, KHONG moi doc lai (doc lai vo ich, khong lien quan dung/sai so)`,
        );
        turnController.say({ mode: "verbatim", text: LOOKUP_SYSTEM_ERROR_TEXT, toolChoice: "none" });
        return;
      }

      danhBoLookupRetryCount += 1;
      if (!danhBoFlow || danhBoLookupRetryCount > MAX_DANH_BO_LOOKUP_RETRIES) {
        log(
          "warn",
          `dispatch-tool-call: tra cuu lai "${name}" that bai LOI DU LIEU (error_code=${output.error_code ?? "khong ro"}) va da het luot moi doc lai (${danhBoLookupRetryCount}/${MAX_DANH_BO_LOOKUP_RETRIES}${danhBoFlow ? "" : ", khong co danhBoFlow"}) - xin loi + chuyen may`,
        );
        turnController.say({ mode: "verbatim", text: LOOKUP_RETRY_EXHAUSTED_TEXT, toolChoice: "none" });
        return;
      }

      log(
        "info",
        `dispatch-tool-call: tra cuu lai "${name}" that bai LOI DU LIEU (error_code=${output.error_code ?? "khong ro"}) - CODE tu moi khach doc lai ma danh bo (lan ${danhBoLookupRetryCount}/${MAX_DANH_BO_LOOKUP_RETRIES})`,
      );
      pendingDanhBoRetry = { name, rawArgs };
      turnController.say({ mode: "guided", instructions: LOOKUP_DATA_ERROR_PREAMBLE_INSTRUCTIONS, toolChoice: "none" });
      danhBoFlow.start("DANH_BO_LOOKUP_FAILED", now());
      return;
    }

    if (output?.message) {
      // Doc DUNG nguyen van output.message (verbatim) - KHONG de model tu
      // dien dat lai, xem "QUYET DINH THIET KE" dau file (docTienVN/so
      // tien/ngay thang da duoc code dinh dang RIENG cho TTS).
      turnController.say({ mode: "verbatim", text: output.message, toolChoice: "none" });
      return;
    }
    // Phong thu - ca 4 tool bi chan boi DANH_BO_MISSING (get_bill/
    // compare_usage/get_outages/create_ticket) deu da co san output.message
    // (xem billing.js/outages.js/tickets.js) nen nhanh nay khong nen xay ra
    // trong thuc te - con hon im lang neu vo tinh xay ra.
    log("warn", `dispatch-tool-call: tra cuu lai "${name}" khong co output.message - dung guided doc tu output tho`);
    turnController.say({
      mode: "guided",
      instructions: `Doc ket qua sau cho khach bang loi tu nhien, day du, khong them thong tin ngoai: ${JSON.stringify(output)}`,
      toolChoice: "none",
    });
  }

  return { handleSignal, runTool, handleDanhBoFlowDone };
}
