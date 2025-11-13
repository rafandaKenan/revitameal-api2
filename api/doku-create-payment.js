const crypto = require("crypto");

/**
 * DOKU Hosted Payment Page (HPP) - Vercel API Route
 * Endpoint: /api/doku-payment
 */

function generateDigest(jsonBody) {
  const jsonString = JSON.stringify(jsonBody);
  const hash = crypto.createHash("sha256").update(jsonString, "utf-8").digest();
  return Buffer.from(hash).toString("base64");
}

function generateSignature(clientId, requestId, timestamp, target, digest, secretKey) {
  let signatureString = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${target}`;
  if (digest) signatureString += `\nDigest:${digest}`;

  const hmac = crypto.createHmac("sha256", secretKey)
    .update(signatureString)
    .digest();

  return `HMACSHA256=${Buffer.from(hmac).toString("base64")}`;
}

function generateRequestId() {
  return crypto.randomUUID();
}

function generateTimestamp() {
  return new Date().toISOString().split(".")[0] + "Z";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  try {
    const {
      gross_amount,
      item_details,
      customer_details,
      payment_due_date = 60,
      payment_method_types
    } = req.body;

    // Validation
    if (!gross_amount || !item_details || !customer_details)
      return res.status(400).json({ message: "Missing required fields" });

    const totalCalc = item_details.reduce((sum, x) => sum + (x.price * x.quantity), 0);
    if (totalCalc !== gross_amount)
      return res.status(400).json({
        message: `Amount mismatch. Client=${gross_amount}, Server=${totalCalc}`
      });

    const orderId = `REVITAMEAL-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const lineItems = item_details.map((item, i) => ({
      id: item.id || `ITEM-${i + 1}`,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      sku: item.sku || `SKU-${i + 1}`,
      category: item.category || "general",
      type: "PRODUCT"
    }));

    const dokuBody = {
      order: {
        amount: Number(gross_amount),
        invoice_number: orderId,
        currency: "IDR",

        // ⬇ INI URL YANG MASUK DASHBOARD DOKU
        callback_url: process.env.DOKU_CALLBACK_URL,

        // ⬇ INI ALAMAT REDIRECT FRONTEND
        success_redirect_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payment/success`,
        failed_redirect_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payment/cancel`,

        line_items: lineItems
      },
      payment: {
        payment_due_date: payment_due_date
      },
      customer: {
        id: customer_details.customer_id || `CUST-${Date.now()}`,
        name: customer_details.first_name,
        email: customer_details.email,
        phone: customer_details.phone || "",
        address: customer_details.address || "",
        country: "ID"
      }
    };

    if (payment_method_types) {
      dokuBody.payment.payment_method_types = payment_method_types;
    }

    const clientId = process.env.DOKU_CLIENT_ID;
    const secretKey = process.env.DOKU_SECRET_KEY;
    const baseUrl = process.env.DOKU_BASE_URL || "https://api-sandbox.doku.com";

    const endpoint = "/checkout/v1/payment";
    const apiUrl = baseUrl + endpoint;

    const requestId = generateRequestId();
    const timestamp = generateTimestamp();
    const digest = generateDigest(dokuBody);
    const signature = generateSignature(
      clientId,
      requestId,
      timestamp,
      endpoint,
      digest,
      secretKey
    );

    console.log("---- DOKU REQUEST ----");
    console.log(apiUrl);
    console.log(JSON.stringify(dokuBody, null, 2));

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Id": clientId,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        "Signature": signature
      },
      body: JSON.stringify(dokuBody)
    });

    const data = await response.json();

    console.log("---- DOKU RESPONSE ----");
    console.log(JSON.stringify(data, null, 2));

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: data.message,
        error: data
      });
    }

    return res.status(200).json({
      success: true,
      orderId,
      checkoutUrl: data.response.payment.url,
      tokenId: data.response.payment.token_id,
      expiredDate: data.response.payment.expired_date
    });

  } catch (err) {
    console.error("DOKU Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
