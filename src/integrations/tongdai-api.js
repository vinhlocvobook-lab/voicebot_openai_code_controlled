// src/integrations/tongdai-api.js
//
// Giai doan 5 (xem docs/roadmap.md). Client goi REST API that cua Tong dai
// CNTA (api.php). Port tu ban cu (voice_bot/src/api.js) - giu NGUYEN logic
// that (unwrap response 2 lop, xu ly timeout/loi mang, Agent undici rieng
// cho TLS self-signed) vi day la nghiep vu/ha tang that, khong phai vay
// race cua kien truc cu.
//
// KHAC ban cu:
//   - Bo import cung "./logger.js" / "./api-trace.js" (chua co ban moi
//     tuong duong) - thay bang 2 hook TUY CHON, mac dinh im lang:
//     setApiLogger(fn) va setApiTraceHandler(fn). Lop goi (session-ws/
//     call-flow sau nay) tu quyet dinh co noi vao hay khong.
//   - Doc bien moi truong (TONGDAI_API_BASE/...) LUOI (trong ham, khong
//     phai hang so tinh 1 lan luc import module) - chi de TEST DUOC de
//     dang (doi process.env giua cac test case), KHONG doi hanh vi san
//     xuat (bien moi truong khong doi giua chung cua 1 tien trinh chay
//     that).
//   - db.js KHONG con duoc port nua (du an khong ket noi DB truc tiep) -
//     khong lien quan file nay, ghi chu de nho boi canh.

let log = () => {};
export function setApiLogger(fn) {
  log = typeof fn === "function" ? fn : () => {};
}

let onApiTrace = () => {};
export function setApiTraceHandler(fn) {
  onApiTrace = typeof fn === "function" ? fn : () => {};
}

function _config() {
  const base = (process.env.TONGDAI_API_BASE || "http://127.0.0.1:7700/api.php").replace(/\/$/, "");
  const timeoutMs = parseInt(process.env.TONGDAI_API_TIMEOUT_MS || "15000", 10);
  const apiKey = process.env.TONGDAI_API_KEY || "";
  const insecureTls = /^true$/i.test(process.env.TONGDAI_API_INSECURE_TLS || "");
  return { base, timeoutMs, apiKey, insecureTls };
}

// [12/08/2026, giu tu ban cu] api.php co the chay sau HTTPS voi self-signed
// cert - BAT TONGDAI_API_INSECURE_TLS=true de bo qua verify CHI CHO request
// toi dung base URL nay (qua undici Agent rieng, dispatcher), KHONG dung
// NODE_TLS_REJECT_UNAUTHORIZED (bien do tat verify CA TIEN TRINH, ke ca
// ket noi that toi OpenAI). Chi tao Agent (va import "undici") khi THUC SU
// can - binh thuong dung fetch TOAN CUC (built-in cua Node) de: (1) tranh
// loi lech version giua undici built-in cua Node va goi "undici" tu npm
// (UND_ERR_INVALID_ARG - da gap tren Node 22 + undici 8.x), (2) KHONG pha
// co che mock `globalThis.fetch` cua test (xem test/tongdai-api.test.mjs).
async function _getDispatcher(insecureTls) {
  if (!insecureTls) return { dispatcher: undefined, fetchImpl: fetch };
  const { Agent, fetch: undiciFetch } = await import("undici");
  return { dispatcher: new Agent({ connect: { rejectUnauthorized: false } }), fetchImpl: undiciFetch };
}

function _traceNow() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace("Z", "+07:00");
}

const API_TRACE_CLIP = 8000;
function _clipResponse(outer, rawText) {
  try {
    const v = outer ?? rawText ?? null;
    if (v == null) return null;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.length <= API_TRACE_CLIP) return v;
    return s.slice(0, API_TRACE_CLIP) + `…[đã cắt bớt, tổng ${s.length} ký tự]`;
  } catch {
    return null;
  }
}

/**
 * Goi 1 endpoint, tra ve payload nghiep vu (lop trong, da unwrap).
 * @returns {Promise<{success:boolean, message?:string, error_code?:string, data:any}>}
 */
async function callApi(path, { method = "GET", query = null, body = null } = {}) {
  const { base, timeoutMs, apiKey, insecureTls } = _config();
  let url = base + path;

  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== null && v !== undefined && v !== "") params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += "?" + qs;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const _t0 = Date.now();
  const _trace = {
    time: _traceNow(),
    method,
    url,
    query: query ?? null,
    body: body ?? null,
    http_status: null,
    duration_ms: null,
    response_outer: null,
    error_code: null,
  };

  try {
    const { dispatcher, fetchImpl } = await _getDispatcher(insecureTls);
    const opts = { method, signal: controller.signal, headers: { Accept: "application/json" } };
    if (apiKey) opts.headers["Authorization"] = `Bearer ${apiKey}`;
    if (dispatcher) opts.dispatcher = dispatcher;
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    log("debug", `[tongdai-api] -> ${method} ${url}`);
    const res = await fetchImpl(url, opts);
    const text = await res.text();
    _trace.http_status = res.status;
    _trace.duration_ms = Date.now() - _t0;

    let outer;
    try {
      outer = JSON.parse(text);
    } catch {
      _trace.error_code = "INVALID_RESPONSE";
      _trace.response_outer = _clipResponse(null, text);
      log("warn", `[tongdai-api] ${method} ${path} -> ${res.status} (${_trace.duration_ms}ms) INVALID_RESPONSE`);
      return { success: false, error_code: "INVALID_RESPONSE", message: "Phản hồi không hợp lệ từ máy chủ.", data: null };
    }

    _trace.response_outer = _clipResponse(outer, text);
    log("info", `[tongdai-api] ${method} ${path} -> ${res.status} (${_trace.duration_ms}ms)`);

    const inner = outer && typeof outer.data === "object" && outer.data !== null && "success" in outer.data
      ? outer.data
      : outer;

    if (outer && outer.success === false && outer.error && !inner.message) {
      inner.message = outer.error;
    }
    return inner;
  } catch (err) {
    const aborted = err.name === "AbortError";
    _trace.duration_ms = Date.now() - _t0;
    _trace.error_code = aborted ? "TIMEOUT" : "CONNECTION_ERROR";
    log("error", `[tongdai-api] Lỗi gọi ${url}: ${err.message}${err.cause ? ` — nguyên nhân: ${err.cause.code || ""} ${err.cause.message || err.cause}` : ""} (${_trace.duration_ms}ms)`);
    return {
      success: false,
      error_code: aborted ? "TIMEOUT" : "CONNECTION_ERROR",
      message: aborted ? "Máy chủ phản hồi quá lâu." : "Không kết nối được tới máy chủ.",
      data: null,
    };
  } finally {
    clearTimeout(timer);
    onApiTrace(_trace);
  }
}

// ── Cac ham endpoint - giu nguyen chu ky + duong dan so voi ban cu ───────

export async function getThongTinKhachHang(maDanhBo = null, sdt = null) {
  return callApi("/thong-tin-khach-hang", { query: { danhba: maDanhBo, sdt } });
}

export async function verifyCustomer(maDanhBo, sdt = null) {
  const r = await getThongTinKhachHang(maDanhBo, sdt);
  const list = Array.isArray(r.data) ? r.data : [];
  if (!r.success || list.length === 0) {
    return { valid: false, error: r.message || "Không tìm thấy thông tin khách hàng." };
  }
  return { valid: true, customers: list, customer: list[0] };
}

export async function getTienNuoc(maDanhBo, ky = null, nam = null) {
  return callApi("/tien-nuoc", { query: { danhba: maDanhBo, ky, nam } });
}

export async function getSanLuong(maDanhBo, ky = null, nam = null) {
  return callApi("/san-luong", { query: { danhba: maDanhBo, ky, nam } });
}

export async function getSoSanhTangGiam(maDanhBo, ky = null, nam = null) {
  return callApi("/so-sanh-tang-giam", { query: { danhba: maDanhBo, ky, nam } });
}

export async function getThongBaoCupNuoc(maDanhBo) {
  return callApi("/cup-nuoc", { query: { danhba: maDanhBo } });
}

export async function baoSuCo(maDanhBo, noiDung, tel) {
  return callApi("/bao-su-co", { method: "POST", body: { danhba: maDanhBo, noidung: noiDung, tel: tel } });
}

export async function getTrangThaiTT(maDanhBo, ky = null, nam = null) {
  return callApi("/trang-thai-thanh-toan", { query: { danhba: maDanhBo, ky, nam } });
}

export async function getAvailableAgents() {
  return callApi("/available-agents");
}
