// api/doku-create-payment.js
const crypto = require("crypto");

// === CONSTANTS ===
const FRONTEND_URL = "https://revitameal-82d2e.web.app";
const DOKU_BASE_URL = "https://api-sandbox.doku.com";

// ===== HELPER FUNCTIONS =====

/**
 * Generate Digest dari request body
 * PENTING: Hanya base64 string, TANPA prefix "SHA-256="
 * Sesuai dokumentasi DOKU: Digest = Base64(SHA256(JSON body))
 */
function generateDigest(body) {
  const json = JSON.stringify(body);
  const hash = crypto.createHash("sha256").update(json, "utf-8").digest();
  return Buffer.from(hash).toString("base64");
}

/**
 * Generate DOKU signature
 * Format: HMACSHA256=<base64_encoded_signature>
 */
function generateSignature(clientId, requestId, timestamp, target, digest, secretKey) {
  const stringToSign =
    `Client-Id:${clientId}\n` +
    `Request-Id:${requestId}\n` +
    `Request-Timestamp:${timestamp}\n` +
    `Request-Target:${target}\n` +
    `Digest:${digest}`;

  const hmac = crypto.createHmac("sha256", secretKey)
    .update(stringToSign)
    .digest("base64");

  return `HMACSHA256=${hmac}`;
}

/**
 * Generate timestamp dalam format ISO8601 UTC
 * Format: YYYY-MM-DDTHH:mm:ssZ
 * Contoh: 2020-08-11T08:45:42Z
 */
function getTimestamp() {
  return new Date().toISOString().split('.')[0] + 'Z';
}

// ===== MAIN HANDLER =====

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ success: false, error: "Method Not Allowed" });

  try {
    // ===== Validate Environment Variables =====
    if (!process.env.DOKU_CLIENT_ID || !process.env.DOKU_SECRET_KEY) {
      throw new Error("DOKU_CLIENT_ID and DOKU_SECRET_KEY must be configured");
    }

    // ===== Extract Request Data =====
    const {
      gross_amount,
      item_details,
      customer_details
    } = req.body;

    // Validasi basic
    if (!gross_amount || !item_details || !customer_details) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: gross_amount, item_details, customer_details"
      });
    }

    // Validasi customer details
    if (!customer_details.email) {
      return res.status(400).json({
        success: false,
        error: "Customer email is required"
      });
    }

    if (!customer_details.first_name && !customer_details.name) {
      return res.status(400).json({
        success: false,
        error: "Customer name is required"
      });
    }

    // ===== Generate Unique Invoice Number =====
    const invoiceNumber = `RM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // ===== Prepare Line Items =====
    const lineItems = item_details.map((item, index) => ({
      id: item.id || item.sku || `ITEM-${index + 1}`,
      name: item.name,
      price: Math.round(Number(item.price)),
      quantity: Number(item.quantity),
      sku: item.sku || item.id || `SKU-${index + 1}`,
      category: item.category || "food",
      url: item.url || FRONTEND_URL,
      image_url: item.image_url || "",
      type: item.type || "PRODUCT"
    }));

    // ===== Construct DOKU Request Payload =====
    // Sesuai dokumentasi: https://dashboard.doku.com/docs/docs/jokul-checkout/jokul-checkout-integration/
    const payload = {
      order: {
        amount: Math.round(Number(gross_amount)),
        invoice_number: invoiceNumber,
        currency: "IDR",
        
        // PENTING: Gunakan callback_url dan callback_url_cancel (BUKAN success_redirect_url)
        callback_url: `${FRONTEND_URL}/payment/success`,
        callback_url_cancel: `${FRONTEND_URL}/payment/cancel`,
        
        language: "ID",
        auto_redirect: true,
        line_items: lineItems
      },

      payment: {
        payment_due_date: 60 // dalam menit
      },

      customer: {
        id: customer_details.customer_id || `CUST-${Date.now()}`,
        name: customer_details.first_name || customer_details.name,
        last_name: customer_details.last_name || "",
        email: customer_details.email,
        phone: customer_details.phone || "",
        address: customer_details.address || "",
        city: customer_details.city || "",
        country: "ID"
      }
    };

    // ===== Generate Request Headers =====
    const requestId = crypto.randomUUID();
    const timestamp = getTimestamp();
    const target = "/checkout/v1/payment";
    const digest = generateDigest(payload);

    const signature = generateSignature(
      process.env.DOKU_CLIENT_ID,
      requestId,
      timestamp,
      target,
      digest,
      process.env.DOKU_SECRET_KEY
    );

    // PENTING: Sesuai dokumentasi DOKU, header Digest TIDAK dikirim
    // Digest hanya digunakan dalam pembuatan Signature
    const headers = {
      "Content-Type": "application/json",
      "Client-Id": process.env.DOKU_CLIENT_ID,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      "Signature": signature
    };

    console.log("=== DOKU API REQUEST ===");
    console.log("URL:", `${DOKU_BASE_URL}${target}`);
    console.log("Headers:", JSON.stringify(headers, null, 2));
    console.log("Payload:", JSON.stringify(payload, null, 2));

    // ===== Call DOKU API =====
    const response = await fetch(`${DOKU_BASE_URL}${target}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    console.log("=== DOKU API RESPONSE ===");
    console.log("Status:", response.status);
    console.log("Response:", JSON.stringify(data, null, 2));

    // ===== Handle Error Response =====
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.error?.message || data.message || "DOKU API error",
        details: data
      });
    }

    // ===== Validate Response =====
    if (!data.response?.payment?.url) {
      return res.status(500).json({
        success: false,
        error: "Invalid response from DOKU - no payment URL received",
        details: data
      });
    }

    // ===== Return Success Response =====
    // Response structure sesuai dokumentasi DOKU
    return res.status(200).json({
      success: true,
      message: data.message, // ["SUCCESS"]
      orderId: invoiceNumber,
      
      // Payment URL untuk redirect customer
      checkoutUrl: data.response.payment.url,
      redirectUrl: data.response.payment.url, // Alias
      
      // Token dan expiry info
      tokenId: data.response.payment.token_id,
      expiredDate: data.response.payment.expired_date, // Format: yyyyMMddHHmmss (contoh: 20230302192904)
      
      // Additional info
      sessionId: data.response.order?.session_id,
      uuid: data.response.uuid,
      
      // Full response untuk debugging
      dokuResponse: data.response
    });

  } catch (err) {
    console.error("=== ERROR ===", err);
    return res.status(500).json({
      success: false,
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};
