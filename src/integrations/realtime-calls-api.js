// src/integrations/realtime-calls-api.js
//
// Giai doan 8 (xem docs/roadmap.md). Client goi REST that cua OpenAI
// Realtime Calls API (accept/reject/refer/hangup cho 1 cuoc goi SIP). Port
// tu ban cu (voice_bot/src/call-manager.js) - giu NGUYEN cac fix ky thuat
// THAT (vd 404 khi hangup = cuoc goi da ket thuc truoc, khong phai loi).
// Tai lieu: https://developers.openai.com/api/docs/api-reference/realtime-calls
//
// KHAC ban cu (2 quyet dinh kien truc, ghi ro de sau nay doi chieu):
//
//   1. TACH nghiep vu (SYSTEM_PROMPT/TOOLS/customerContext) ra khoi file
//      nay. Ban cu import thang "./system-prompt.js" va tu ghep chuoi
//      instructions ben trong acceptCall() - vi pham dung nguyen tac Giai
//      doan 5 da dat ra cho tongdai-api.js/calllog-api.js: lop client goi
//      REST API KHONG duoc biet gi ve noi dung nghiep vu. `acceptCall()` o
//      day nhan THANG `sessionFields` (model/reasoning/instructions/tools/
//      audio) da duoc lop goi (ben tren, se viet khi noi that vao
//      server.js/webhook that) chuan bi san - giong cach billing.js/
//      outages.js nhan du lieu da chuan hoa, khong tu di tra API roi tu
//      dinh dang cau cho khach.
//
//   2. BO 2 setTimeout() an trong referCall()/hangupCall() cua ban cu (2000ms
//      va 3000ms). Doc lai ky: day la "va race" cua kien truc cu - ban cu
//      KHONG co tin hieu dang tin cay de biet "AI da noi xong loi chao tam
//      biet/chuyen may chua", nen goi hangup/refer NGAY khi tool tra ve
//      action:"end_call"/"transfer_to_agent" (xem src/domain/call-control.js)
//      roi TU CHE bang 1 khoang cho co dinh, hy vong TTS kip phat xong truoc
//      khi cuoc goi that su bi cup. Du an moi KHONG can vay nay nua -
//      turn-controller.js/turn-signal.js (Giai doan 2-3) da co tin hieu
//      that "response-ended" (AI da noi xong). Dung nguyen tac da thong
//      nhat tu Giai doan 5 ("giu phan nghiep vu that, bo phan chi ton tai
//      de va race cua kien truc cu - turn-controller da lo viec do"): BO
//      han 2 setTimeout nay, de nguyen goi REST NGAY khi duoc goi - lop
//      tich hop that (chua viet, se noi khi wiring dispatch-tool-call.js
//      that voi call-manager nay) chiu trach nhiem CHO dung luc (nghe
//      "response-ended" roi moi goi referCall/hangupCall), khong phai
//      client REST nay tu doan gio bang timer co dinh.
//
// GIU NGUYEN (khong doan, port dung tu ban cu):
//   - acceptCall(): tra ve CHINH body DA GUI (khong phai response cua
//     OpenAI) - ban cu ghi ro chu y "de logger luu lai (phan tich/dieu
//     chinh prompt)", giu dung hanh vi nay.
//   - hangupCall(): HTTP 404 tu OpenAI = cuoc goi da ket thuc truoc do ->
//     coi nhu thanh cong, KHONG nem loi.
//   - acceptCall()/rejectCall() THROW khi that bai (khac quy uoc {success,
//     ...} cua tongdai-api.js/calllog-api.js) - giu dung ban cu vi day la
//     that bai THIET LAP cuoc goi, khong co gi de "tra ve loi nhe nhang"
//     cho khach nghe duoc nua (ben goi - webhook handler - da tu bao boc
//     try/catch san, xem server.js ban cu). referCall()/hangupCall() NUOT
//     loi (khong throw, chi log) - dung ban cu, vi 2 hanh dong nay la
//     best-effort, khong co gi lam them duoc neu that bai.
//
// Doc bien moi truong LUOI (trong ham, khong phai hang so tinh 1 lan luc
// import) - dung quy uoc tongdai-api.js/calllog-api.js, de test duoc de
// dang bang cach doi process.env giua cac test case.

let log = () => {};
export function setCallsApiLogger(fn) {
  log = typeof fn === "function" ? fn : () => {};
}

const BASE = "https://api.openai.com/v1/realtime/calls";

function _authHeaders() {
  return {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}`,
    "Content-Type": "application/json",
  };
}

/**
 * Accept 1 incoming call + cau hinh Realtime session ngay luc accept.
 * @param {string} callId
 * @param {{model?:string, reasoning?:object, instructions?:string, tools?:array, audio?:object}} sessionFields
 *   Da chuan bi san boi lop goi (KHONG tu ghep noi dung nghiep vu o day).
 * @returns {Promise<object>} - body DA GUI (khong phai response cua OpenAI - xem ghi chu dau file)
 */
export async function acceptCall(callId, sessionFields = {}) {
  const body = { type: "realtime", ...sessionFields };

  log("info", `[realtime-calls-api] Accepting call ${callId}`);
  const res = await fetch(`${BASE}/${callId}/accept`, {
    method: "POST",
    headers: _authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Accept call failed ${res.status}: ${text}`);
  }

  log("info", `[realtime-calls-api] Call ${callId} accepted`);
  return body;
}

/**
 * Tu choi 1 incoming call.
 * @param {string} callId
 * @param {number} statusCode - SIP status code (mac dinh 486 = busy)
 */
export async function rejectCall(callId, statusCode = 486) {
  log("info", `[realtime-calls-api] Rejecting call ${callId} (${statusCode})`);
  const res = await fetch(`${BASE}/${callId}/reject`, {
    method: "POST",
    headers: _authHeaders(),
    body: JSON.stringify({ status_code: statusCode }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reject call failed ${res.status}: ${text}`);
  }
}

/**
 * Chuyen may (SIP REFER) sang URI khac. Goi NGAY khi duoc goi (khong tu
 * tre nhu ban cu) - ben goi tu chon dung luc (vd sau tin hieu
 * "response-ended" cua turn-controller.js).
 * @param {string} callId
 * @param {string} targetUri - VD: "sip:200@asterisk_host" hoac "tel:+84901234567"
 */
export async function referCall(callId, targetUri) {
  log("info", `[realtime-calls-api] Referring call ${callId} -> ${targetUri}`);
  try {
    const res = await fetch(`${BASE}/${callId}/refer`, {
      method: "POST",
      headers: _authHeaders(),
      body: JSON.stringify({ target_uri: targetUri }),
    });
    if (!res.ok) {
      const text = await res.text();
      log("error", `[realtime-calls-api] Refer ${callId} that bai ${res.status}: ${text}`);
      return { success: false, error_code: `HTTP_${res.status}`, message: text };
    }
    log("info", `[realtime-calls-api] Refer ${callId} thanh cong`);
    return { success: true };
  } catch (err) {
    log("error", `[realtime-calls-api] Refer ${callId} loi mang: ${err.message}`);
    return { success: false, error_code: "CONNECTION_ERROR", message: err.message };
  }
}

/**
 * Cup may. Goi NGAY khi duoc goi (khong tu tre nhu ban cu) - xem ghi chu
 * dau file. HTTP 404 = cuoc goi da ket thuc truoc do, coi nhu thanh cong.
 * @param {string} callId
 */
export async function hangupCall(callId) {
  log("info", `[realtime-calls-api] Hanging up call ${callId}`);
  try {
    const res = await fetch(`${BASE}/${callId}/hangup`, {
      method: "POST",
      headers: _authHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404) {
        log("info", `[realtime-calls-api] Hangup ${callId}: cuoc goi da ket thuc truoc do (404), bo qua.`);
        return { success: true, alreadyEnded: true };
      }
      log("error", `[realtime-calls-api] Hangup ${callId} that bai ${res.status}: ${text}`);
      return { success: false, error_code: `HTTP_${res.status}`, message: text };
    }
    log("info", `[realtime-calls-api] Hangup ${callId} thanh cong`);
    return { success: true };
  } catch (err) {
    log("error", `[realtime-calls-api] Hangup ${callId} loi mang: ${err.message}`);
    return { success: false, error_code: "CONNECTION_ERROR", message: err.message };
  }
}
