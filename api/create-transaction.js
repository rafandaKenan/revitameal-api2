import Midtrans from 'midtrans-client';
import crypto from 'crypto';

// Inisialisasi Snap dari Midtrans
const snap = new Midtrans.Snap({
  isProduction: false, // Ganti ke `true` jika sudah production
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { amount, customerName, customerEmail } = req.body;

    // Pastikan data yang dibutuhkan ada
    if (!amount || !customerName || !customerEmail) {
        return res.status(400).json({ error: 'Missing required fields: amount, customerName, customerEmail' });
    }

    // Buat ID pesanan yang unik
    const orderId = `REVITAMEAL-${crypto.randomUUID()}`;

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: parseInt(amount),
      },
      customer_details: {
        first_name: customerName,
        email: customerEmail,
      },
      credit_card: {
        secure: true,
      },
    };

    // Buat transaksi dan dapatkan token
    const token = await snap.createTransactionToken(parameter);

    console.log('Transaction Token:', token);
    res.status(200).json({ token });

  } catch (error) {
    console.error('Error creating transaction:', error.message);
    res.status(500).json({ error: 'Failed to create transaction', details: error.message });
  }
}
