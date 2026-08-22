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

export function createToolDispatcher({ send, turnController, log = () => {}, handlers = {} } = {}) {
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
  // gap tin hieu kind:"tool-call-requested". Bo qua im lang neu tin hieu
  // khong dung kind - de caller co the truyen thang moi tin hieu vao day
  // ma khong can tu loc truoc.
  async function handleSignal(signal) {
    if (!signal || signal.kind !== "tool-call-requested") return;

    const { callId, name, arguments: rawArgs } = signal;
    const output = await runTool(name, rawArgs);

    send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
    });
    turnController.say();
  }

  return { handleSignal, runTool };
}
