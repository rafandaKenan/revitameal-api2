import Midtrans from 'midtrans-client';

// Inisialisasi Core API dari Midtrans untuk verifikasi notifikasi
const coreApi = new Midtrans.CoreApi({
    isProduction: false, // Ganti ke `true` jika sudah production
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const notificationJson = req.body;

        // Verifikasi notifikasi dari Midtrans
        const statusResponse = await coreApi.transaction.notification(notificationJson);
        
        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        console.log(`Transaction notification received. Order ID: ${orderId}. Transaction status: ${transactionStatus}. Fraud status: ${fraudStatus}`);

        // Lakukan logika bisnis berdasarkan status transaksi
        if (transactionStatus == 'capture') {
            // Untuk pembayaran dengan kartu kredit
            if (fraudStatus == 'challenge') {
                // TODO: challenge
                console.log(`Order ID ${orderId} is challenged by FDS`);
            } else if (fraudStatus == 'accept') {
                // TODO: set transaction status on your database to 'success'
                console.log(`Payment for Order ID ${orderId} is successful.`);
                // TODO: Update status pesanan di database Anda menjadi 'SUCCESS'
            }
        } else if (transactionStatus == 'settlement') {
            // TODO: set transaction status on your database to 'success'
            console.log(`Payment for Order ID ${orderId} is settled (successful).`);
            // TODO: Update status pesanan di database Anda menjadi 'SUCCESS'
        } else if (transactionStatus == 'cancel' ||
                   transactionStatus == 'deny' ||
                   transactionStatus == 'expire') {
            // TODO: set transaction status on your database to 'failure'
            console.log(`Payment for Order ID ${orderId} failed.`);
            // TODO: Update status pesanan di database Anda menjadi 'FAILED'
        } else if (transactionStatus == 'pending') {
            // TODO: set transaction status on your database to 'pending' / waiting payment
            console.log(`Payment for Order ID ${orderId} is pending.`);
            // TODO: Update status pesanan di database Anda menjadi 'PENDING'
        }
        
        // Kirim respons 200 OK agar Midtrans tahu notifikasi sudah diterima
        res.status(200).json({ status: 'ok' });

    } catch (error) {
        console.error('Error processing notification:', error.message);
        res.status(500).json({ error: 'Notification processing failed', details: error.message });
    }
}
