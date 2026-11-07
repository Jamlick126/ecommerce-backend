const axios = require('axios');

async function sendWhatsAppAlert(phone, message) {
    try {
        const token = process.env.WHATSAPP_TOKEN;
        const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

        if (!token || !phoneId) {
            console.warn("WhatsApp API credentials missing in environment variables.");
            return;
        }

        const url = `https://graph.facebook.com/v25.0/${phoneId}/messages`;
        
        const response = await axios.post(url, {
            messaging_product: "whatsapp",
            to: phone,
            type: "text",
            text: { body: message }
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log("Meta API Response:", JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error("WhatsApp Notification Error:", err.response ? err.response.data : err.message);
    }
}

module.exports = { sendWhatsAppAlert };