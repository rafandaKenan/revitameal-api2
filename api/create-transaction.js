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
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'false',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

module.exports = async (req, res) => {
  await runMiddleware(req, res, corsMiddleware);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Deklarasikan 'parameter' di sini agar bisa diakses oleh blok catch
  let parameter;

  try {
    // Isi nilainya di dalam blok try
    parameter = req.body; 

    // Ganti atau tambahkan order_id yang unik dari sisi server
    parameter.transaction_details.order_id = `ORDER-${Date.now()}`;

    const transaction = await snap.createTransaction(parameter);
    
    res.status(200).json({ token: transaction.token, redirect_url: transaction.redirect_url });

  } catch (error) {
    // Bagian ini sekarang lebih canggih
    console.error("Error creating Midtrans transaction:", error);
    
    // Kirim respons error yang jelas DAN data yang menyebabkan error
    res.status(500).json({ 
      message: "Failed to create transaction", 
      error_details: error.message,
      // INI BAGIAN PENTING: Kita kirim kembali data yang kita terima
      sent_parameters: parameter 
    });
  }
};
