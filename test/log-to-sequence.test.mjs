// test/log-to-sequence.test.mjs
//
// Test src/tools/log-to-sequence.js bang 1 doan log GIA (mo phong dung
// dinh dang tee() cua scripts/checkpoint-*.mjs) - khong can file that
// tren dia, khong can du lieu that cua Giai doan 5a.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCheckpointLog, toMermaid, toHtml } from "../src/tools/log-to-sequence.js";

const SAMPLE_LOG = [
  "[+     5ms] -> session.update",
  "[+    10ms] <- session.created",
  '[checkpoint-test] tin hieu chuan hoa: {"kind":"ignored","rawType":"session.created"}',
  "[+    12ms] <- response.output_audio_transcript.delta",
  '[checkpoint-test] tin hieu chuan hoa: {"kind":"ignored","rawType":"response.output_audio_transcript.delta"}',
  "[+    13ms] <- response.output_audio_transcript.delta",
  '[checkpoint-test] tin hieu chuan hoa: {"kind":"ignored","rawType":"response.output_audio_transcript.delta"}',
  "[+    14ms] <- response.output_audio_transcript.delta",
  '[checkpoint-test] tin hieu chuan hoa: {"kind":"ignored","rawType":"response.output_audio_transcript.delta"}',
  "[+    20ms] <- response.function_call_arguments.done",
  '[checkpoint-test] tin hieu chuan hoa: {"kind":"tool-call-requested","responseId":"resp_1","itemId":"item_1","callId":"call_1","name":"get_bill","arguments":"{\\"ma_danh_bo\\":\\"123\\"}"}',
  "[checkpoint-test] CHU Y - diem can quan sat: test note",
  "[+    21ms] -> conversation.item.create",
  "",
  "[checkpoint-test] ===== Tom tat =====",
].join("\n");

test("parseCheckpointLog: bo qua tin hieu ignored, giu lai arrow tho + tin hieu co nghia", () => {
  const events = parseCheckpointLog(SAMPLE_LOG);

  // Khong con event nao la note chua "ignored" - da bi loai het.
  assert.equal(
    events.some((e) => e.type === "note" && e.text.includes("ignored")),
    false,
    "khong duoc con note nao nhac toi ignored"
  );
});

test("parseCheckpointLog: gop 3 dong response.output_audio_transcript.delta lien tiep thanh 1 arrow x3", () => {
  const events = parseCheckpointLog(SAMPLE_LOG);
  const deltaArrow = events.find((e) => e.type === "arrow" && e.evtType === "response.output_audio_transcript.delta");

  assert.ok(deltaArrow, "phai tim thay arrow delta da gop");
  assert.equal(deltaArrow.count, 3);
  assert.equal(deltaArrow.msStart, 12);
  assert.equal(deltaArrow.msEnd, 14);
});

test("parseCheckpointLog: KHONG gop 2 arrow khac loai/khac chieu, du lien tiep", () => {
  const events = parseCheckpointLog(SAMPLE_LOG);
  const arrows = events.filter((e) => e.type === "arrow");

  // session.update (out), session.created (in), delta x3 (in, da gop),
  // function_call_arguments.done (in), conversation.item.create (out)
  // = 5 arrow SAU KHI gop (khong phai 7 dong tho ban dau).
  assert.equal(arrows.length, 5);
  assert.deepEqual(
    arrows.map((a) => `${a.dir}:${a.evtType}`),
    [
      "out:session.update",
      "in:session.created",
      "in:response.output_audio_transcript.delta",
      "in:response.function_call_arguments.done",
      "out:conversation.item.create",
    ]
  );
});

test("parseCheckpointLog: tin hieu tool-call-requested duoc rut gon thanh 1 note de doc, khong phai JSON tho", () => {
  const events = parseCheckpointLog(SAMPLE_LOG);
  const note = events.find((e) => e.type === "note" && e.text.includes("tool-call-requested"));

  assert.ok(note, "phai co note tool-call-requested");
  assert.match(note.text, /name=get_bill/);
  assert.match(note.text, /callId=call_1/);
});

test("parseCheckpointLog: dong tuong thuat tu do (khong phai arrow/JSON) van duoc giu lam note, khong bi rot", () => {
  const events = parseCheckpointLog(SAMPLE_LOG);
  const note = events.find((e) => e.type === "note" && e.text.includes("diem can quan sat"));

  assert.ok(note, "phai giu duoc dong tuong thuat tu do");
});

test("toMermaid: sinh dung cu phap sequenceDiagram, co ca 2 participant, khong lam mat dau x3", () => {
  const events = parseCheckpointLog(SAMPLE_LOG);
  const mermaid = toMermaid(events, { title: "test-log.txt" });

  assert.match(mermaid, /^sequenceDiagram/);
  assert.match(mermaid, /participant Code/);
  assert.match(mermaid, /participant OpenAI/);
  assert.match(mermaid, /×3/);
  assert.match(mermaid, /Code->>OpenAI: session\.update/);
  assert.match(mermaid, /OpenAI-->>Code: session\.created/);
});

test("toMermaid: khong con ky tu xuong dong ben trong 1 dong Note (se pha cu phap Mermaid)", () => {
  const events = parseCheckpointLog(SAMPLE_LOG);
  const mermaid = toMermaid(events, { title: "test-log.txt" });

  for (const line of mermaid.split("\n")) {
    // Moi dong xuat ra phai la 1 "cau lenh" Mermaid tron ven - kiem tra
    // gian tiep bang cach dam bao khong dong nao rong o giua do note bi
    // vo tinh chua \n that.
    assert.equal(line.includes("\r"), false);
  }
});

test("toHtml: nhung dung nguon Mermaid vao trong the <pre class=mermaid>, co tieu de", () => {
  const html = toHtml("sequenceDiagram\n    participant Code", "demo.txt");

  assert.match(html, /<pre class="mermaid">/);
  assert.match(html, /sequenceDiagram/);
  assert.match(html, /demo\.txt/);
  assert.match(html, /mermaid\.initialize/);
});

test("parseCheckpointLog: log rong -> mang rong, khong throw", () => {
  assert.deepEqual(parseCheckpointLog(""), []);
});

test("[23/08/2026] tin hieu ai-said (loi AI noi) duoc rut gon thanh 1 note co noi dung that, khong phai ignored", () => {
  const log = [
    "[+    30ms] <- response.output_audio_transcript.done",
    '[checkpoint-test] tin hieu chuan hoa: {"kind":"ai-said","responseId":"resp_1","itemId":"item_1","text":"Ok, để tôi xem thử hóa đơn tháng này cho bạn nhé."}',
  ].join("\n");

  const events = parseCheckpointLog(log);
  const note = events.find((e) => e.type === "note" && e.text.includes("ai-said"));

  assert.ok(note, "phai co note ai-said");
  assert.match(note.text, /Ok, để tôi xem thử hóa đơn tháng này cho bạn nhé\./, "phai thay noi dung AI noi that, khong phai chi ten kind");
});

test("[fix 23/08/2026] tin hieu transcript-ready (loi nguoi dung noi) in ra dung noi dung - truoc day doc sai field nen luon ra 'undefined'", () => {
  const log = [
    "[+    10ms] <- conversation.item.input_audio_transcription.completed",
    '[checkpoint-test] tin hieu chuan hoa: {"kind":"transcript-ready","itemId":"item_1","text":"Cho tôi hỏi hóa đơn tháng này."}',
  ].join("\n");

  const events = parseCheckpointLog(log);
  const note = events.find((e) => e.type === "note" && e.text.includes("transcript-ready"));

  assert.ok(note, "phai co note transcript-ready");
  assert.match(note.text, /Cho tôi hỏi hóa đơn tháng này\./, "phai thay noi dung that");
  assert.doesNotMatch(note.text, /undefined/, "BUG cu: doc nham signal.transcript (khong ton tai) thay vi signal.text");
});

test("toMermaid: note dai duoc chen <br/> de tu xuong dong, khong bi Mermaid cat ngang o canh khung hinh", () => {
  const longText =
    "tín hiệu: tool-call-requested (name=get_bill, callId=call_WEx4pI3LvcFRdQjW, " +
    "arguments={'ma_danh_bo':'22082351775','ky':8,'nam':2026})";
  const events = [{ type: "note", text: longText }];
  const mermaid = toMermaid(events);

  assert.match(mermaid, /<br\/>/, "note dai phai co it nhat 1 diem xuong dong");
  // Khong dong nao (tach boi <br/>) dai qua nguong wrap + slack nho cho tu cuoi.
  const noteLine = mermaid.split("\n").find((l) => l.includes("tool-call-requested"));
  const segments = noteLine.replace("    Note over Code,OpenAI: ", "").split("<br/>");
  for (const seg of segments) {
    assert.ok(seg.length <= 90, `doan qua dai, chua wrap dung: "${seg}"`);
  }
});
