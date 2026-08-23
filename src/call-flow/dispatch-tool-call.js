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
export function createToolDispatcher({ send, turnController, log = () => {}, handlers = {} } = {}) {
  // responseId dang "no" 1 lan goi say(), cho toi khi thay dung response-
  // ended cua no - xem ghi chu tren dau file.
  const waitingForResponseEnded = new Set();

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
      const output = await runTool(name, rawArgs);

      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      });

      if (responseId) {
        waitingForResponseEnded.add(responseId);
        log(
          "info",
          `dispatch-tool-call: da gui function_call_output, hoan say() toi khi response ${responseId} ket thuc`,
        );
      } else {
        // Phong thu - chua thay xay ra voi du lieu that (turn-signal.js
        // luon dien responseId tu response_id cua event), nhung neu thieu
        // thi khong co gi de cho ca, giu hanh vi cu: goi say() ngay.
        log("warn", "dispatch-tool-call: tin hieu tool-call-requested thieu responseId, goi say() ngay (khong doi duoc)");
        turnController.say();
      }
      return;
    }

    if (signal.kind === "response-ended" && waitingForResponseEnded.has(signal.responseId)) {
      waitingForResponseEnded.delete(signal.responseId);
      turnController.say();
    }
  }

  return { handleSignal, runTool };
}
