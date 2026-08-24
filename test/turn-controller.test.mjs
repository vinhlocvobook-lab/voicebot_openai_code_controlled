// test/turn-controller.test.mjs
//
// Giai doan 3 (xem docs/roadmap.md). Test turn-controller.js bang WS gia
// (khong ket noi that, khong can OPENAI_API_KEY) - dung lai dung 3 loai
// race da biet o ban cu de xac nhan generation token sua duoc chung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createTurnController } from "../src/session/turn-controller.js";

function createMockWs() {
  const sent = [];
  return {
    sent,
    send(raw) {
      sent.push(JSON.parse(raw));
    },
  };
}

test("say() mode auto gui response.create voi response rong", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "auto" });
  assert.equal(ws.sent.length, 1);
  assert.deepEqual(ws.sent[0], { type: "response.create", response: {} });
});

test("say() mode verbatim ep doc nguyen van text da cho", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "verbatim", text: "Da xac nhan ma danh bo la 22082351775" });
  assert.equal(ws.sent[0].type, "response.create");
  assert.match(ws.sent[0].response.instructions, /22082351775/);
});

test("say() mode guided gui instructions dinh huong", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "guided", instructions: "Hoi khach muon tra cuu dich vu gi" });
  assert.deepEqual(ws.sent[0].response, { instructions: "Hoi khach muon tra cuu dich vu gi" });
});

// [sua 24/08/2026, xem ghi chu "PHAT HIEN THAT" dau turn-controller.js]
// Truoc day dung "confirm_danh_bo" (ten ham) lam vi du - GAY HIEU LAM vi
// gia tri do bi API that TU CHOI (response.tool_choice CHI nhan "auto"/
// "none"/"required", KHONG nhan ten ham cu the). Ham nay (buildResponsePayload)
// van CHI la ong dan chuyen tiep nguyen van, nen test van dung ve mat logic
// pass-through - doi sang "required" (gia tri THAT SU hop le) de khong con
// ai vo tinh coi day la vi du dung khi copy sang noi khac.
test("say() mode tool gui tool_choice nguyen van (KHONG tu gioi han gia tri - validate la trach nhiem cua API)", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "tool", toolChoice: "required" });
  assert.deepEqual(ws.sent[0].response, { tool_choice: "required" });
});

// [them 24/08/2026 #4, xem ghi chu "sua 24/08/2026 #4" o turn-controller.js#
// buildResponsePayload] Bug that phat hien qua checkpoint-giai-doan-6a.mjs:
// mode "guided" khong co cach nao chan model TU Y goi tool khac trong luc
// noi 1 cau preamble - GET_BILL_TOOL van con khai bao suot session nen
// response.create khong kem tool_choice de model TU DO goi tool, dan toi
// model tu bia 1 loi goi get_bill (danh bo doan sai) khi nghe "se tra cuu
// ngay". Sua: MOI mode (khong chi rieng "tool") duoc kem THEM tool_choice
// (tuy chon) - 3 test duoi day xac nhan dieu do cho guided/verbatim.
test("say() mode guided KEM toolChoice -> tool_choice duoc ghep them vao response, khong thay the instructions", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "guided", instructions: "Nói ngắn gọn rằng sẽ tra cứu ngay.", toolChoice: "none" });
  assert.deepEqual(ws.sent[0].response, {
    instructions: "Nói ngắn gọn rằng sẽ tra cứu ngay.",
    tool_choice: "none",
  });
});

test("say() mode verbatim KEM toolChoice -> tool_choice duoc ghep them, van giu instructions ep doc nguyen van", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "verbatim", text: "Kỳ 8/2026: đã có dữ liệu.", toolChoice: "none" });
  assert.match(ws.sent[0].response.instructions, /Kỳ 8\/2026: đã có dữ liệu\./);
  assert.equal(ws.sent[0].response.tool_choice, "none");
});

test("say() mode guided/verbatim KHONG truyen toolChoice -> KHONG co field tool_choice (tuong thich nguoc)", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "guided", instructions: "Hỏi khách muốn tra cứu dịch vụ gì" });
  assert.equal("tool_choice" in ws.sent[0].response, false, "khong truyen toolChoice thi khong duoc tu them field nay");
});

test("say() thieu tham so bat buoc theo mode -> nem loi, KHONG gui gi len ws", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  assert.throws(() => tc.say({ mode: "verbatim" }), /text/);
  assert.throws(() => tc.say({ mode: "guided" }), /instructions/);
  assert.throws(() => tc.say({ mode: "tool" }), /toolChoice/);
  assert.equal(ws.sent.length, 0, "khong duoc gui gi len ws khi say() nem loi");
});

test("say() mode khong hop le -> nem loi", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  assert.throws(() => tc.say({ mode: "khong-ton-tai" }), /mode khong hop le/);
});

// --- Race 1: "hai response cung gui" ---
test("RACE 1: goi say() lan 2 truoc khi lan 1 co response-started -> huy lan 1 (chua ro id) roi moi tao lan 2", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "auto" }); // lan 1, chua co response-started xac nhan
  tc.say({ mode: "auto" }); // lan 2, goi ngay lap tuc

  assert.equal(ws.sent.length, 3, "phai co: create(1), cancel, create(2)");
  assert.equal(ws.sent[0].type, "response.create");
  assert.equal(ws.sent[1].type, "response.cancel");
  assert.equal(ws.sent[1].response_id, undefined, "chua biet id that cua lan 1 nen khong doan mo");
  assert.equal(ws.sent[2].type, "response.create");
});

// --- Race 2: "cancel nham response" ---
test("RACE 2: goi say() lan 2 SAU KHI lan 1 da co response-started -> huy DUNG response_id that", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "auto" });
  tc.handleSignal({ kind: "response-started", responseId: "resp_AAA" });
  tc.say({ mode: "auto" });

  const cancelMsg = ws.sent.find((m) => m.type === "response.cancel");
  assert.ok(cancelMsg, "phai co lenh cancel");
  assert.equal(cancelMsg.response_id, "resp_AAA", "phai huy dung id that da luu, khong doan mo");
});

// --- Race 3: tin hieu tre tu generation cu (goc cua ca "cancel nham" lan "retry mo khoa") ---
test("RACE 3: response-started TRE cua generation da bi huy khong duoc ghi de state hien tai", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "auto" }); // generation 1
  tc.say({ mode: "auto" }); // generation 2, huy generation 1 (chua co id)

  // response-started cua GENERATION 1 den TRE (server van kip gui created
  // truoc khi ap dung lenh huy) - phai bi bo qua, khong duoc coi la active.
  tc.handleSignal({ kind: "response-started", responseId: "resp_GEN1_TRE" });
  assert.equal(
    tc.isResponseActive(),
    true,
    "van active vi dang cho response-started THAT cua generation 2 (pendingCreateGeneration)"
  );

  // Neu tin hieu tre bi nham la cua generation 2, activeResponseId se la
  // "resp_GEN1_TRE" - kiem tra gian tiep bang cach: khi response-ended
  // cua chinh "resp_GEN1_TRE" toi, KHONG duoc lam tat isResponseActive
  // (vi no chua bao gio duoc cong nhan la active).
  tc.handleSignal({ kind: "response-ended", responseId: "resp_GEN1_TRE", status: "cancelled" });
  assert.equal(
    tc.isResponseActive(),
    true,
    "van dang cho response THAT cua generation 2, khong bi anh huong boi tin hieu cua generation 1"
  );

  // Gio response-started THAT SU cua generation 2 moi toi.
  tc.handleSignal({ kind: "response-started", responseId: "resp_GEN2_THAT" });
  assert.equal(tc.isResponseActive(), true);
});

// --- Race 4: "retry mo khoa" - goi say() lien tuc nhieu lan khong lam lech generation ---
test("RACE 4: goi say() lien tuc nhieu lan (retry) - generation luon tang dung thu tu, khong ket lai", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  const g1 = tc.say({ mode: "auto" });
  const g2 = tc.say({ mode: "auto" });
  const g3 = tc.say({ mode: "auto" });
  assert.deepEqual([g1, g2, g3], [1, 2, 3]);
});

test("response-ended cua response DA BI THAY THE khong lam mat active cua response MOI", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.say({ mode: "auto" });
  tc.handleSignal({ kind: "response-started", responseId: "resp_OLD" });

  tc.say({ mode: "auto" }); // huy resp_OLD, tao response moi
  tc.handleSignal({ kind: "response-started", responseId: "resp_NEW" });

  // response-ended cua resp_OLD den tre (do bi huy) - KHONG duoc xoa active cua resp_NEW
  tc.handleSignal({ kind: "response-ended", responseId: "resp_OLD", status: "cancelled" });
  assert.equal(tc.isResponseActive(), true, "resp_NEW van dang active");
});

// --- Luong binh thuong ---
test("LUONG BINH THUONG: say -> response-started -> response-ended -> tro ve idle", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);

  assert.equal(tc.isResponseActive(), false, "ban dau idle");
  tc.say({ mode: "auto" });
  assert.equal(tc.isResponseActive(), true, "dang cho xac nhan response-started");

  tc.handleSignal({ kind: "response-started", responseId: "resp_X" });
  assert.equal(tc.isResponseActive(), true, "dang chay");

  tc.handleSignal({ kind: "response-ended", responseId: "resp_X", status: "completed" });
  assert.equal(tc.isResponseActive(), false, "da xong, tro ve idle, san sang cho say() tiep theo");
});

test("handleSignal bo qua an toan cac kind khong lien quan (khong crash)", () => {
  const ws = createMockWs();
  const tc = createTurnController(ws);
  tc.handleSignal({ kind: "speech-started", atMs: 100 });
  tc.handleSignal({ kind: "transcript-ready", itemId: "x", text: "hai hai" });
  tc.handleSignal({ kind: "error", raw: {} });
  tc.handleSignal(null);
  tc.handleSignal({});
  assert.equal(tc.isResponseActive(), false);
});

test("[bo sung 23/08/2026] say() log('info') dung input (opts) nhan duoc, KE CA khi sau do nem loi vi thieu tham so", () => {
  const ws = createMockWs();
  const logCalls = [];
  const tc = createTurnController(ws, { log: (level, msg) => logCalls.push({ level, msg }) });

  tc.say({ mode: "verbatim", text: "Da xac nhan ma danh bo la 22082351775" });

  const inputLog = logCalls.find((c) => c.msg.includes("say() duoc goi voi input"));
  assert.ok(inputLog, "phai co 1 dong log ghi lai input cua say()");
  assert.equal(inputLog.level, "info");
  assert.match(inputLog.msg, /verbatim/);
  assert.match(inputLog.msg, /22082351775/);

  // Van phai log DUOC input ngay ca khi say() SAU DO nem loi (thieu tham
  // so bat buoc) - log dat truoc buildResponsePayload() nen khong bi anh
  // huong boi loi validate phia sau.
  logCalls.length = 0;
  assert.throws(() => tc.say({ mode: "guided" }), /instructions/);
  assert.equal(logCalls.length, 1, "van phai log duoc input du sau do nem loi");
  assert.match(logCalls[0].msg, /guided/);
});
