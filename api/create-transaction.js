// api/create-transaction.js
const midtransClient = require('midtrans-client');
const cors = require('cors');

// (Opsional) Baris-baris log ini bisa Anda hapus jika Anda sudah yakin
// Environment Variables sudah terbaca dengan benar.
console.log("--- Vercel Function Initializing ---");
console.log("SERVER_KEY from env:", process.env.MIDTRANS_SERVER_KEY ? "✅ Loaded" : "❌ NOT FOUND");
console.log("CLIENT_KEY from env:", process.env.MIDTRANS_CLIENT_KEY ? "✅ Loaded" : "❌ NOT FOUND");
console.log("IS_PRODUCTION from env:", process.env.MIDTRANS_IS_PRODUCTION);
console.log("------------------------------------");

const corsMiddleware = cors({
  // Di tahap produksi, ganti '*' dengan domain frontend Anda
  origin: '*', 
  methods: ['POST'],
  allowedHeaders: ['Content-Type'],
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

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

  // Gunakan try...catch untuk menangani error
  try {
    // Langsung ambil seluruh body dari Postman/frontend
    const parameter = req.body; 

    // Ganti atau tambahkan order_id yang unik dari sisi server
    // Untuk mencegah order_id yang sama dikirim berkali-kali dari client.
    parameter.transaction_details.order_id = `ORDER-${Date.now()}`;

    const transaction = await snap.createTransaction(parameter);
    
    // Kirim token dan redirect_url jika berhasil
    res.status(200).json({ token: transaction.token, redirect_url: transaction.redirect_url });

  } catch (error) {
    // === BAGIAN YANG HILANG ADA DI SINI ===
    // Jika terjadi error, log detailnya di Vercel
    console.error("Error creating Midtrans transaction:", error);
    
    // Kirim respons error yang jelas ke client
    res.status(500).json({ 
      message: "Failed to create transaction", 
      error_details: error.message 
    });
  }
};
