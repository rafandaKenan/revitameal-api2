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

  // Coba parse body permintaan sebagai JSON
  let body;
  try {
    body = req.body;
  } catch (error) {
    console.error('Failed to parse request body as JSON:', error);
    return res.status(400).json({ message: 'Invalid JSON body' });
  }

  const { orderId, grossAmount, customerDetails, itemDetails } = body;

  // Validasi data yang diperlukan dan berikan pesan error spesifik
  if (!orderId) {
    console.error('Missing orderId');
    return res.status(400).json({ message: 'Missing orderId' });
  }
  if (grossAmount === undefined) {
    console.error('Missing grossAmount');
    return res.status(400).json({ message: 'Missing grossAmount' });
  }
  if (!customerDetails) {
    console.error('Missing customerDetails');
    return res.status(400).json({ message: 'Missing customerDetails' });
  }
  if (!itemDetails) {
    console.error('Missing itemDetails');
    return res.status(400).json({ message: 'Missing itemDetails' });
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
