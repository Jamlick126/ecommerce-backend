const axios = require('axios');

async function sendTelegramAlert(message) {
    try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;

        if (!token || !chatId) {
            console.warn("Telegram bot credentials missing in environment variables.");
            return;
        }

        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });

        console.log("Telegram notification sent successfully!");
    } catch (err) {
        console.error("Telegram Notification Error:", err.response ? err.response.data : err.message);
    }
}

module.exports = { sendTelegramAlert };