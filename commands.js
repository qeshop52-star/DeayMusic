const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const playdl = require('play-dl');
const { EmbedBuilder } = require('discord.js');
// แก้ปัญหา 'client_id' undefined ของ SoundCloud
playdl.getFreeClientID().then((clientID) => {
    playdl.setToken({ soundcloud: { client_id: clientID } });
}).catch(err => console.error("Could not set SoundCloud token:", err));

// เก็บข้อมูลคิวของแต่ละเซิร์ฟเวอร์
const serverQueues = new Map();

async function playNext(guildId) {
    const queue = serverQueues.get(guildId);
    if (!queue) return;

    if (queue.tracks.length === 0) {
        // ไม่มีเพลงเหลือแล้ว
        queue.playing = false;
        return;
    }

    const stream = await playdl.stream(track.url, { quality: 2 });
    queue.playing = true;

    try {
        // ใช้ play-dl ดึงสตรีมเสียง
        const stream = await playdl.stream(track.url);
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type
        });

        queue.player.play(resource);
        queue.textChannel.send(`▶️ กำลังเล่น: **${track.title}**`);
    } catch (error) {
        console.error(`[Error] เล่นเพลงไม่ได้: ${error.message}`);
        queue.textChannel.send(`❌ ข้ามเพลง **${track.title}** เนื่องจากเกิดข้อผิดพลาดในการดึงข้อมูลเสียง`);
        queue.tracks.shift(); // ลบเพลงที่มีปัญหาออก
        playNext(guildId); // เล่นเพลงถัดไป
    }
}

async function handleCommands(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        if (['play', 'stop', 'skip', 'testplay'].includes(commandName)) {
            return message.reply('❌ คุณต้องอยู่ในห้องเสียงก่อนจึงจะสั่งบอทได้ครับ!');
        }
        return;
    }

    if (commandName === 'testplay') {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        const nativePlayer = createAudioPlayer();
        const resource = createAudioResource('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
        nativePlayer.play(resource);
        connection.subscribe(nativePlayer);
        return message.reply("✅ กำลังทดสอบระบบเสียงพื้นฐาน (Native Test)...");
    }

    // --- คำสั่ง !play ---
    if (commandName === 'play') {
        const query = args.join(' ');
        if (!query) return message.reply('❌ โปรดระบุชื่อเพลงหรือ Link ที่ต้องการเล่น (ตัวอย่าง: `!play เพลงรัก`)');

        let cleanQuery = query;
        if (cleanQuery.includes('youtube.com/watch') && cleanQuery.includes('&list=')) {
            cleanQuery = cleanQuery.split('&list=')[0];
        }

        const replyMessage = await message.reply('⏳ กำลังค้นหาเพลง...');

        try {
            let trackInfo = null;

            if (cleanQuery.startsWith("http")) {
                // ถ้าเป็นลิงก์ (YouTube หรือ SoundCloud)
                const info = await playdl.video_info(cleanQuery).catch(() => null) || await playdl.soundcloud(cleanQuery).catch(() => null);
                if (info) {
                    trackInfo = {
                        title: info.video_details?.title || info.name,
                        url: info.video_details?.url || info.url
                    };
                }
            } else {
                // บังคับค้นหาใน SoundCloud เพื่อป้องกัน Invalid URL จาก YouTube
                const searchResults = await playdl.search(cleanQuery, { source: { soundcloud: 'tracks' }, limit: 1 }).catch(() => null);

                if (searchResults && searchResults.length > 0) {
                    trackInfo = {
                        title: searchResults[0].name,
                        url: searchResults[0].url
                    };
                }
            }

            if (!trackInfo) {
                return replyMessage.edit('❌ ค้นหาเพลงไม่เจอครับ ลองเปลี่ยนชื่อเพลงดูนะครับ');
            }

            // จัดการระบบคิว
            let queue = serverQueues.get(message.guild.id);
            if (!queue) {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });

                // ป้องกันบอทแครชเวลาเน็ตตัด
                connection.on('error', error => console.error(`[Connection Error] ${error.message}`));
                connection.on('stateChange', (oldState, newState) => {
                    if (newState.status === 'disconnected') {
                        // ปล่อยให้มันลองเชื่อมต่อใหม่ หรือลบคิวถ้าจำเป็น
                    }
                });

                const player = createAudioPlayer();
                connection.subscribe(player);

                queue = {
                    textChannel: message.channel,
                    voiceChannel: voiceChannel,
                    connection: connection,
                    player: player,
                    tracks: [],
                    playing: false
                };

                serverQueues.set(message.guild.id, queue);

                // ตั้งค่าเมื่อเพลงเล่นจบ
                player.on(AudioPlayerStatus.Idle, () => {
                    queue.tracks.shift(); // นำเพลงที่เพิ่งเล่นจบออกจากคิว
                    playNext(message.guild.id); // เล่นเพลงถัดไป
                });

                player.on('error', error => {
                    console.error(`[Player Error] ${error.message}`);
                    queue.tracks.shift();
                    playNext(message.guild.id);
                });
            }

            // นำเพลงเข้าคิว
            queue.tracks.push(trackInfo);
            replyMessage.edit(`🎵 เพิ่มเพลง **${trackInfo.title}** ลงในคิวแล้ว!`);

            // ถ้าไม่มีเพลงกำลังเล่นอยู่ ให้เริ่มเล่น
            if (!queue.playing) {
                playNext(message.guild.id);
            }

        } catch (e) {
            console.error(e);
            return replyMessage.edit(`❌ เกิดข้อผิดพลาด: ${e.message}`);
        }
    }

    // --- คำสั่ง !stop ---
    if (commandName === 'stop') {
        const queue = serverQueues.get(message.guild.id);
        if (!queue) return message.reply('❌ ตอนนี้ไม่มีเพลงเล่นอยู่ครับ');

        queue.tracks = []; // ล้างคิว
        queue.player.stop(); // หยุดเล่น
        queue.connection.destroy(); // ออกจากห้อง
        serverQueues.delete(message.guild.id);

        return message.reply('🛑 หยุดเพลง ล้างคิว และออกจากห้องเรียบร้อยแล้วครับ');
    }

    // --- คำสั่ง !skip ---
    if (commandName === 'skip') {
        const queue = serverQueues.get(message.guild.id);
        if (!queue || !queue.playing) return message.reply('❌ ตอนนี้ไม่มีเพลงเล่นอยู่ครับ');

        queue.player.stop(); // การกด stop ตัว player จะกระตุ้น Event "Idle" ซึ่งจะข้ามไปเพลงถัดไปอัตโนมัติ
        return message.reply('⏭️ ข้ามเพลงปัจจุบันแล้วครับ');
    }

    // --- คำสั่ง !queue ---
    if (commandName === 'queue') {
        const queue = serverQueues.get(message.guild.id);
        if (!queue || queue.tracks.length === 0) return message.reply('❌ ตอนนี้ไม่มีเพลงในคิวครับ');

        const tracks = queue.tracks;
        const queueString = tracks.slice(0, 10).map((track, i) => {
            if (i === 0) return `▶️ **กำลังเล่น:** ${track.title}`;
            return `${i}. **${track.title}**`;
        }).join('\n');
        
        return message.reply(`📋 **คิวเพลงปัจจุบัน:**\n${queueString}${tracks.length > 10 ? `\n...และอีก ${tracks.length - 10} เพลง` : ''}`);
    }
}

module.exports = handleCommands;
