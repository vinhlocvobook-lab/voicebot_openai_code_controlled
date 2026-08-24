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
//
// [fix 23/08/2026 #2] Phat hien BANG checkpoint-giai-doan-5b.mjs/-audio.mjs
// chay THAT voi tongdai-api.js that: response-ended co the toi TRUOC khi
// handler that (co do tre mang) chay xong - cac test 5a phia tren deu
// dung handler gan nhu tuc thoi nen KHONG lo ra truong hop nay. Xem 2 test
// rieng cuoi file (truoc test runTool doc lap) dung Promise treo (resolve
// boi tay) de mo phong dung thu tu that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolDispatcher } from "../src/call-flow/dispatch-tool-call.js";

function makeFakes(handlers, extra = {}) {
  const sent = [];
  const sayCalls = [];
  const logCalls = [];
  const dispatcher = createToolDispatcher({
    send: (obj) => sent.push(obj),
    turnController: { say: (opts) => sayCalls.push(opts) },
    log: (level, msg) => logCalls.push({ level, msg }),
    handlers,
    ...extra,
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

  const outputLog = logCalls.find((c) => c.msg.includes("tra ve") && !c.msg.includes("gui len OpenAI"));
  assert.ok(outputLog, "phai co 1 dong log ghi lai ket qua tool tra ve");
  assert.equal(outputLog.level, "info");
  assert.match(outputLog.msg, /get_bill/);
  assert.match(outputLog.msg, /call_9/);
  assert.match(outputLog.msg, /185000/, "phai thay duoc so tien that trong log, khong chi bao 'da gui'");
});

test("[bo sung 23/08/2026] input goi tool duoc log('info') NGAY khi tin hieu tool-call-requested toi, truoc ca khi handler chay xong", async () => {
  const { dispatcher, logCalls } = makeFakes({
    get_bill: async (args) => ({ success: true, data: [{ ma_danh_bo: args.ma_danh_bo }] }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_10",
    callId: "call_10",
    name: "get_bill",
    arguments: '{"ma_danh_bo":"22082351775","ky":8}',
  });

  const inputLog = logCalls.find((c) => c.msg.includes("voi input"));
  assert.ok(inputLog, "phai co 1 dong log ghi lai input nhan duoc");
  assert.equal(inputLog.level, "info");
  assert.match(inputLog.msg, /get_bill/);
  assert.match(inputLog.msg, /call_10/);
  assert.match(inputLog.msg, /22082351775/, "phai thay duoc chinh xac arguments tho model gui, khong phai ban da xu ly");

  // Input phai duoc log TRUOC output trong thu tu logCalls - dung dung
  // trinh tu thuc te (log input roi moi goi handler).
  const inputIdx = logCalls.findIndex((c) => c.msg.includes("voi input"));
  const outputIdx = logCalls.findIndex((c) => c.msg.includes("tra ve") && !c.msg.includes("gui len OpenAI"));
  assert.ok(inputIdx < outputIdx, "input phai duoc log truoc output, dung thu tu thuc thi");
});

test("[bo sung 23/08/2026] payload THAT gui len OpenAI (conversation.item.create) duoc log('info') day du, khac voi log ket qua tool tra ve", async () => {
  const { dispatcher, sent, logCalls } = makeFakes({
    get_bill: async () => ({ success: true, data: [{ tong_tien: 185000 }] }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_11",
    callId: "call_11",
    name: "get_bill",
    arguments: "{}",
  });

  const wireLog = logCalls.find((c) => c.msg.includes("gui len OpenAI"));
  assert.ok(wireLog, "phai co 1 dong log rieng ghi lai payload that gui len OpenAI");
  assert.equal(wireLog.level, "info");

  // Dong log nay phai KHOP CHINH XAC voi nhung gi send() thuc su nhan -
  // khong phai 1 ban dien giai rieng, tranh lech giua "noi se gui" va
  // "that su gui" (chinh loai loi ma dong log nay sinh ra de bat).
  const loggedPayload = JSON.parse(wireLog.msg.replace("dispatch-tool-call: gui len OpenAI: ", ""));
  assert.deepEqual(loggedPayload, sent[0]);
  assert.equal(loggedPayload.item.call_id, "call_11");
});

// ─── [fix 23/08/2026] doc action/doc_cho_khach tu output cua tool ─────────

test("[fix 23/08/2026] tool tra ve action:'no_reply' (vd wait_for_user) -> KHONG goi say() sau khi response ket thuc", async () => {
  const { dispatcher, sayCalls } = makeFakes({
    wait_for_user: async () => ({ success: true, action: "no_reply", message: "im lang cho khach" }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_no_reply",
    callId: "call_no_reply",
    name: "wait_for_user",
    arguments: "{}",
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_no_reply", status: "completed" });

  assert.equal(sayCalls.length, 0, "action:no_reply phai chan say(), khong duoc goi du response da ket thuc");
});

test("[fix 23/08/2026] tool tra ve doc_cho_khach -> say({mode:'verbatim', text: doc_cho_khach}) thay vi mode auto", async () => {
  const { dispatcher, sayCalls } = makeFakes({
    get_procedure_info: async () => ({ success: true, doc_cho_khach: "Dạ, thủ tục này cần giấy tờ ABC." }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_verbatim",
    callId: "call_verbatim",
    name: "get_procedure_info",
    arguments: "{}",
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_verbatim", status: "completed" });

  assert.equal(sayCalls.length, 1);
  assert.deepEqual(sayCalls[0], { mode: "verbatim", text: "Dạ, thủ tục này cần giấy tờ ABC." });
});

test("[fix 23/08/2026] tool KHONG co action/doc_cho_khach -> giu hanh vi cu, say() mode auto (khong tham so)", async () => {
  const { dispatcher, sayCalls } = makeFakes({
    get_bill: async () => ({ success: true, message: "Kỳ 8: 200.000đ" }),
  });

  await dispatcher.handleSignal({ kind: "tool-call-requested", responseId: "resp_auto", callId: "call_auto", name: "get_bill", arguments: "{}" });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_auto", status: "completed" });

  assert.equal(sayCalls.length, 1);
  assert.deepEqual(sayCalls[0], undefined, "say() goi khong tham so (mode auto mac dinh), giong hanh vi truoc ban fix nay");
});

test("[fix 23/08/2026] action:'end_call'/'transfer_to_agent' CHUA duoc xu ly rieng - van say() nhu binh thuong (cho toi Giai doan 8 noi SIP that)", async () => {
  const { dispatcher, sayCalls } = makeFakes({
    end_call: async () => ({ success: true, action: "end_call", message: "Kết thúc cuộc gọi." }),
  });

  await dispatcher.handleSignal({ kind: "tool-call-requested", responseId: "resp_end", callId: "call_end", name: "end_call", arguments: "{}" });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_end", status: "completed" });

  assert.equal(sayCalls.length, 1, "action:end_call chua co xu ly rieng, van say() binh thuong (co y, xem comment dau file)");
});

test("[fix 23/08/2026] action:no_reply van ap dung dung ca o nhanh phong thu (thieu responseId, say() ngay)", async () => {
  const { dispatcher, sayCalls } = makeFakes({
    wait_for_user: async () => ({ success: true, action: "no_reply" }),
  });

  await dispatcher.handleSignal({ kind: "tool-call-requested", callId: "call_no_resp_id", name: "wait_for_user", arguments: "{}" });

  assert.equal(sayCalls.length, 0, "du khong co responseId de cho, action:no_reply van phai chan say()");
});

// ─── [fix 23/08/2026 #2] race: response-ended toi TRUOC khi handler that ──
// (co do tre mang) chay xong - phat hien BANG checkpoint-giai-doan-5b.mjs/
// -audio.mjs chay that voi tongdai-api.js that (xem ghi chu dau src/call-
// flow/dispatch-tool-call.js). Cac test 5a phia tren deu dung handler gan
// nhu tuc thoi nen KHONG bao gio lo ra race nay - can handler tra ve
// Promise CHU DONG treo (resolve boi tay) de mo phong dung thu tu that.

test("[fix 23/08/2026 #2] response-ended CUA CHINH response chua tool-call toi TRUOC khi handler that (co do tre mang) chay xong -> say() van duoc goi dung luc handler xong, khong bi mat vinh vien", async () => {
  let resolveHandler;
  const handlerPromise = new Promise((resolve) => {
    resolveHandler = resolve;
  });
  const { dispatcher, sayCalls } = makeFakes({
    get_bill: async () => {
      await handlerPromise; // mo phong do tre mang that (vd 2483ms o du lieu that)
      return { success: true, message: "du lieu that ve sau khi response da dong" };
    },
  });

  // KHONG await - handler dang "treo", nhung entry cho responseId nay da
  // duoc dang ky NGAY (truoc await dau tien ben trong handleSignal, xem
  // fix 23/08/2026 #2).
  const toolPromise = dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_race",
    callId: "call_race",
    name: "get_bill",
    arguments: "{}",
  });

  // response-ended cua DUNG response nay toi TRUOC khi handler xong - dung
  // thu tu da quan sat that (OpenAI dong response ngay sau khi model phat
  // xong function_call_arguments, KHONG doi tool chay xong).
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_race", status: "completed" });
  assert.equal(sayCalls.length, 0, "response-ended toi som nhung handler CHUA xong - chua duoc say() voi output chua san sang");

  // Handler that su xong (do tre mang da qua) - say() PHAI duoc goi ngay
  // luc nay, KHONG duoc treo mai (day chinh la bug da sua - truoc day
  // response-ended toi som se bi bo qua vinh vien, cuoc goi treo toi timeout).
  resolveHandler();
  await toolPromise;
  assert.equal(sayCalls.length, 1, "response-ended toi TRUOC handler van phai duoc say() dung luc handler xong");
});

test("[fix 23/08/2026 #2] 2 response khac nhau, 1 cai response-ended toi som (truoc handler xong) 1 cai toi muon (sau handler xong) - moi cai deu say() dung 1 lan, khong lan sang nhau", async () => {
  let resolveSlow;
  const slowPromise = new Promise((resolve) => {
    resolveSlow = resolve;
  });
  const { dispatcher, sayCalls, sent } = makeFakes({
    get_bill: async ({ ma_danh_bo }) => {
      if (ma_danh_bo === "cham") await slowPromise;
      return { success: true, message: `ket qua cho ${ma_danh_bo}` };
    },
  });

  // Response "cham" - response-ended toi TRUOC khi handler xong.
  const slowToolPromise = dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_cham",
    callId: "call_cham",
    name: "get_bill",
    arguments: '{"ma_danh_bo":"cham"}',
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_cham", status: "completed" });
  assert.equal(sayCalls.length, 0);

  // Response "nhanh" - thu tu binh thuong, handler xong truoc, response-
  // ended toi sau (giong het cac test 5a khac).
  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_nhanh",
    callId: "call_nhanh",
    name: "get_bill",
    arguments: '{"ma_danh_bo":"nhanh"}',
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_nhanh", status: "completed" });
  assert.equal(sayCalls.length, 1, "response nhanh phai say() dung lich, khong bi anh huong boi response cham dang treo");

  resolveSlow();
  await slowToolPromise;
  assert.equal(sayCalls.length, 2, "response cham cuoi cung cung phai say(), dung 1 lan, khong lan them lan nao");

  const outputs = sent.map((s) => JSON.parse(s.item.output).message);
  assert.deepEqual(outputs.sort(), ["ket qua cho cham", "ket qua cho nhanh"], "output dung khop voi tung response, khong bi tron lan");
});

// ─── [them 24/08/2026, Giai doan 6a] DANH_BO_MISSING -> danhBoFlow.start() ──
// Xem ghi chu dau src/call-flow/dispatch-tool-call.js (2 tham so factory moi
// danhBoFlow/now) va src/domain/resolve-danh-bo-ref.js (nguon that su tao ra
// output.error_code === "DANH_BO_MISSING").

test("[Giai doan 6a] tool tra ve error_code DANH_BO_MISSING, CO danhBoFlow -> goi danhBoFlow.start() thay vi turnController.say(), dung nowMs tu tham so now()", async () => {
  const startCalls = [];
  const danhBoFlow = { start: (reason, nowMs) => startCalls.push({ reason, nowMs }) };
  const { dispatcher, sayCalls } = makeFakes(
    { get_bill: async () => ({ success: false, error_code: "DANH_BO_MISSING", message: "Chưa có mã danh bộ." }) },
    { danhBoFlow, now: () => 123456 },
  );

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_missing",
    callId: "call_missing",
    name: "get_bill",
    arguments: "{}",
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_missing", status: "completed" });

  assert.equal(sayCalls.length, 0, "KHONG duoc goi turnController.say() binh thuong khi da co danhBoFlow xu ly");
  assert.equal(startCalls.length, 1, "danhBoFlow.start() phai duoc goi dung 1 lan");
  assert.equal(startCalls[0].reason, "DANH_BO_MISSING");
  assert.equal(startCalls[0].nowMs, 123456, "phai dung gia tri tra ve boi tham so now(), khong tu goi Date.now()");
});

test("[Giai doan 6a] tool tra ve DANH_BO_MISSING nhung KHONG truyen danhBoFlow -> giu hanh vi cu, say() mode auto (tuong thich nguoc voi cac checkpoint/test chua can toi)", async () => {
  const { dispatcher, sayCalls } = makeFakes({
    get_bill: async () => ({ success: false, error_code: "DANH_BO_MISSING", message: "Chưa có mã danh bộ." }),
  });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_missing_no_flow",
    callId: "call_missing_no_flow",
    name: "get_bill",
    arguments: "{}",
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_missing_no_flow", status: "completed" });

  assert.equal(sayCalls.length, 1, "khong co danhBoFlow -> roi ve say() binh thuong nhu truoc ban them Giai doan 6a nay");
  assert.deepEqual(sayCalls[0], undefined, "say() mode auto (khong tham so), giong het hanh vi khong co action/doc_cho_khach");
});

test("[Giai doan 6a] output KHAC (khong phai DANH_BO_MISSING) du CO danhBoFlow -> KHONG dung toi danhBoFlow, van say() binh thuong", async () => {
  const startCalls = [];
  const danhBoFlow = { start: (reason, nowMs) => startCalls.push({ reason, nowMs }) };
  const { dispatcher, sayCalls } = makeFakes(
    { get_bill: async () => ({ success: true, message: "Kỳ 8: 200.000đ" }) },
    { danhBoFlow },
  );

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_unrelated",
    callId: "call_unrelated",
    name: "get_bill",
    arguments: "{}",
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_unrelated", status: "completed" });

  assert.equal(startCalls.length, 0, "danhBoFlow.start() KHONG duoc goi khi output khong phai DANH_BO_MISSING");
  assert.equal(sayCalls.length, 1, "output binh thuong van phai say() nhu cu");
});

test("[Giai doan 6a] TOOL_NOT_FOUND/HANDLER_ERROR (loi khac, KHONG phai DANH_BO_MISSING) du co danhBoFlow -> khong dung toi danhBoFlow", async () => {
  const startCalls = [];
  const danhBoFlow = { start: (reason, nowMs) => startCalls.push({ reason, nowMs }) };
  const { dispatcher, sayCalls } = makeFakes({}, { danhBoFlow });

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_not_found",
    callId: "call_not_found",
    name: "khong_ton_tai",
    arguments: "{}",
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_not_found", status: "completed" });

  assert.equal(startCalls.length, 0, "TOOL_NOT_FOUND khac han DANH_BO_MISSING, khong duoc kich danhBoFlow");
  assert.equal(sayCalls.length, 1);
});

// ─── [them 24/08/2026 #2, Giai doan 6a] handleDanhBoFlowDone() - "sau khi ──
// khach xac nhan xong thi sao?" (xem QUYET DINH THIET KE dau src/call-flow/
// dispatch-tool-call.js): CODE tu goi LAI dung tool/rawArgs GOC (khong de
// model tu nho lai), co 1 preamble ngan (mode guided) truoc khi goi lai, roi
// doc verbatim output.message cua ket qua that.

test("[Giai doan 6a #2] DANH_BO_MISSING -> danhBoFlow.start() -> danhBoFlow bao thanh cong (handleDanhBoFlowDone ok:true) " +
  "-> tu goi LAI DUNG tool/rawArgs GOC (danh bo GIO da duoc biet), noi preamble (guided) TRUOC, roi doc verbatim output.message", async () => {
  const calls = [];
  // Mo phong callState.danhBo that: LUC DAU thieu (handler tra ve
  // DANH_BO_MISSING dung 1 lan), SAU khi danhBoFlow "xac nhan xong" thi co
  // (handler tra ve thanh cong) - giong dung cach resolveDanhBoRef that hoat
  // dong (xem src/domain/resolve-danh-bo-ref.js).
  let danhBoKnown = false;
  const danhBoFlow = { start: () => {} };
  const { dispatcher, sayCalls } = makeFakes(
    {
      get_bill: async (args) => {
        calls.push(args);
        if (!danhBoKnown) {
          return { success: false, error_code: "DANH_BO_MISSING", message: "Chưa có mã danh bộ, Quý Khách đọc giúp em ạ." };
        }
        return { success: true, message: `Kỳ ${args.ky}/${args.nam}: đã có dữ liệu.` };
      },
    },
    { danhBoFlow },
  );

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_retry",
    callId: "call_retry",
    name: "get_bill",
    arguments: '{"ma_danh_bo":"22023251775","ky":8,"nam":2026}',
  });
  // sayForOutput() (noi ghi nho pendingDanhBoRetry) chi chay SAU response-
  // ended cua CHINH response nay (xem fix 22/08/2026 dau file) - phai gui
  // tin hieu nay thi DANH_BO_MISSING moi thuc su duoc xu ly.
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_retry", status: "completed" });

  assert.equal(calls.length, 1, "lan dau phai goi handler, tra ve DANH_BO_MISSING (dung callCtx da ghi nho vao pendingDanhBoRetry)");
  assert.equal(sayCalls.length, 0, "DANH_BO_MISSING -> giao het cho danhBoFlow.start() (fake stub o day khong tu say gi), KHONG say() o dispatch-tool-call.js");

  danhBoKnown = true; // mo phong danhBoFlow da xac nhan xong, callState.danhBo GIO da co
  await dispatcher.handleDanhBoFlowDone({ ok: true, danhBo: "22023251775" });

  assert.equal(calls.length, 2, "phai goi LAI DUNG 1 lan nua tool goc, tong 2 lan");
  assert.deepEqual(calls[1], { ma_danh_bo: "22023251775", ky: 8, nam: 2026 }, "lan goi lai phai dung DUNG rawArgs GOC, khong doi/thieu tham so nao");

  assert.equal(sayCalls.length, 2, "2 say(): 1 preamble (guided) + 1 doc ket qua that (verbatim)");
  assert.equal(sayCalls[0].mode, "guided", "preamble truoc, KHONG lo du lieu nhay cam nen cho phep model tu bien tau");
  assert.equal(sayCalls[0].toolChoice, "none", "preamble PHAI chan model tu goi tool khac - day chinh la bug that da sua");
  // [them 24/08/2026 #4, xem "sua 24/08/2026 #4" dau dispatch-tool-call.js]
  // CA 2 say() phai kem toolChoice:"none" - bug that phat hien: thieu field
  // nay khien model TU BIA 1 loi goi get_bill khac trong luc nghe preamble.
  assert.deepEqual(
    sayCalls[1],
    { mode: "verbatim", text: "Kỳ 8/2026: đã có dữ liệu.", toolChoice: "none" },
    "ket qua THAT phai doc verbatim, khong de model tu dien dat lai, VA phai chan model tu goi tool khac",
  );
});

test("[Giai doan 6a #2] handleDanhBoFlowDone() noi preamble (mode:guided) TRUOC khi runTool() xong, khong doi tool tra ve moi noi", async () => {
  let resolveHandler;
  const handlerPromise = new Promise((resolve) => {
    resolveHandler = resolve;
  });
  let callCount = 0;
  const danhBoFlow = { start: () => {} };
  const { dispatcher, sayCalls } = makeFakes(
    {
      get_bill: async () => {
        callCount += 1;
        if (callCount === 1) {
          // Lan dau (qua handleSignal duoi day) phai tra ve NGAY DANH_BO_MISSING
          // de ghi nho pendingDanhBoRetry - chi lan GOI LAI (thu 2, qua
          // handleDanhBoFlowDone) moi thuc su "treo" cho handlerPromise.
          return { success: false, error_code: "DANH_BO_MISSING", message: "Chưa có mã danh bộ." };
        }
        await handlerPromise;
        return { success: true, message: "kết quả sau khi chờ" };
      },
    },
    { danhBoFlow },
  );

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_preamble",
    callId: "call_preamble",
    name: "get_bill",
    arguments: "{}",
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_preamble", status: "completed" });

  const donePromise = dispatcher.handleDanhBoFlowDone({ ok: true, danhBo: "22023251775" });

  // Preamble phai duoc say() NGAY, TRUOC ca khi runTool() (dang treo) xong.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sayCalls.length, 1, "preamble phai duoc noi NGAY, khong doi tool goi lai xong");
  assert.equal(sayCalls[0].mode, "guided");
  assert.ok(sayCalls[0].instructions.length > 0);
  assert.equal(sayCalls[0].toolChoice, "none", "[them 24/08/2026 #4] preamble phai chan model tu goi tool khac");

  resolveHandler();
  await donePromise;
  assert.equal(sayCalls.length, 2, "sau khi tool goi lai xong, phai co them 1 say() verbatim doc ket qua");
  assert.deepEqual(sayCalls[1], { mode: "verbatim", text: "kết quả sau khi chờ", toolChoice: "none" });
});

test("[Giai doan 6a #2] danhBoFlow bao THAT BAI (ok:false) -> KHONG goi lai tool, KHONG say() them gi (giveUp() cua danh-bo-flow.js da tu xin loi roi)", async () => {
  const toolCalls = [];
  const danhBoFlow = { start: () => {} };
  const { dispatcher, sayCalls } = makeFakes(
    {
      get_bill: async (args) => {
        toolCalls.push(args);
        return { success: false, error_code: "DANH_BO_MISSING", message: "Chưa có mã danh bộ." };
      },
    },
    { danhBoFlow },
  );

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_giveup",
    callId: "call_giveup",
    name: "get_bill",
    arguments: "{}",
  });
  assert.equal(toolCalls.length, 1);
  const sayCountAfterMissing = sayCalls.length;

  await dispatcher.handleDanhBoFlowDone({ ok: false, reason: "qua so lan khach bao sai" });

  assert.equal(toolCalls.length, 1, "khong duoc goi LAI tool khi danhBoFlow that bai (van dung 1 lan tu truoc)");
  assert.equal(sayCalls.length, sayCountAfterMissing, "khong duoc them say() nao - giveUp() da tu xin loi trong danh-bo-flow.js roi");
});

test("[Giai doan 6a #2] handleDanhBoFlowDone(ok:true) nhung KHONG co pendingDanhBoRetry (chua tung co DANH_BO_MISSING nao) -> khong crash, khong goi tool nao, khong say() gi (phong thu)", async () => {
  const danhBoFlow = { start: () => {} };
  const { dispatcher, sayCalls } = makeFakes({ get_bill: async () => ({ success: true }) }, { danhBoFlow });

  await assert.doesNotReject(() => dispatcher.handleDanhBoFlowDone({ ok: true, danhBo: "22023251775" }));
  assert.equal(sayCalls.length, 0);
});

test("[Giai doan 6a #2] handleDanhBoFlowDone() ket qua tra ve THIEU output.message -> phong thu, van say() (mode guided) thay vi im lang", async () => {
  let callCount = 0;
  const danhBoFlow = { start: () => {} };
  const { dispatcher, sayCalls } = makeFakes(
    {
      get_bill: async () => {
        callCount += 1;
        if (callCount === 1) {
          return { success: false, error_code: "DANH_BO_MISSING", message: "Chưa có mã danh bộ." };
        }
        return { success: true, data: [{ tong_tien: 1 }] }; // co y KHONG co truong message
      },
    },
    { danhBoFlow },
  );

  await dispatcher.handleSignal({
    kind: "tool-call-requested",
    responseId: "resp_no_message",
    callId: "call_no_message",
    name: "get_bill",
    arguments: "{}",
  });
  await dispatcher.handleSignal({ kind: "response-ended", responseId: "resp_no_message", status: "completed" });

  await dispatcher.handleDanhBoFlowDone({ ok: true, danhBo: "22023251775" });

  const lastSay = sayCalls[sayCalls.length - 1];
  assert.equal(lastSay.mode, "guided", "thieu message -> fallback guided doc tu output tho, khong duoc im lang");
  assert.equal(lastSay.toolChoice, "none", "[them 24/08/2026 #4] fallback cung phai chan model tu goi tool khac");
});

test("runTool() dung doc lap (khong can send/turnController gia) - tien ich khi debug rieng 1 tool", async () => {
  const { dispatcher } = makeFakes({ get_bill: async (args) => ({ success: true, echo: args }) });

  const output = await dispatcher.runTool("get_bill", '{"ma_danh_bo":"123"}');
  assert.deepEqual(output, { success: true, echo: { ma_danh_bo: "123" } });

  const notFound = await dispatcher.runTool("khong_ton_tai", "{}");
  assert.equal(notFound.error_code, "TOOL_NOT_FOUND");
});
