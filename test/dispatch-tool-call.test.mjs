// test/dispatch-tool-call.test.mjs
//
// Giai doan 5a (xem docs/roadmap.md). Test createToolDispatcher() bang
// handler/gia lap - KHONG goi tongdai-api.js/OpenAI that. Trong tam:
// dung 4 buoc (tra handler -> parse arguments -> goi handler -> gui
// function_call_output + say()) va nguyen tac "loi o day khong duoc lam
// sap cuoc goi" (giong tongdai-api.js/calllog-api.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolDispatcher } from "../src/call-flow/dispatch-tool-call.js";

function makeFakes(handlers) {
  const sent = [];
  const sayCalls = [];
  const dispatcher = createToolDispatcher({
    send: (obj) => sent.push(obj),
    turnController: { say: (opts) => sayCalls.push(opts) },
    handlers,
  });
  return { dispatcher, sent, sayCalls };
}

test("tool co handler, arguments hop le -> goi dung handler, gui function_call_output dung call_id, roi say()", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({
    get_bill: async (args) => ({ success: true, data: [{ ma_danh_bo: args.ma_danh_bo, tong_tien: 185000 }] }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_1",
    itemId: "item_1",
    callId: "call_1",
    name: "get_bill",
    arguments: '{"ma_danh_bo":"22082351775","ky":8,"nam":2026}',
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "conversation.item.create");
  assert.equal(sent[0].item.type, "function_call_output");
  assert.equal(sent[0].item.call_id, "call_1");
  assert.deepEqual(JSON.parse(sent[0].item.output), {
    success: true,
    data: [{ ma_danh_bo: "22082351775", tong_tien: 185000 }],
  });
  assert.equal(sayCalls.length, 1, "phai goi turnController.say() de model noi tiep");
});

test("tool khong co trong bang handlers -> tra loi TOOL_NOT_FOUND, van gui + say(), khong throw", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({});

  await assert.doesNotReject(() =>
    dispatcher.handleSignal({
      kind: "tool-call-requested",
      callId: "call_2",
      name: "get_outages",
      arguments: "{}",
    }),
  );

  const output = JSON.parse(sent[0].item.output);
  assert.equal(output.success, false);
  assert.equal(output.error_code, "TOOL_NOT_FOUND");
  assert.equal(sayCalls.length, 1);
});

test("arguments JSON hong -> tra loi INVALID_ARGUMENTS, khong goi handler, khong throw", async () => {
  let handlerCalled = false;
  const { dispatcher, sent, sayCalls } = makeFakes({
    get_bill: async () => {
      handlerCalled = true;
      return { success: true };
    },
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    callId: "call_3",
    name: "get_bill",
    arguments: "{khong phai json hop le",
  });

  assert.equal(handlerCalled, false, "khong duoc goi handler khi arguments hong");
  const output = JSON.parse(sent[0].item.output);
  assert.equal(output.success, false);
  assert.equal(output.error_code, "INVALID_ARGUMENTS");
  assert.equal(sayCalls.length, 1);
});

test("arguments rong ('') -> coi nhu {} (khong crash) - vd tool khong can tham so", async () => {
  const { dispatcher, sent } = makeFakes({
    wait_for_user: async (args) => ({ success: true, receivedArgs: args }),
  });

  await dispatcher.handleSignal({ kind: "tool-call-requested", callId: "call_4", name: "wait_for_user", arguments: "" });

  const output = JSON.parse(sent[0].item.output);
  assert.deepEqual(output.receivedArgs, {});
});

test("handler that bai (throw) -> tra loi HANDLER_ERROR, KHONG throw ra ngoai (loi khong duoc lam sap cuoc goi)", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({
    get_bill: async () => {
      throw new Error("tongdai-api sap");
    },
  });

  await assert.doesNotReject(() =>
    dispatcher.handleSignal({ kind: "tool-call-requested", callId: "call_5", name: "get_bill", arguments: "{}" }),
  );

  const output = JSON.parse(sent[0].item.output);
  assert.equal(output.success, false);
  assert.equal(output.error_code, "HANDLER_ERROR");
  assert.equal(sayCalls.length, 1, "van phai say() de model biet ma tiep tuc, khong de cuoc goi treo");
});

test("tin hieu khong phai kind tool-call-requested -> bo qua im lang, khong gui gi, khong say()", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({ get_bill: async () => ({ success: true }) });

  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_1", status: "completed" });
  await dispatcher.handleSignal(null);

  assert.equal(sent.length, 0);
  assert.equal(sayCalls.length, 0);
});

test("[Giai doan 5a] dung DUNG tin hieu that (copy tu logs/probe-tool-call-1787384731754.jsonl) voi handler gia -> vong doi day du", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({
    get_bill: async (args) => ({
      success: true,
      data: [{ ky: args.ky, nam: args.nam, tong_tien: 185000, da_thanh_toan: false, san_luong_m3: 14 }],
    }),
  });

  // Tin hieu that, dung nguyen normalizeTurnEvent tra ve tu event
  // response.function_call_arguments.done that (xem test/turn-signal.test.mjs).
  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_EFahxMiakpgtNmPzvHapH",
    itemId: "item_EFahyuVgcPeg9MMUDJytp",
    callId: "call_EUrhQ1XPvYSRzx2k",
    name: "get_bill",
    arguments: '{"ma_danh_bo":"22082351775","ky":8,"nam":2026}',
  });

  assert.equal(sent[0].item.call_id, "call_EUrhQ1XPvYSRzx2k");
  const output = JSON.parse(sent[0].item.output);
  assert.equal(output.data[0].ky, 8);
  assert.equal(output.data[0].nam, 2026);
  assert.equal(sayCalls.length, 1);
});

test("runTool() dung doc lap (khong can send/turnController gia) - tien ich khi debug rieng 1 tool", async () => {
  const { dispatcher } = makeFakes({ get_bill: async (args) => ({ success: true, echo: args }) });

  const output = await dispatcher.runTool("get_bill", '{"ma_danh_bo":"123"}');
  assert.deepEqual(output, { success: true, echo: { ma_danh_bo: "123" } });

  const notFound = await dispatcher.runTool("khong_ton_tai", "{}");
  assert.equal(notFound.error_code, "TOOL_NOT_FOUND");
});
