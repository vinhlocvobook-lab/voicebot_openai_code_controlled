// test/dispatch-tool-call.test.mjs
//
// Giai doan 5a (xem docs/roadmap.md). Test createToolDispatcher() bang
// handler/gia lap - KHONG goi tongdai-api.js/OpenAI that. Trong tam:
// dung 4 buoc (tra handler -> parse arguments -> goi handler -> gui
// function_call_output + say()) va nguyen tac "loi o day khong duoc lam
// sap cuoc goi" (giong tongdai-api.js/calllog-api.js).
//
// [fix 22/08/2026] say() KHONG con duoc goi ngay sau function_call_output
// nua - phai doi dung tin hieu response-ended cua CHINH response chua
// tool-call do (xem ghi chu dau src/call-flow/dispatch-tool-call.js, xac
// nhan bang checkpoint-giai-doan-5a.mjs chay that + sequence diagram).
// Cac test duoi day vi vay them buoc: goi tool-call-requested -> kiem tra
// sayCalls VAN CON RONG -> goi response-ended DUNG responseId -> kiem tra
// sayCalls moi len 1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolDispatcher } from "../src/call-flow/dispatch-tool-call.js";

function makeFakes(handlers) {
  const sent = [];
  const sayCalls = [];
  const logCalls = [];
  const dispatcher = createToolDispatcher({
    send: (obj) => sent.push(obj),
    turnController: { say: (opts) => sayCalls.push(opts) },
    log: (level, msg) => logCalls.push({ level, msg }),
    handlers,
  });
  return { dispatcher, sent, sayCalls, logCalls };
}

test("tool co handler, arguments hop le -> goi dung handler, gui function_call_output dung call_id, CHUA say() ngay, chi say() sau khi response ket thuc", async () => {
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
  assert.equal(sayCalls.length, 0, "CHUA duoc say() ngay - phai doi response-ended (fix 22/08/2026)");

  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_1", status: "completed" });
  assert.equal(sayCalls.length, 1, "say() dung 1 lan sau khi thay response-ended dung responseId");
});

test("tool khong co trong bang handlers -> tra loi TOOL_NOT_FOUND, van gui, va van say() sau khi response ket thuc (khong throw)", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({});

  await assert.doesNotReject(() =>
    dispatcher.handleSignal({
      kind: "tool-call-requested",
      responseId: "resp_2",
      callId: "call_2",
      name: "get_outages",
      arguments: "{}",
    }),
  );

  const output = JSON.parse(sent[0].item.output);
  assert.equal(output.success, false);
  assert.equal(output.error_code, "TOOL_NOT_FOUND");
  assert.equal(sayCalls.length, 0);

  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_2", status: "completed" });
  assert.equal(sayCalls.length, 1);
});

test("arguments JSON hong -> tra loi INVALID_ARGUMENTS, khong goi handler, khong throw, van say() dung lich", async () => {
  let handlerCalled = false;
  const { dispatcher, sent, sayCalls } = makeFakes({
    get_bill: async () => {
      handlerCalled = true;
      return { success: true };
    },
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_3",
    callId: "call_3",
    name: "get_bill",
    arguments: "{khong phai json hop le",
  });

  assert.equal(handlerCalled, false, "khong duoc goi handler khi arguments hong");
  const output = JSON.parse(sent[0].item.output);
  assert.equal(output.success, false);
  assert.equal(output.error_code, "INVALID_ARGUMENTS");
  assert.equal(sayCalls.length, 0);

  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_3", status: "completed" });
  assert.equal(sayCalls.length, 1);
});

test("arguments rong ('') -> coi nhu {} (khong crash) - vd tool khong can tham so", async () => {
  const { dispatcher, sent } = makeFakes({
    wait_for_user: async (args) => ({ success: true, receivedArgs: args }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_4",
    callId: "call_4",
    name: "wait_for_user",
    arguments: "",
  });

  const output = JSON.parse(sent[0].item.output);
  assert.deepEqual(output.receivedArgs, {});
});

test("handler that bai (throw) -> tra loi HANDLER_ERROR, KHONG throw ra ngoai (loi khong duoc lam sap cuoc goi), van say() dung lich sau response-ended", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({
    get_bill: async () => {
      throw new Error("tongdai-api sap");
    },
  });

  await assert.doesNotReject(() =>
    dispatcher.handleSignal({ kind: "tool-call-requested", responseId: "resp_5", callId: "call_5", name: "get_bill", arguments: "{}" }),
  );

  const output = JSON.parse(sent[0].item.output);
  assert.equal(output.success, false);
  assert.equal(output.error_code, "HANDLER_ERROR");
  assert.equal(sayCalls.length, 0, "chua say() ngay du handler loi - van phai cho response ket thuc");

  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_5", status: "completed" });
  assert.equal(sayCalls.length, 1, "van phai say() sau cung de model biet ma tiep tuc, khong de cuoc goi treo");
});

test("tin hieu khong phai kind tool-call-requested/response-ended cho response dang cho -> bo qua im lang, khong gui gi, khong say()", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({ get_bill: async () => ({ success: true }) });

  // response-ended cho 1 responseId CHUA TUNG co tool-call-requested nao
  // dang cho - khong duoc coi la "no" gi ca, bo qua.
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_khong_lien_quan", status: "completed" });
  await dispatcher.handleSignal(null);
  await dispatcher.handleSignal({ kind: "speech-started", atMs: 0 });

  assert.equal(sent.length, 0);
  assert.equal(sayCalls.length, 0);
});

test("response-ended cua 1 response KHAC (khong khop responseId dang cho) khong lam say() som - phai dung response dung moi say()", async () => {
  const { dispatcher, sent, sayCalls } = makeFakes({
    get_bill: async () => ({ success: true }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_A",
    callId: "call_A",
    name: "get_bill",
    arguments: "{}",
  });
  assert.equal(sayCalls.length, 0);

  // response-ended cua 1 response KHONG lien quan (vd response truoc do
  // con dang don dep) - khong duoc "an nham" vao hang doi cua resp_A.
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_khac_khong_phai_A", status: "completed" });
  assert.equal(sayCalls.length, 0, "response-ended sai responseId khong duoc kich say()");

  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_A", status: "completed" });
  assert.equal(sayCalls.length, 1, "response-ended DUNG responseId moi kich say()");
});

test("[phong thu] tin hieu tool-call-requested THIEU responseId (khong nen xay ra voi du lieu that) -> say() ngay, khong co gi de cho", async () => {
  const { dispatcher, sayCalls } = makeFakes({ get_bill: async () => ({ success: true }) });

  await dispatcher.handleSignal({ kind: "tool-call-requested", callId: "call_no_resp", name: "get_bill", arguments: "{}" });

  assert.equal(sayCalls.length, 1, "khong co responseId de cho thi giu hanh vi cu: say() ngay");
});

test("[Giai doan 5a] dung DUNG tin hieu that (copy tu logs/probe-tool-call-1787384731754.jsonl) voi handler gia -> vong doi day du, say() dung sau response-ended that", async () => {
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
  assert.equal(sayCalls.length, 0, "phai doi response-ended that cua resp_EFahxMiakpgtNmPzvHapH");

  // response.done that cua CHINH response chua tool-call nay (xem
  // logs/probe-tool-call-1787384731754.jsonl, response.status:"completed").
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_EFahxMiakpgtNmPzvHapH", status: "completed" });
  assert.equal(sayCalls.length, 1);
});

test("[fix 23/08/2026] runTool() tra ve gi duoc log('info') day du - khong con chi thay dong 'da gui function_call_output' trong khong biet tool tra ve so tien bao nhieu", async () => {
  const { dispatcher, logCalls } = makeFakes({
    get_bill: async (args) => ({ success: true, data: [{ ma_danh_bo: args.ma_danh_bo, tong_tien: 185000 }] }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_9",
    callId: "call_9",
    name: "get_bill",
    arguments: '{"ma_danh_bo":"22082351775"}',
  });

  const outputLog = logCalls.find((c) => c.msg.includes("tra ve"));
  assert.ok(outputLog, "phai co 1 dong log ghi lai ket qua tool tra ve");
  assert.equal(outputLog.level, "info");
  assert.match(outputLog.msg, /get_bill/);
  assert.match(outputLog.msg, /call_9/);
  assert.match(outputLog.msg, /185000/, "phai thay duoc so tien that trong log, khong chi bao 'da gui'");
});

test("runTool() dung doc lap (khong can send/turnController gia) - tien ich khi debug rieng 1 tool", async () => {
  const { dispatcher } = makeFakes({ get_bill: async (args) => ({ success: true, echo: args }) });

  const output = await dispatcher.runTool("get_bill", '{"ma_danh_bo":"123"}');
  assert.deepEqual(output, { success: true, echo: { ma_danh_bo: "123" } });

  const notFound = await dispatcher.runTool("khong_ton_tai", "{}");
  assert.equal(notFound.error_code, "TOOL_NOT_FOUND");
});
