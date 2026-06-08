const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('discord-voip');
const playdl = require('play-dl');
const { EmbedBuilder } = require('discord.js');

// แก้ปัญหา 'client_id' ของ SoundCloud
playdl.getFreeClientID().then((clientID) => {
    playdl.setToken({ soundcloud: { client_id: clientID } });
}).catch(err => console.error("Could not set SoundCloud token:", err));

// เก็บข้อมูลคิว
const serverQueues = new Map();

async function playNext(guildId) {
    const queue = serverQueues.get(guildId);
    if (!queue) return;

    if (queue.tracks.length === 0) {
        queue.playing = false;
        return;
    }

    const track = queue.tracks[0];
    queue.playing = true;

    try {
        const stream = await playdl.stream(track.url);
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type
        });

        queue.player.play(resource);

        // --- สร้างกรอบข้อความอลังการ (Embed) แบบบอทพรีเมียม ---
        const embed = new EmbedBuilder()
            .setColor('#ff99cc') // สีแถบด้านซ้าย (สีชมพู)
            .setAuthor({ name: 'Deay Music Room', iconURL: queue.textChannel.client.user.displayAvatarURL() })
            .setTitle(track.title)
            .setURL(track.url)
            .addFields(
                { name: '👤 Author:', value: `└ ${track.author}`, inline: true },
                { name: '🕒 Duration:', value: `└ ${track.duration}`, inline: true },
                { name: '🎶 Queues:', value: `└ ${queue.tracks.length - 1}`, inline: true },
                { name: '👤 Requester:', value: `└ <@${track.requester.id}>`, inline: true },
                { name: '🔊 Room:', value: `└ ${queue.voiceChannel.name}`, inline: true },
                { name: '👑 Support:', value: `└ [แจ้งปัญหาคลิก!](https://discord.com)`, inline: true }
            )
            .setImage(track.thumbnail || 'https://i.imgur.com/TqE2iLg.png') // ใส่ปกเพลง (ถ้าไม่มีจะใช้รูป default)
            .setFooter({ text: `Node: Deay Server | ${track.url}` });

        // ส่งข้อความเข้าแชท
        queue.textChannel.send({ embeds: [embed] });

    } catch (error) {
        console.error(`[Error] เล่นเพลงไม่ได้: ${error.message}`);
        queue.textChannel.send(`❌ ข้ามเพลง **${track.title}** (ดึงไฟล์เสียงไม่สำเร็จ)`);
        queue.tracks.shift();
        playNext(guildId);
    }
}

async function handleCommands(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        if (['play', 'stop', 'skip', 'testplay', 'queue'].includes(commandName)) {
            return message.reply('❌ คุณต้องอยู่ในห้องเสียงก่อนจึงจะสั่งบอทได้ครับ!');
        }
        return;
    }

    if (commandName === 'testplay') {
        const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        const nativePlayer = createAudioPlayer();
        const resource = createAudioResource('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
        nativePlayer.play(resource);
        connection.subscribe(nativePlayer);
        return message.reply("✅ กำลังทดสอบระบบเสียงพื้นฐาน (Native Test)...");
    }

    // --- คำสั่ง !play ---
    if (commandName === 'play') {
        const query = args.join(' ');
        if (!query) return message.reply('❌ โปรดระบุชื่อเพลงหรือ Link ที่ต้องการเล่น');

        let cleanQuery = query;
        if (cleanQuery.includes('youtube.com/watch') && cleanQuery.includes('&list=')) cleanQuery = cleanQuery.split('&list=')[0];

        const replyMessage = await message.reply('⏳ กำลังค้นหาเพลง...');

        try {
            let trackInfo = null;

            // ดึงข้อมูลเพลงแบบละเอียด (เพื่อเอาไปโชว์ในกรอบ)
            if (cleanQuery.startsWith("http")) {
                const info = await playdl.video_info(cleanQuery).catch(() => null) || await playdl.soundcloud(cleanQuery).catch(() => null);
                if (info) {
                    trackInfo = {
                        title: info.video_details?.title || info.name || "Unknown Title",
                        url: info.video_details?.url || info.url,
                        thumbnail: info.video_details?.thumbnails?.[0]?.url || info.thumbnail,
                        author: info.video_details?.channel?.name || info.user?.name || "Unknown",
                        duration: info.video_details?.durationRaw || (info.durationInSec ? `${Math.floor(info.durationInSec / 60)}:${(info.durationInSec % 60).toString().padStart(2, '0')}` : "Unknown"),
                        requester: message.author
                    };
                }
            } else {
                const searchResults = await playdl.search(cleanQuery, { source: { soundcloud: 'tracks' }, limit: 1 }).catch(() => null);
                if (searchResults && searchResults.length > 0) {
                    trackInfo = {
                        title: searchResults[0].name || "Unknown Title",
                        url: searchResults[0].url,
                        thumbnail: searchResults[0].thumbnail,
                        author: searchResults[0].user?.name || "SoundCloud",
                        duration: searchResults[0].durationInSec ? `${Math.floor(searchResults[0].durationInSec / 60)}:${(searchResults[0].durationInSec % 60).toString().padStart(2, '0')}` : "Unknown",
                        requester: message.author
                    };
                }
            }

            if (!trackInfo) return replyMessage.edit('❌ ค้นหาเพลงไม่เจอครับ ลองเปลี่ยนชื่อเพลงดูนะครับ');

            // จัดการระบบคิว
            let queue = serverQueues.get(message.guild.id);
            if (!queue) {
                const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
                connection.on('error', error => console.error(`[Connection Error] ${error.message}`));
                
                const player = createAudioPlayer();
                connection.subscribe(player);

                queue = { textChannel: message.channel, voiceChannel: voiceChannel, connection: connection, player: player, tracks: [], playing: false };
                serverQueues.set(message.guild.id, queue);

                player.on(AudioPlayerStatus.Idle, () => { queue.tracks.shift(); playNext(message.guild.id); });
                player.on('error', error => { console.error(`[Player Error] ${error.message}`); queue.tracks.shift(); playNext(message.guild.id); });
            }

            queue.tracks.push(trackInfo);
            replyMessage.edit(`🎵 เพิ่มเพลง **${trackInfo.title}** ลงในคิวแล้ว!`);

            if (!queue.playing) playNext(message.guild.id);

        } catch (e) {
            console.error(e);
            return replyMessage.edit(`❌ เกิดข้อผิดพลาด: ${e.message}`);
        }
    }

    // --- คำสั่ง !stop และคำสั่งอื่นๆ ---
    if (commandName === 'stop') {
        const queue = serverQueues.get(message.guild.id);
        if (!queue) return message.reply('❌ ตอนนี้ไม่มีเพลงเล่นอยู่ครับ');
        queue.tracks = []; queue.player.stop(); queue.connection.destroy(); serverQueues.delete(message.guild.id);
        return message.reply('🛑 หยุดเพลง ล้างคิว และออกจากห้องเรียบร้อยแล้วครับ');
    }

    if (commandName === 'skip') {
        const queue = serverQueues.get(message.guild.id);
        if (!queue || !queue.playing) return message.reply('❌ ตอนนี้ไม่มีเพลงเล่นอยู่ครับ');
        queue.player.stop(); 
        return message.reply('⏭️ ข้ามเพลงปัจจุบันแล้วครับ');
    }

    if (commandName === 'queue') {
        const queue = serverQueues.get(message.guild.id);
        if (!queue || queue.tracks.length === 0) return message.reply('❌ ตอนนี้ไม่มีเพลงในคิวครับ');
        const tracks = queue.tracks;
        const queueString = tracks.slice(0, 10).map((t, i) => i === 0 ? `▶️ **กำลังเล่น:** ${t.title}` : `${i}. **${t.title}**`).join('\n');
        return message.reply(`📋 **คิวเพลงปัจจุบัน:**\n${queueString}${tracks.length > 10 ? `\n...และอีก ${tracks.length - 10} เพลง` : ''}`);
    }
}

module.exports = handleCommands;
