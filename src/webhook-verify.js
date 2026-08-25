// src/webhook-verify.js
//
// Giai doan 8 (xem docs/roadmap.md). Xac minh chu ky webhook OpenAI gui khi
// co cuoc goi SIP den (event "realtime.call.incoming") - dung chuan Svix
// (OpenAI dung Svix de gui webhook). Port GIU NGUYEN tu ban cu
// (voice_bot/src/webhook-verify.js) - la ham THUAN 100% (khong goi API,
// khong doc file), khong co "va race" nao de bo nhu cac module khac cua
// Giai doan 5/8.
// Tai lieu: https://developers.openai.com/api/docs/guides/webhooks
//
// Header OpenAI gui kem:
//   webhook-id        - unique ID cua delivery attempt
//   webhook-timestamp - Unix timestamp
//   webhook-signature - "v1,<base64_hmac_sha256>" (co the nhieu chu ky,
//                        cach nhau boi dau cach - chi can KHOP 1 cai)
//
// Dat o src/ (khong nam trong session/domain/call-flow/integrations) vi
// day la lop xac minh HTTP webhook dau vao, khac ban chat voi ca 4 thu muc
// kia (khong phai giao thuc WS realtime, khong phai logic nghiep vu, khong
// phai client goi API ra ngoai). Chi 1 file nen chua can tach thu muc rieng.

import crypto from "node:crypto";

/**
 * Verify webhook signature.
 * @param {Buffer|string} rawBody - Raw request body (PHAI la Buffer de tinh hash chinh xac - dung express.json({verify}) de luu lai, xem server.js khi noi that)
 * @param {object} headers        - Request headers (chu thuong, dung cach Express/Node http chuan hoa)
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, headers) {
  const secret = process.env.OPENAI_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[webhook-verify] OPENAI_WEBHOOK_SECRET chua cau hinh - bo qua xac minh chu ky!");
    return true; // Cho qua trong moi truong dev (giu dung hanh vi ban cu)
  }

  const msgId = headers["webhook-id"];
  const msgTimestamp = headers["webhook-timestamp"];
  const msgSig = headers["webhook-signature"];

  if (!msgId || !msgTimestamp || !msgSig) return false;

  // Kiem tra timestamp khong qua 5 phut cu (chong replay attack).
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(msgTimestamp, 10)) > 300) return false;

  // OpenAI dung Svix: secret co dang "whsec_<base64>" -> phai base64-decode
  // phan sau prefix truoc khi dung lam key HMAC.
  const secretBase64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const secretBytes = Buffer.from(secretBase64, "base64");

  // Signing string theo chuan Svix: "{msg_id}.{msg_timestamp}.{body}"
  const toSign = `${msgId}.${msgTimestamp}.${rawBody.toString()}`;
  const expectedSig = "v1," + crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");

  // So sanh voi tung signature trong header (co the co nhieu, ngan cach
  // boi dau cach - OpenAI/Svix co the gui kem chu ky cu khi xoay secret).
  return msgSig.split(" ").some((sig) => {
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expectedSig);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}
