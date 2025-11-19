const crypto = require("crypto");

const DOKU_BASE_URL = process.env.DOKU_BASE_URL || "https://api-sandbox.doku.com";

function generateDigest(body) {
  // For GET request, body is empty
  const jsonString = body ? JSON.stringify(body) : "";
  if (!jsonString) return "";
  
  const sha256Hash = crypto.createHash("sha256").update(jsonString, "utf-8").digest();
  return sha256Hash.toString("base64");
}

function generateSignature(clientId, requestId, timestamp, target, digest, secretKey) {
  const componentSignature = 
    `Client-Id:${clientId}\n` +
    `Request-Id:${requestId}\n` +
    `Request-Timestamp:${timestamp}\n` +
    `Request-Target:${target}` +
    (digest ? `\nDigest:${digest}` : ""); // Digest optional for GET

  const hmacSignature = crypto
    .createHmac("sha256", secretKey)
    .update(componentSignature, "utf-8")
    .digest("base64");

  return `HMACSHA256=${hmacSignature}`;
}

function getTimestamp() {
  return new Date().toISOString().split('.')[0] + 'Z';
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ 
      success: false, 
      error: "Method Not Allowed" 
    });
  }

  try {
    console.log("\n=== DOKU CHECK STATUS REQUEST ===");

    const clientId = process.env.DOKU_CLIENT_ID;
    const secretKey = process.env.DOKU_SECRET_KEY;

    if (!clientId || !secretKey) {
      throw new Error("DOKU_CLIENT_ID and DOKU_SECRET_KEY must be set");
    }

    // Get invoice_number from query or body
    const invoiceNumber = req.method === "GET" 
      ? req.query.invoice_number 
      : req.body.invoice_number;

    if (!invoiceNumber) {
      return res.status(400).json({
        success: false,
        error: "invoice_number is required"
      });
    }

    console.log("Checking status for invoice:", invoiceNumber);

    const requestId = crypto.randomUUID();
    const timestamp = getTimestamp();
    const target = `/orders/v1/status/${invoiceNumber}`;
    const digest = ""; // No digest for GET request
    const signature = generateSignature(clientId, requestId, timestamp, target, digest, secretKey);

    const headers = {
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      "Signature": signature
    };

    const apiUrl = `${DOKU_BASE_URL}${target}`;
    console.log("API URL:", apiUrl);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: headers
    });

    const responseText = await response.text();
    console.log("Status:", response.status);
    console.log("Response:", responseText);

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

    if (!response.ok) {
      console.error("DOKU API Error");
      return res.status(response.status).json({
        success: false,
        error: data.error?.message || data.message || "DOKU API error",
        errorDetails: data
      });
    }

    // Extract status info
    const orderStatus = data.order?.status; // ORDER_GENERATED, ORDER_EXPIRED
    const transactionStatus = data.transaction?.status; // SUCCESS, FAILED, PENDING
    const paymentChannel = data.channel?.id;

    console.log("Order Status:", orderStatus);
    console.log("Transaction Status:", transactionStatus);
    console.log("Payment Channel:", paymentChannel);

    return res.status(200).json({
      success: true,
      invoiceNumber: invoiceNumber,
      orderStatus: orderStatus,
      transactionStatus: transactionStatus,
      paymentChannel: paymentChannel,
      data: data
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
