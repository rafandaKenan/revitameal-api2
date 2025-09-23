const midtransClient = require('midtrans-client');

// Initialize Core API client for transaction verification
const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Firebase Admin SDK setup
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

// Helper functions untuk handle berbagai status
async function handlePaymentSuccess(orderId, statusResponse) {
  console.log(`✅ Payment SUCCESS for order: ${orderId}`);
  
  // TODO: Implementasi logic ketika pembayaran berhasil
  // - Update inventory/stock
  // - Send confirmation email to customer
  // - Send notification to admin
  // - Trigger fulfillment process
  
  try {
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentConfirmed: true,
      // Add any additional fields you need
    });
    
    // Send email confirmation
    // await sendPaymentConfirmationEmail(orderId);
    
    // Update product stock if needed
    // await updateProductStock(orderId);
    
  } catch (error) {
    console.error('Error in handlePaymentSuccess:', error);
  }
}

async function handlePaymentPending(orderId, statusResponse) {
  console.log(`⏳ Payment PENDING for order: ${orderId}`);
  
  // TODO: Implementasi logic ketika pembayaran pending
  // - Send payment instructions to customer
  // - Set reminder notifications
  // - Hold inventory
  
  try {
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.update({
      status: 'pending',
      paymentInstructions: statusResponse.va_numbers || statusResponse.permata_va_number || statusResponse.bca_va_number,
      pendingAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    // Send payment instructions email
    // await sendPaymentInstructionsEmail(orderId, statusResponse);
    
  } catch (error) {
    console.error('Error in handlePaymentPending:', error);
  }
}

async function handlePaymentCancelled(orderId, statusResponse) {
  console.log(`❌ Payment CANCELLED for order: ${orderId}`);
  
  // TODO: Implementasi logic ketika pembayaran dibatalkan
  // - Release held inventory
  // - Send cancellation notification
  // - Clean up any related data
  
  try {
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancellationReason: 'Payment cancelled by user or system',
    });
    
    // Release inventory
    // await releaseInventory(orderId);
    
    // Send cancellation email
    // await sendCancellationEmail(orderId);
    
  } catch (error) {
    console.error('Error in handlePaymentCancelled:', error);
  }
}

async function handlePaymentExpired(orderId, statusResponse) {
  console.log(`⏰ Payment EXPIRED for order: ${orderId}`);
  
  // TODO: Implementasi logic ketika pembayaran expired
  // - Release held inventory
  // - Send expiration notification
  // - Archive the order
  
  try {
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.update({
      status: 'expired',
      expiredAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    // Release inventory
    // await releaseInventory(orderId);
    
    // Send expiration email
    // await sendExpirationEmail(orderId);
    
  } catch (error) {
    console.error('Error in handlePaymentExpired:', error);
  }
}

async function handlePaymentDenied(orderId, statusResponse) {
  console.log(`🚫 Payment DENIED for order: ${orderId}`);
  
  // TODO: Implementasi logic ketika pembayaran ditolak
  // - Release held inventory
  // - Send denial notification with reason
  // - Log for fraud analysis if needed
  
  try {
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.update({
      status: 'denied',
      deniedAt: admin.firestore.FieldValue.serverTimestamp(),
      denialReason: statusResponse.status_message || 'Payment denied by payment processor',
    });
    
    // Release inventory
    // await releaseInventory(orderId);
    
    // Send denial email
    // await sendPaymentDeniedEmail(orderId);
    
  } catch (error) {
    console.error('Error in handlePaymentDenied:', error);
  }
}

async function handlePaymentRefunded(orderId, statusResponse) {
  console.log(`💰 Payment REFUNDED for order: ${orderId}`);
  
  // TODO: Implementasi logic ketika pembayaran di-refund
  // - Update order status
  // - Send refund confirmation
  // - Handle inventory if product not shipped yet
  
  try {
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.update({
      status: 'refunded',
      refundedAt: admin.firestore.FieldValue.serverTimestamp(),
      refundAmount: statusResponse.refund_amount || statusResponse.gross_amount,
    });
    
    // Send refund confirmation email
    // await sendRefundConfirmationEmail(orderId, statusResponse.refund_amount);
    
  } catch (error) {
    console.error('Error in handlePaymentRefunded:', error);
  }
}

async function handleFraudChallenge(orderId, statusResponse) {
  console.log(`🔍 Payment FRAUD CHALLENGE for order: ${orderId}`);
  
  // TODO: Implementasi logic ketika pembayaran di-challenge karena fraud
  // - Hold the order for manual review
  // - Send notification to admin for review
  // - Don't fulfill the order yet
  
  try {
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.update({
      status: 'fraud_review',
      fraudChallengeAt: admin.firestore.FieldValue.serverTimestamp(),
      requiresManualReview: true,
    });
    
    // Send fraud alert to admin
    // await sendFraudAlertToAdmin(orderId, statusResponse);
    
    // Hold inventory
    // await holdInventoryForReview(orderId);
    
  } catch (error) {
    console.error('Error in handleFraudChallenge:', error);
  }
}

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST method
  if (req.method !== 'POST') {
    console.log('Webhook: Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  console.log('=== MIDTRANS WEBHOOK RECEIVED ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    const notification = req.body;

    // Basic validation
    if (!notification || !notification.order_id || !notification.transaction_status) {
      console.error('Invalid webhook payload:', notification);
      return res.status(400).json({ error: 'Invalid notification payload' });
    }

    // Verify the notification with Midtrans
    console.log('Verifying transaction with Midtrans...');
    const statusResponse = await coreApi.transaction.notification(notification);
    
    console.log('Midtrans verification response:', statusResponse);

    // Extract important data
    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const transactionId = statusResponse.transaction_id;
    const paymentType = statusResponse.payment_type;
    const fraudStatus = statusResponse.fraud_status;
    const grossAmount = statusResponse.gross_amount;

    console.log('Processing transaction:', {
      orderId,
      transactionStatus,
      transactionId,
      paymentType,
      fraudStatus
    });

    // Handle berbagai status transaksi dengan fungsi terpisah
    let newOrderStatus;
    switch (transactionStatus) {
      case 'capture':
        // For credit card transactions
        if (fraudStatus === 'challenge') {
          newOrderStatus = 'pending'; // Challenge by fraud detection
          await handleFraudChallenge(orderId, statusResponse);
        } else if (fraudStatus === 'accept') {
          newOrderStatus = 'paid';
          await handlePaymentSuccess(orderId, statusResponse);
        } else {
          // fraudStatus === 'deny'
          newOrderStatus = 'cancelled';
          await handlePaymentDenied(orderId, statusResponse);
        }
        break;
      
      case 'settlement':
        // Transaction is settled successfully
        newOrderStatus = 'paid';
        await handlePaymentSuccess(orderId, statusResponse);
        break;
      
      case 'pending':
        // Transaction is pending (e.g., bank transfer)
        newOrderStatus = 'pending';
        await handlePaymentPending(orderId, statusResponse);
        break;
      
      case 'deny':
        // Transaction is denied
        newOrderStatus = 'cancelled';
        await handlePaymentDenied(orderId, statusResponse);
        break;
      
      case 'cancel':
        // Transaction is cancelled by user
        newOrderStatus = 'cancelled';
        await handlePaymentCancelled(orderId, statusResponse);
        break;
        
      case 'expire':
        // Transaction is expired
        newOrderStatus = 'expired';
        await handlePaymentExpired(orderId, statusResponse);
        break;
      
      case 'refund':
      case 'partial_refund':
        // Transaction is refunded
        newOrderStatus = 'refunded';
        await handlePaymentRefunded(orderId, statusResponse);
        break;
      
      case 'failure':
        // Transaction failed
        newOrderStatus = 'failed';
        console.log(`💥 Payment FAILED for order: ${orderId}`);
        // Handle sama seperti cancelled
        await handlePaymentCancelled(orderId, statusResponse);
        break;
      
      default:
        console.warn('Unknown transaction status:', transactionStatus);
        newOrderStatus = 'unknown';
    }

    console.log(`Order ${orderId} processed with status: ${newOrderStatus}`);

    // Update Firebase database - Enhanced version
    try {
      // Find and update the order in Firebase
      const orderRef = db.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();
      
      if (!orderDoc.exists) {
        console.error('Order not found in database:', orderId);
        // Log untuk investigasi manual
        await db.collection('webhook_logs').add({
          type: 'order_not_found',
          orderId: orderId,
          notification: statusResponse,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Still return 200 to Midtrans to avoid retries
        return res.status(200).json({ 
          message: 'Order not found, but webhook processed',
          orderId,
          status: newOrderStatus
        });
      }

      // Update the order document dengan data lengkap
      await orderRef.update({
        status: newOrderStatus,
        transactionId: transactionId,
        paymentType: paymentType,
        transactionStatus: transactionStatus,
        fraudStatus: fraudStatus,
        grossAmount: grossAmount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
        midtransResponse: statusResponse // Store full response for debugging
      });

      // Log successful webhook processing
      await db.collection('webhook_logs').add({
        type: 'success',
        orderId: orderId,
        oldStatus: orderDoc.data()?.status,
        newStatus: newOrderStatus,
        transactionStatus: transactionStatus,
        notification: statusResponse,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('Order updated successfully in Firebase');
      
    } catch (dbError) {
      console.error('Database update error:', dbError);
      
      // Log error untuk investigasi manual
      try {
        await db.collection('webhook_errors').add({
          orderId: orderId,
          error: dbError.message,
          notification: statusResponse,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (logError) {
        console.error('Failed to log error to database:', logError);
      }
      
      // Don't return error to Midtrans, or they'll keep retrying
      // Instead, log for manual investigation
    }

    // Log successful processing
    console.log('Webhook processed successfully:', {
      orderId,
      newStatus: newOrderStatus,
      transactionId,
      paymentType,
      timestamp: new Date().toISOString()
    });

    // IMPORTANT: Always return 200 OK to Midtrans
    // If you return error, Midtrans will retry the webhook multiple times
    return res.status(200).json({ 
      message: 'Webhook processed successfully',
      orderId: orderId,
      status: newOrderStatus,
      transactionId: transactionId,
      paymentType: paymentType,
      processedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook processing error:', {
      message: error.message,
      stack: error.stack,
      requestBody: req.body,
      timestamp: new Date().toISOString()
    });

    // Log error to database if possible
    try {
      await db.collection('webhook_errors').add({
        error: error.message,
        stack: error.stack,
        requestBody: req.body,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (logError) {
      console.error('Failed to log error to database:', logError);
    }

    // Even on error, return 200 to prevent Midtrans retries
    // Log the error for manual investigation
    return res.status(200).json({
      message: 'Webhook received but processing failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
