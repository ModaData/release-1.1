// File: lib/tencent-cloud-auth.js — TC3-HMAC-SHA256 signing for Tencent Cloud APIs
import crypto from "crypto";

const SECRET_ID = process.env.TENCENT_SECRET_ID;
const SECRET_KEY = process.env.TENCENT_SECRET_KEY;

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

/**
 * Make a signed request to a Tencent Cloud API.
 *
 * @param {string} service  - e.g. "hunyuan"
 * @param {string} action   - e.g. "SubmitHunyuanTo3DRapidJob"
 * @param {object} payload  - JSON body
 * @param {object} [options]
 * @param {string} [options.region]  - default "ap-singapore"
 * @param {string} [options.version] - API version, default "2023-09-01"
 * @param {string} [options.host]    - override host (default: international endpoint)
 * @returns {Promise<object>} parsed JSON response
 */
export async function signedFetch(service, action, payload, options = {}) {
  if (!SECRET_ID || !SECRET_KEY) {
    throw new Error("TENCENT_SECRET_ID and TENCENT_SECRET_KEY must be set in .env.local");
  }

  const region = options.region || "ap-singapore";
  const version = options.version || "2023-09-01";
  const host = options.host || `${service}.intl.tencentcloudapi.com`;
  const endpoint = `https://${host}`;

  const now = new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const body = JSON.stringify(payload);

  // 1. Canonical Request
  const httpMethod = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const contentType = "application/json; charset=utf-8";
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const hashedPayload = sha256Hex(body);

  const canonicalRequest = [
    httpMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  // 2. String to Sign
  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = `${dateStr}/${service}/tc3_request`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);

  const stringToSign = [
    algorithm,
    timestamp.toString(),
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  // 3. Signing Key
  const secretDate = hmacSha256(`TC3${SECRET_KEY}`, dateStr);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, "tc3_request");

  // 4. Signature
  const signature = crypto
    .createHmac("sha256", secretSigning)
    .update(stringToSign)
    .digest("hex");

  // 5. Authorization header
  const authorization = `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // 6. Make request
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Host: host,
      Authorization: authorization,
      "X-TC-Action": action,
      "X-TC-Timestamp": timestamp.toString(),
      "X-TC-Version": version,
      "X-TC-Region": region,
    },
    body,
  });

  const data = await res.json();

  if (data.Response?.Error) {
    const err = data.Response.Error;
    throw new Error(`Tencent Cloud [${err.Code}]: ${err.Message}`);
  }

  return data.Response;
}
