require('dotenv').config();
const http = require('http');
http.createServer((req, res) => res.end('Bot is alive!')).listen(process.env.PORT || 10000);

const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');
process.env.FFMPEG_PATH = ffmpeg.path;

const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const handleCommands = require('./commands');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

const commands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('เล่นเพลงจากชื่อเพลงหรือลิงก์')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('ชื่อเพลงหรือลิงก์ YouTube/SoundCloud')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('หยุดเพลง ล้างคิว และออกจากห้อง'),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('ข้ามเพลงปัจจุบัน'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('ดูคิวเพลงปัจจุบัน'),
    // เพิ่มคำสั่งใหม่ /panel ตรงนี้ครับ!
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('เรียกแผงควบคุมเพลงหลัก (แบบมีปุ่มสุ่มเพลง)'),
    new SlashCommandBuilder()
        .setName('testplay')
        .setDescription('ทดสอบระบบเสียง')
].map(command => command.toJSON());

client.on('ready', async () => {
    console.log(`✅ บอทออนไลน์สำเร็จในชื่อ ${client.user.tag}!`);
    console.log('🎵 ระบบ Slash Commands พร้อมใช้งานแล้ว');
    
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.commands.set(commands);
            console.log(`[Slash Command] ติดตั้งเมนูคำสั่งใน: ${guild.name} เรียบร้อยแล้ว`);
        } catch (err) {
            console.error(`[Error] ติดตั้งเมนูคำสั่งไม่สำเร็จใน: ${guild.name}`);
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    // ให้มันรับรองทั้ง Slash Command และ ปุ่มกด!
    if (interaction.isChatInputCommand() || interaction.isButton()) {
        await handleCommands(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("❌ ไม่สามารถล็อกอินได้ โปรดตรวจสอบ Token", err);
});
