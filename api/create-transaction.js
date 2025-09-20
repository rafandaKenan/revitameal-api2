// api/create-transaction.js
const midtransClient = require('midtrans-client');
const cors = require('cors');

// Konfigurasi CORS.
// Izinkan semua origin. Atur ke domain frontend Anda di lingkungan produksi untuk keamanan.
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
    // Gunakan variabel lingkungan Vercel
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

module.exports = async (req, res) => {
    // Jalankan middleware CORS terlebih dahulu
    await runMiddleware(req, res, corsMiddleware);

    // Cek metode permintaan
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // Logika untuk membuat transaksi
        const orderId = `ORDER-${Date.now()}`;
        
        const { gross_amount, customer_details, item_details } = req.body;
        
        const parameter = {
            transaction_details: {
                order_id: orderId,
                gross_amount: gross_amount,
            },
            customer_details: customer_details,
            item_details: item_details,
        };

        const transactionToken = await snap.createTransaction(parameter);
        
        res.status(200).json({ token: transactionToken.token });

    } catch (error) {
        console.error("RAW MIDTRANS ERROR:", error);
  
  // Kirimkan respons seperti biasa
  res.status(500).json({ message: "Failed to create transaction" });
    }
};
