require('dotenv').config();
const { sendTelegramAlert } = require('./services/telegram');

async function runTest() {
    console.log("Sending test alert to Telegram...");
    await sendTelegramAlert("🚨 *Test Alert:* Your boutique backend is successfully connected to Telegram!");
}

runTest();