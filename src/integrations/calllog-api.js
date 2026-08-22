// src/integrations/calllog-api.js
//
// Giai doan 5 (xem docs/roadmap.md). Client goi REST API ghi log cuoc goi
// that (voicebot-log-api.php). Port tu voice_bot/src/log-api.js - file
// NAY (khong phai db.js) la ban dang dung, vi du an da chuyen tu ket noi
// MariaDB truc tiep (db.js, CU) sang REST rieng (log-api.js) tu truoc.
// db.js KHONG con duoc port nua.
//
// Nguyen tac BAT BUOC giu nguyen tu ban cu: LOI GHI LOG KHONG DUOC LAM
// SAP CUOC GOI - moi ham o day tuyet doi khong throw/reject ra ngoai, moi
// loi tu nuot + chi bao qua log (giong tongdai-api.js).
//
// KHAC ban cu (cung 2 diem nhu tongdai-api.js):
//   - Bo import cung "./logger.js" - thay bang hook TUY CHON
//     setLogApiLogger(fn), mac dinh im lang.
//   - Doc bien moi truong LUOI (trong ham) thay vi hang so tinh luc
//     import module - chi de test duoc de dang.
//
// getDanhBoHistory(): CHI tra du lieu THO (goi y tu lich su cuoc goi
// truoc) - KHONG phai bang chung da xac minh cho lan goi nay. Noi goi
// PHAI dua qua gate xac nhan loi noi that (Giai doan 6, resolveDanhBo)
// truoc khi dung de tra cuu - khong tu y tin thang ket qua ham nay.

let log = () => {};
export function setLogApiLogger(fn) {
  log = typeof fn === "function" ? fn : () => {};
}

function _config() {
  const base = (process.env.LOG_API_BASE || "").replace(/\/$/, "");
  const timeoutMs = parseInt(process.env.LOG_API_TIMEOUT_MS || "15000", 10);
  const apiKey = process.env.LOG_API_KEY || "";
  const insecureTls = /^true$/i.test(process.env.LOG_API_INSECURE_TLS || "");
  const logFolderOnApiServer = process.env.VOICEBOT_LOG_FOLDER_ON_API_SERVER || "";
  return { base, timeoutMs, apiKey, insecureTls, logFolderOnApiServer, enabled: !!base };
}

async function _getDispatcher(insecureTls) {
  if (!insecureTls) return { dispatcher: undefined, fetchImpl: fetch };
  const { Agent, fetch: undiciFetch } = await import("undici");
  return { dispatcher: new Agent({ connect: { rejectUnauthorized: false } }), fetchImpl: undiciFetch };
}

let _warnedDisabled = false;
let _warnedNoKey = false;

/** Co dang bat ghi log qua REST API khong (LOG_API_BASE da cau hinh). */
export function isLogApiEnabled() {
  return _config().enabled;
}

/**
 * Goi 1 endpoint cua voicebot-log-api.php. KHONG BAO GIO throw - moi loi
 * (mang, timeout, JSON hong, HTTP loi) deu tra ve {success:false,...}.
 */
async function callApi(path, { method = "GET", body = null } = {}) {
  const { base, timeoutMs, apiKey, insecureTls, enabled } = _config();

  if (!enabled) {
    if (!_warnedDisabled) {
      log("info", "[LogAPI] LOG_API_BASE trống → bỏ qua ghi log qua API (chỉ lưu file JSON).");
      _warnedDisabled = true;
    }
    return { success: false, error_code: "DISABLED" };
  }
  if (!apiKey && !_warnedNoKey) {
    log("warn", "[LogAPI] LOG_API_KEY trống — request tới voicebot-log-api.php sẽ không có Authorization, có thể bị 401 nếu server đã bật auth.");
    _warnedNoKey = true;
  }

  const url = base + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const { dispatcher, fetchImpl } = await _getDispatcher(insecureTls);
    const opts = { method, signal: controller.signal, headers: { Accept: "application/json" } };
    if (apiKey) opts.headers["Authorization"] = `Bearer ${apiKey}`;
    if (dispatcher) opts.dispatcher = dispatcher;
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    log("debug", `[LogAPI] -> ${method} ${url}`);
    const res = await fetchImpl(url, opts);
    const text = await res.text();
    const durationMs = Date.now() - t0;

    let outer;
    try {
      outer = JSON.parse(text);
    } catch {
      log("warn", `[LogAPI] ${method} ${path} -> ${res.status} (${durationMs}ms) phản hồi không phải JSON hợp lệ`);
      return { success: false, error_code: "INVALID_RESPONSE" };
    }

    if (outer.success) {
      log("debug", `[LogAPI] ${method} ${path} -> ${res.status} (${durationMs}ms) OK`);
    } else {
      log("warn", `[LogAPI] ${method} ${path} -> ${res.status} (${durationMs}ms) lỗi: ${outer.error || "?"}`);
    }
    return outer;
  } catch (err) {
    const aborted = err.name === "AbortError";
    const durationMs = Date.now() - t0;
    const causeInfo = err.cause ? ` — nguyên nhân: ${err.cause.code || ""} ${err.cause.message || err.cause}` : "";
    log("warn", `[LogAPI] Lỗi gọi ${url}: ${err.message}${causeInfo} (${durationMs}ms)${aborted ? " [TIMEOUT]" : ""}`);
    return { success: false, error_code: aborted ? "TIMEOUT" : "CONNECTION_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Pha 1 - insertCallStub ──────────────────────────────────────────────

export async function insertCallStub(p = {}) {
  if (!p.callId) return;
  try {
    await callApi("/calls", {
      method: "POST",
      body: {
        callId: p.callId,
        customerTel: p.customerTel ?? null,
        uniqueid: p.uniqueid ?? null,
        recordPath: p.recordPath ?? null,
        voiceModel: p.voiceModel ?? null,
        startTime: p.startTime ?? null,
      },
    });
  } catch (err) {
    log("warn", `[LogAPI] insertCallStub(${p.callId}) lỗi bất ngờ: ${err.message}`);
  }
}

// ─── Pha 2 - finalizeCallLog ─────────────────────────────────────────────

export async function finalizeCallLog(document, jsonFilePath = null, relativeLogPath = null) {
  const callId = document?.meta?.callId;
  if (!callId) return;
  const { logFolderOnApiServer } = _config();
  try {
    const body = { ...document, json_log_filepath: jsonFilePath };
    if (logFolderOnApiServer && relativeLogPath) {
      body.log_file_root_folder = logFolderOnApiServer;
      body.log_file_relative_path = relativeLogPath;
    }
    const r = await callApi(`/calls/${encodeURIComponent(callId)}`, { method: "PUT", body });
    if (r.success) {
      const d = r.data || {};
      log("info", `[LogAPI] Đã ghi voicebot_calllog: ${callId} (tool_calls ${d.tool_calls_written ?? "?"}/${d.tool_calls_total ?? "?"})`);
      if (Array.isArray(d.tool_call_errors) && d.tool_call_errors.length) {
        log("warn", `[LogAPI] finalizeCallLog(${callId}) có ${d.tool_call_errors.length} tool call lỗi ghi (xem server log).`);
      }
    }
  } catch (err) {
    log("warn", `[LogAPI] finalizeCallLog(${callId}) lỗi bất ngờ: ${err.message}`);
  }
}

// ─── ticket ───────────────────────────────────────────────────────────────

export async function insertTicket(p = {}) {
  if (!p.callId) return;
  try {
    await callApi("/tickets", {
      method: "POST",
      body: { callId: p.callId, customerTel: p.customerTel ?? null, args: p.args ?? {}, output: p.output ?? {} },
    });
  } catch (err) {
    log("warn", `[LogAPI] insertTicket(${p.callId}) lỗi bất ngờ: ${err.message}`);
  }
}

// ─── danh-bo history (chi du lieu THO, xem ghi chu dau file) ─────────────

export async function getDanhBoHistory(tel, { limit = 5, days = 180 } = {}) {
  if (!tel) return [];
  try {
    const qs = new URLSearchParams({ tel: String(tel), limit: String(limit), days: String(days) });
    const r = await callApi(`/danh-bo?${qs.toString()}`, { method: "GET" });
    if (!r.success) return [];
    return Array.isArray(r.data?.candidates) ? r.data.candidates : [];
  } catch (err) {
    log("warn", `[LogAPI] getDanhBoHistory(${tel}) lỗi bất ngờ: ${err.message}`);
    return [];
  }
}

// ─── tuong thich chu ky cu ────────────────────────────────────────────────

export async function closeDb() {
  /* no-op */
}
