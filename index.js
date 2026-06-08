require('dotenv').config();
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first'); // Fix for Node 20+ IPv6 UDP bug with Discord voice
const ffmpeg = require('@ffmpeg-installer/ffmpeg');
process.env.FFMPEG_PATH = ffmpeg.path;

const { Client, GatewayIntentBits } = require('discord.js');
const handleCommands = require('./commands');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});


client.on('ready', () => {
    console.log(`✅ บอทออนไลน์สำเร็จในชื่อ ${client.user.tag}!`);
    console.log('🎵 ระบบพร้อมสำหรับเปิดเพลงแล้ว');
});

client.on('messageCreate', async (message) => {
    // ข้ามข้อความที่มาจากบอทด้วยกันเอง หรือข้อความที่ไม่ได้ขึ้นต้นด้วย !
    if (message.author.bot || !message.content.startsWith('!')) return;

    await handleCommands(message);
});

// เริ่มเชื่อมต่อบอทด้วย Token
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("❌ ไม่สามารถล็อกอินได้ โปรดตรวจสอบว่าใส่ Token ในไฟล์ .env ถูกต้องหรือไม่", err);
});
