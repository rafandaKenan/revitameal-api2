// api/create-transaction.js
const midtransClient = require('midtrans-client');
const cors = require('cors');

// --- LANGKAH DEBUGGING DIMULAI DI SINI ---
// Kita akan memeriksa isi environment variable SEBELUM GAGAL.
console.log("--- Vercel Function Initializing ---");
console.log("SERVER_KEY from env:", process.env.MIDTRANS_SERVER_KEY ? "✅ Loaded" : "❌ NOT FOUND");
console.log("CLIENT_KEY from env:", process.env.MIDTRANS_CLIENT_KEY ? "✅ Loaded" : "❌ NOT FOUND");
console.log("IS_PRODUCTION from env:", process.env.MIDTRANS_IS_PRODUCTION);
console.log("------------------------------------");
// --- LANGKAH DEBUGGING SELESAI ---

const corsMiddleware = cors({
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

// Inisialisasi Midtrans Snap API
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

  try {
    // Di Postman, pastikan Anda mengirim body JSON yang lengkap
    // seperti contoh yang saya berikan sebelumnya.
    const parameter = req.body; 
    const transaction = await snap.createTransaction(parameter);
    res.status(200).json({ token: transaction.token, redirect_url: transaction.redirect_url });

  } catch (error) {
    console.error("RAW MIDTRANS ERROR in CATCH BLOCK:", error);
    res.status(500).json({ message: "Failed to create transaction", error_details: error.message });
  }
};
