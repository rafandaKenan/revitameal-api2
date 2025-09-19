import Midtrans from 'midtrans-client';

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
    // Ambil data yang lebih detail dari body request
    const { orderId, grossAmount, customerDetails, itemDetails } = req.body;

    // Validasi data yang masuk
    if (!orderId || !grossAmount || !customerDetails || !itemDetails) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: parseInt(grossAmount),
      },
      customer_details: customerDetails,
      item_details: itemDetails,
      credit_card: {
        secure: true,
      },
    };

    // Buat transaksi dan dapatkan token
    const snapToken = await snap.createTransactionToken(parameter);

    console.log('Transaction Snap Token:', snapToken);
    res.status(200).json({ snapToken }); // Mengirim kembali 'snapToken' sesuai ekspektasi frontend

  } catch (error) {
    console.error('Error creating transaction:', error);
    // Mengirim pesan error yang lebih informatif dari Midtrans jika ada
    const errorMessage = error.ApiResponse ? error.ApiResponse.error_messages.join(', ') : error.message;
    res.status(500).json({ error: 'Failed to create transaction', details: errorMessage });
  }
}

