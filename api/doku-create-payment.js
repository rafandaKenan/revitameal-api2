// api/doku-create-payment.js
const crypto = require("crypto");

// === CONSTANTS ===
const FRONTEND_URL = "https://revitameal-82d2e.web.app";
const CALLBACK_URL = "https://revitameal-api2.vercel.app/api/doku-notification";
const DOKU_BASE_URL = "https://api-sandbox.doku.com";

// ===== HELPER FUNCTIONS =====

// Generate Digest header → "SHA-256=<base64>"
function generateDigest(body) {
  const json = JSON.stringify(body);
  const hash = crypto.createHash("sha256").update(json, "utf-8").digest("base64");
  return `SHA-256=${hash}`;
}

// Generate DOKU signature
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

// Clean timestamp → remove milliseconds
function getTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}/, "");
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
    // ===== Extract fields =====
    const {
      gross_amount,
      item_details,
      customer_details
    } = req.body;

    if (!gross_amount || !item_details || !customer_details) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields"
      });
    }

    // ===== Create unique invoice =====
    const invoiceNumber = `RM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // === Prepare line_items ===
    const lineItems = item_details.map((item) => ({
      id: item.id || item.sku,
      name: item.name,
      price: Math.round(item.price),
      quantity: item.quantity,
      sku: item.sku || item.id,
      category: item.category || "food",
      type: "PRODUCT"
    }));

    // ===== DOKU Payload =====
    const payload = {
      order: {
        amount: Math.round(gross_amount),
        invoice_number: invoiceNumber,
        currency: "IDR",

        // Webhook
        callback_url: CALLBACK_URL,

        // Redirects
        success_redirect_url: `${FRONTEND_URL}/payment/success`,
        failed_redirect_url: `${FRONTEND_URL}/payment/cancel`,

        language: "ID",
        auto_redirect: true,
        line_items: lineItems
      },

      payment: {
        payment_due_date: 60
      },

      customer: {
        id: `CUST-${Date.now()}`,
        name: customer_details.first_name || customer_details.name,
        last_name: customer_details.last_name || "",
        email: customer_details.email,
        phone: customer_details.phone || "",
        address: customer_details.address || "",
        city: customer_details.city || "",
        country: "ID"
      }
    };

    // ===== Generate headers =====
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

    const headers = {
      "Content-Type": "application/json",
      "Client-Id": process.env.DOKU_CLIENT_ID,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      "Digest": digest,
      "Signature": signature
    };

    console.log("=== DOKU REQUEST HEADERS ===", headers);

    // ===== Call DOKU API =====
    const response = await fetch(`${DOKU_BASE_URL}${target}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    console.log("=== DOKU RESPONSE ===", data);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.error?.message || "DOKU API error",
        details: data
      });
    }

    if (!data.response?.payment?.url) {
      return res.status(500).json({
        success: false,
        error: "Invalid response from DOKU",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      orderId: invoiceNumber,
      checkoutUrl: data.response.payment.url,
      tokenId: data.response.payment.token_id,
      expiredDatetime: data.response.payment.expired_datetime
    });

  } catch (err) {
    console.error("=== ERROR ===", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
