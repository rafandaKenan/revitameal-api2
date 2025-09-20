// api/create-transaction.js
const midtransClient = require('midtrans-client');
const cors = require('cors');

// ... (kode corsMiddleware dan runMiddleware tetap sama) ...
const corsMiddleware = cors({ origin: '*', methods: ['POST'], allowedHeaders: ['Content-Type'] });
function runMiddleware(req, res, fn) { /* ... implementasi sama ... */ }

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

module.exports = async (req, res) => {
  await runMiddleware(req, res, corsMiddleware);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let parameter;
  try {
    parameter = req.body;
    const uniqueOrderId = ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 5)};
    parameter.transaction_details.order_id = uniqueOrderId;
    parameter.credit_card = { secure: true };

    const transaction = await snap.createTransaction(parameter);
    res.status(200).json({ snapToken: transaction.token, redirect_url: transaction.redirect_url });

  } catch (error) {
    // --- BLOK ERROR HANDLING BARU ---
    console.error("Error creating Midtrans transaction:", JSON.stringify(error, null, 2));

    // Cek apakah ini error spesifik dari API Midtrans
    if (error.httpStatusCode) {
      // Jika ya, gunakan status code dan pesan dari Midtrans
      const statusCode = parseInt(error.httpStatusCode, 10);
      const errorMessage = error.ApiResponse?.error_messages || ["An error occurred with the payment gateway."];
      
      res.status(statusCode).json({
        message: "Midtrans API Error",
        error_details: errorMessage,
        midtrans_status_code: statusCode,
        sent_parameters: parameter // Opsional: tetap kirim parameter untuk debug
      });
    } else {
      // Jika ini error lain (internal), gunakan respons 500
      res.status(500).json({
        message: "Internal Server Error",
        error_details: error.message,
        sent_parameters: parameter
      });
    }
    // --- AKHIR BLOK BARU ---
  }
};
