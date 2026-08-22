// src/tools/log-to-sequence.js
//
// Cong cu PHAT TRIEN (khong phai runtime cuoc goi that) - doc noi dung file
// log .txt do cac script scripts/checkpoint-*.mjs / scripts/probe-*.mjs
// sinh ra (dinh dang tee() dung chung: dong "[+ Nms] -> type"/"[+ Nms] <-
// type" cho event tho gui/nhan qua WebSocket, dong "[label] tin hieu chuan
// hoa: {...}" cho tin hieu da chuan hoa tu turn-signal.js, va cac dong
// tuong thuat tu do "[label] ..." khac), roi sinh ra 1 sequenceDiagram
// (Mermaid) de xem truc quan thay vi doc tung dong text.
//
// [22/08/2026] Tach lam 2 phan nhu session-ws.js: module nay la PHAN LOGIC
// THUAN (parse text -> mermaid text), khong dung fs/CLI - test duoc bang
// node:test khong can file that. scripts/log-to-sequence.mjs la CLI mong
// goi module nay.
//
// Dung lai duoc cho MOI file log tuong lai (Giai doan 6a, 7, 8, 9...),
// khong rieng gi log cua Giai doan 5a.

const ARROW_RE = /^\[\+\s*(\d+)ms\]\s+(->|<-)\s+(\S+)/;
const LABELED_RE = /^\[[^\]]+\]\s+(.*)$/;
const SIGNAL_RE = /^tin hieu chuan hoa:\s*(\{.*\})\s*$/;

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

// Mermaid sequenceDiagram khong thich ky tu xuong dong/dau nhay kep trong
// 1 dong lenh - don ve 1 dong, doi nhay kep sang nhay don. KHONG dong nghia
// "an toan tuyet doi" voi moi phien ban Mermaid, nhung du dung cho log du
// an nay (kiem qua Playwright truoc khi giao file - xem scripts/log-to-
// sequence.mjs va ghi chu kiem thu).
function sanitize(s) {
  return String(s)
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .trim();
}

// Rut gon 1 tin hieu DA CHUAN HOA (turn-signal.js) thanh 1 dong de nguoi
// doc hieu ngay khong can mo JSON day du. "ignored" (chiem da so cac dong
// trong log that) bi loai o parseCheckpointLog(), KHONG toi day.
function summarizeSignal(signal) {
  switch (signal.kind) {
    case "response-started":
      return `tín hiệu: response-started (responseId=${signal.responseId})`;
    case "response-ended":
      return `tín hiệu: response-ended (responseId=${signal.responseId}, status=${signal.status})`;
    case "tool-call-requested":
      return (
        `tín hiệu: tool-call-requested (name=${signal.name}, callId=${signal.callId}, ` +
        `arguments=${truncate(signal.arguments, 80)})`
      );
    case "speech-started":
      return `tín hiệu: speech-started (atMs=${signal.atMs})`;
    case "speech-stopped":
      return `tín hiệu: speech-stopped (atMs=${signal.atMs})`;
    case "buffer-committed":
      return `tín hiệu: buffer-committed (itemId=${signal.itemId})`;
    case "transcript-ready":
      return `tín hiệu: transcript-ready ("${truncate(signal.transcript ?? "", 80)}")`;
    case "error":
      return `tín hiệu: error (${truncate(JSON.stringify(signal.raw ?? signal), 150)})`;
    default:
      return `tín hiệu: ${signal.kind}`;
  }
}

// Buoc 1: doc text -> danh sach event tho theo dung thu tu dong trong file
// (chua gop cac event tho lien tiep giong nhau - xem collapseConsecutiveArrows).
function parseLines(text) {
  const events = [];
  const rawLines = text.split(/\r?\n/);

  for (const line of rawLines) {
    if (!line.trim()) continue;

    const arrowMatch = line.match(ARROW_RE);
    if (arrowMatch) {
      events.push({
        type: "arrow",
        ms: Number(arrowMatch[1]),
        dir: arrowMatch[2] === "->" ? "out" : "in",
        evtType: arrowMatch[3],
      });
      continue;
    }

    const labeled = line.match(LABELED_RE);
    if (labeled) {
      const rest = labeled[1];
      const sigMatch = rest.match(SIGNAL_RE);
      if (sigMatch) {
        let parsed;
        try {
          parsed = JSON.parse(sigMatch[1]);
        } catch {
          events.push({ type: "note", text: `(khong parse duoc tin hieu: ${truncate(sigMatch[1], 80)})` });
          continue;
        }
        if (parsed.kind === "ignored") continue; // qua nhieu, khong huu ich tren diagram
        events.push({ type: "note", text: summarizeSignal(parsed) });
        continue;
      }
      events.push({ type: "note", text: rest });
      continue;
    }

    // Dong khong khop pattern nao da biet - giu nguyen lam note thay vi
    // rot mat thong tin (vd dong trong ngan cach trong log, tieu de "====").
    events.push({ type: "note", text: line });
  }

  return events;
}

// Buoc 2: gop cac event "arrow" LIEN TIEP CUNG chieu + CUNG loai (khong bi
// ngat boi 1 note nao o giua) thanh 1 dong "×N" - log that co hang chuc
// dong response.output_audio.delta/response.output_audio_transcript.delta
// lien tiep, ve rieng tung dong se ra 1 diagram khong doc noi.
function collapseConsecutiveArrows(events) {
  const out = [];
  for (const ev of events) {
    if (ev.type === "arrow") {
      const prev = out[out.length - 1];
      if (prev && prev.type === "arrow" && prev.dir === ev.dir && prev.evtType === ev.evtType) {
        prev.count += 1;
        prev.msEnd = ev.ms;
        continue;
      }
      out.push({ ...ev, count: 1, msStart: ev.ms, msEnd: ev.ms });
      continue;
    }
    out.push(ev);
  }
  return out;
}

// API chinh: text log .txt -> danh sach event DA GOP, san sang dua vao
// toMermaid(). Tach rieng khoi toMermaid() de test duoc tung buoc doc lap.
export function parseCheckpointLog(text) {
  return collapseConsecutiveArrows(parseLines(text));
}

// [fix 22/08/2026, phat hien qua kiem tra bang Playwright truoc khi giao
// file] Note cua Mermaid KHONG tu xuong dong - 1 note dai (vd tin hieu
// tool-call-requested co ca "arguments") bi CAT NGANG o canh khung hinh
// SVG thay vi tu wrap. Chen the <br/> (Mermaid render duoc HTML trong
// nhan khi securityLevel:"loose", da bat o toHtml()) tai khoang trang gan
// nhat truoc nguong `width` de note tu xuong dong nhieu hang, khong bi cat.
function wrapForMermaid(text, width = 70) {
  const words = String(text).split(" ");
  const wrapped = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > width && current) {
      wrapped.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.join("<br/>");
}

// Danh sach event (tu parseCheckpointLog) -> 1 chuoi Mermaid sequenceDiagram.
export function toMermaid(events, { title } = {}) {
  const lines = ["sequenceDiagram"];
  if (title) lines.push(`    %% ${sanitize(title)}`);
  lines.push("    participant Code", "    participant OpenAI");

  for (const ev of events) {
    if (ev.type === "arrow") {
      const arrow = ev.dir === "out" ? "Code->>OpenAI" : "OpenAI-->>Code";
      const timeLabel = ev.count > 1 ? `+${ev.msStart}ms..+${ev.msEnd}ms` : `+${ev.msStart}ms`;
      const countLabel = ev.count > 1 ? ` ×${ev.count}` : "";
      lines.push(`    ${arrow}: ${sanitize(ev.evtType)}${countLabel} (${timeLabel})`);
    } else if (ev.type === "note") {
      lines.push(`    Note over Code,OpenAI: ${wrapForMermaid(sanitize(truncate(ev.text, 260)))}`);
    }
  }

  return lines.join("\n");
}

// Boc 1 nguon Mermaid thanh 1 file HTML doc lap (tu mo duoc bang trinh
// duyet, khong can chay server). Dung CDN cdnjs cho thu vien mermaid.js -
// can mang khi mo (chap nhan duoc, day la cong cu dev noi bo, khong phai
// giao dien production).
export function toHtml(mermaidSource, title = "Sequence diagram") {
  const escapedTitle = String(title).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapedTitle}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0b0f14; color:#e6edf3; margin:0; padding:24px; }
  h1 { font-size:15px; font-weight:600; margin:0 0 16px; color:#9fb3c8; }
  .mermaid { background:#ffffff; border-radius:8px; padding:20px; overflow-x:auto; }
</style>
</head>
<body>
<h1>${escapedTitle}</h1>
<pre class="mermaid">
${mermaidSource}
</pre>
<script>mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });</script>
</body>
</html>
`;
}
