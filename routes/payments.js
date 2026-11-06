const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase');
const { sendWhatsAppAlert } = require('../services/whatsapp');

// Helper to get M-Pesa Token
const getMpesaToken = async () => {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    try {
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (err) {
        console.error("Token Generation Error:", err.response ? err.response.data : err.message);
        throw new Error("Failed to get M-Pesa Token");
    }
};

// STK Push Request Route
router.post('/stkpush', async (req, res) => {
    const { phone, amount, username } = req.body;
    const token = await getMpesaToken();
    const date = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const shortcode = "174379"; 
    const passkey = process.env.MPESA_PASSKEY;
    const password = Buffer.from(shortcode + passkey + date).toString('base64');

    try {
        const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
            "BusinessShortCode": shortcode,
            "Password": password,
            "Timestamp": date,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": amount,
            "PartyA": phone,
            "PartyB": shortcode,
            "PhoneNumber": phone,
            "CallBackURL": `https://ecommerce-backend-hm0b.onrender.com/api/callback?store_slug=${req.storeSlug}`,
            "AccountReference": "RedStore",
            "TransactionDesc": "Payment for goods"
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.ResponseCode === "0") {
            const checkoutID = response.data.CheckoutRequestID;
            await supabase
                .from('orders')
                .insert([{ username, checkout_request_id: checkoutID, amount, status: 'pending' }]);
        }
        res.status(200).json(response.data);
    } catch (err) {
        res.status(500).json(err.message);
    }
});

// STK Callback Route (Triggers WhatsApp alert on success)
router.post('/callback', async (req, res) => {
    const callbackData = req.body.Body.stkCallback;
    const resultCode = callbackData.ResultCode;
    const checkoutID = callbackData.CheckoutRequestID;

    try {
        if (resultCode === 0) {
            const amount = callbackData.CallbackMetadata.Item[0].Value;
            const mpesaReceipt = callbackData.CallbackMetadata.Item[1].Value;
            
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .select('username, amount')
                .eq('checkout_request_id', checkoutID)
                .single();

            if (order && !orderError) {
                const username = order.username;

                await supabase
                    .from('orders')
                    .update({ status: 'paid', mpesa_receipt: mpesaReceipt })
                    .eq('checkout_request_id', checkoutID);

                const { data: user } = await supabase
                    .from('users')
                    .select('id')
                    .eq('username', username)
                    .single();

                if (user) {
                    await supabase.from('cart').delete().eq('user_id', user.id);
                }

                // Send WhatsApp Notification to Boutique Owner
                const ownerPhone = process.env.SHOP_OWNER_WHATSAPP;
                const whatsappMessage = 
`🔔 *New Store Order Received!*
--------------------------------
👤 *Customer Username:* ${username}
💰 *Amount Paid:* KSh ${order.amount || amount}
🧾 *M-Pesa Receipt:* ${mpesaReceipt}
--------------------------------
_Status: Paid & Verified ✓_`;

                if (ownerPhone) {
                    await sendWhatsAppAlert(ownerPhone, whatsappMessage);
                }
            }
        } else {
            await supabase
                .from('orders')
                .update({ status: 'failed' })
                .eq('checkout_request_id', checkoutID);
        }
    } catch (dbErr) {
        console.error("Database Callback Error:", dbErr.message);
    }
    res.status(200).send("Success");  
});

module.exports = router;