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
// CO Y CHUA XU LY: action:"end_call"/"transfer_to_agent" - can goi API
// that de cup/chuyen may (SIP that, Giai doan 8 chua toi) nen tam thoi
// VAN goi say() nhu binh thuong cho 2 action nay (giong nhu khong co
// action gi ca) - se xu ly khi noi SIP that.
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
export function createToolDispatcher({ send, turnController, log = () => {}, handlers = {} } = {}) {
  // responseId -> { ended, hasOutput, output } - xem ghi chu fix 23/08/2026
  // #2 tren day. Thay Map "output don gian" cu (khong con du de chiu
  // duoc thu tu den truoc/sau cua response-ended so voi handler xong).
  const pending = new Map();

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
  function sayForOutput(output) {
    if (output?.action === "no_reply") {
      log("info", 'dispatch-tool-call: tool tra ve action:"no_reply" - KHONG goi say(), de model im lang cho khach noi tiep');
      return;
    }
    if (output?.doc_cho_khach) {
      log("info", "dispatch-tool-call: tool co doc_cho_khach - goi say(mode:verbatim) doc nguyen van, khong de model tu dien dat");
      turnController.say({ mode: "verbatim", text: output.doc_cho_khach });
      return;
    }
    turnController.say();
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
          sayForOutput(output);
        } else {
          entry.hasOutput = true;
          entry.output = output;
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
        sayForOutput(output);
      }
      return;
    }

    if (signal.kind === "response-ended") {
      const entry = pending.get(signal.responseId);
      if (!entry) return;
      if (entry.hasOutput) {
        pending.delete(signal.responseId);
        sayForOutput(entry.output);
      } else {
        // Tool con dang chay (do tre mang that) - danh dau "da ket thuc",
        // de nhanh tool-call-requested (tren) tu goi say() ngay luc no xong.
        entry.ended = true;
      }
    }
  }

  return { handleSignal, runTool };
}
