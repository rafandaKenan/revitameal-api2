// api/doku-create-payment.js
const crypto = require("crypto");

// === CONSTANTS ===
const FRONTEND_URL = "https://revitameal-82d2e.web.app";

// Base URL DOKU - HARUS SESUAI dengan environment credential
// Gunakan environment variable untuk flexibility
const DOKU_BASE_URL = process.env.DOKU_BASE_URL || "https://sandbox.doku.com";

// ===== HELPER FUNCTIONS =====

/**
 * Generate Digest dari request body
 */
function generateDigest(body) {
  const jsonString = JSON.stringify(body);
  const sha256Hash = crypto.createHash("sha256").update(jsonString, "utf-8").digest();
  return sha256Hash.toString("base64");
}

/**
 * Generate DOKU Signature
 */
function generateSignature(clientId, requestId, timestamp, target, digest, secretKey) {
  const componentSignature = 
    `Client-Id:${clientId}\n` +
    `Request-Id:${requestId}\n` +
    `Request-Timestamp:${timestamp}\n` +
    `Request-Target:${target}\n` +
    `Digest:${digest}`;

  const hmacSignature = crypto
    .createHmac("sha256", secretKey)
    .update(componentSignature, "utf-8")
    .digest("base64");

  return `HMACSHA256=${hmacSignature}`;
}

/**
 * Generate timestamp ISO8601 UTC
 */
function getTimestamp() {
  return new Date().toISOString().split('.')[0] + 'Z';
}

/**
 * Determine correct endpoint based on base URL
 */
function getEndpoint(baseUrl) {
  if (baseUrl.includes('api-sandbox.doku.com') || baseUrl.includes('api.doku.com')) {
    return '/checkout/v1/payment';
  } else {
    return '/suite/checkout/v1/payment';
  }
}

// ===== MAIN HANDLER =====

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ 
      success: false, 
      error: "Method Not Allowed" 
    });
  }

  try {
    console.log("\n=== DOKU PAYMENT REQUEST START ===");
    
    // ===== Validate Environment Variables =====
    const clientId = process.env.DOKU_CLIENT_ID;
    const secretKey = process.env.DOKU_SECRET_KEY;

    if (!clientId || !secretKey) {
      throw new Error("DOKU_CLIENT_ID and DOKU_SECRET_KEY must be set");
    }

    console.log("Environment:", DOKU_BASE_URL);
    console.log("Client ID:", clientId);

    // ===== Extract & Validate Request Data =====
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

    // ===== Generate Invoice =====
    const invoiceNumber = `RM-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    console.log("Invoice:", invoiceNumber);

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

    // ===== Construct Payload =====
    const payload = {
      order: {
        amount: Math.round(Number(gross_amount)),
        invoice_number: invoiceNumber,
        currency: "IDR",
        callback_url: `${FRONTEND_URL}/payment/success`,
        callback_url_cancel: `${FRONTEND_URL}/payment/cancel`,
        language: "ID",
        auto_redirect: true,
        line_items: lineItems
      },
      payment: {
        payment_due_date: 60
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

    // ===== Generate Headers =====
    const requestId = crypto.randomUUID();
    const timestamp = getTimestamp();
    const target = getEndpoint(DOKU_BASE_URL);
    const digest = generateDigest(payload);
    const signature = generateSignature(clientId, requestId, timestamp, target, digest, secretKey);

    const headers = {
      "Content-Type": "application/json",
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      "Signature": signature
    };

    // ===== Call DOKU API =====
    const apiUrl = `${DOKU_BASE_URL}${target}`;
    console.log("API URL:", apiUrl);
    console.log("Headers:", JSON.stringify(headers, null, 2));

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log("Status:", response.status);
    console.log("Response:", responseText);

    // Parse response
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Parse error:", parseError);
      return res.status(500).json({
        success: false,
        error: "Invalid response from DOKU",
        details: responseText
      });
    }

    // ===== Handle Error =====
    if (!response.ok) {
      console.error("DOKU API Error");
      return res.status(response.status).json({
        success: false,
        error: data.error?.message || data.message || "DOKU API error",
        errorDetails: data
      });
    }

    // ===== Validate Response =====
    if (!data.response?.payment?.url) {
      console.error("No payment URL");
      return res.status(500).json({
        success: false,
        error: "Invalid response - no payment URL",
        response: data
      });
    }

    console.log("✅ Success");
    console.log("Checkout URL:", data.response.payment.url);

    // ===== Return Success =====
    return res.status(200).json({
      success: true,
      message: data.message,
      orderId: invoiceNumber,
      checkoutUrl: data.response.payment.url,
      redirectUrl: data.response.payment.url,
      tokenId: data.response.payment.token_id,
      expiredDate: data.response.payment.expired_date,
      sessionId: data.response.order?.session_id,
      uuid: data.response.uuid,
      dokuResponse: data.response
    });

  } catch (err) {
    console.error("Exception:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  } finally {
    console.log("=== END ===\n");
  }
};
