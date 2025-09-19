import Midtrans from 'midtrans-client';

// Pastikan Anda telah mengatur MIDTRANS_SERVER_KEY di Vercel Environment Variables
const snap = new Midtrans.Snap({
  isProduction: false, // Ganti ke `true` jika sudah live di mode produksi
  serverKey: process.env.MIDTRANS_SERVER_KEY,
});

export default async function handler(req, res) {
  // Hanya menerima method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { orderId, grossAmount, customerDetails, itemDetails } = req.body;

  // Validasi data yang diperlukan
  if (!orderId || grossAmount === undefined || !customerDetails || !itemDetails) {
    return res.status(400).json({ message: 'Missing required parameters' });
  }

  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    customer_details: customerDetails,
    item_details: itemDetails,
  };

  try {
    const transaction = await snap.createTransaction(parameter);
    const snapToken = transaction.token;

    // Kirimkan snapToken kembali ke frontend
    res.status(200).json({ snapToken });
  } catch (error) {
    console.error('Error creating Midtrans transaction:', error);
    res.status(500).json({ message: 'Failed to create transaction' });
  }
}
