const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('discord-voip');
const playdl = require('play-dl');
const { EmbedBuilder } = require('discord.js');

playdl.getFreeClientID().then((clientID) => {
    playdl.setToken({ soundcloud: { client_id: clientID } });
}).catch(err => console.error("Could not set SoundCloud token:", err));

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
        const resource = createAudioResource(stream.stream, { inputType: stream.type });
        
        queue.player.play(resource);

        // ลบระบบส่งข้อความตอนเพลงเล่นออกไปแล้วตามสั่งครับ!
        // บอทจะเปิดเพลงเฉยๆ โดยไม่ส่งข้อความอะไรมารกห้องแชทแล้วครับ

    } catch (error) {
        console.error(`[Error] เล่นเพลงไม่ได้: ${error.message}`);
        queue.textChannel.send(`❌ ข้ามเพลง **${track.title}** (ดึงไฟล์เสียงไม่สำเร็จ)`);
        queue.tracks.shift();
        playNext(guildId);
    }
}

async function handleCommands(interaction) {
    const commandName = interaction.commandName;
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
        return interaction.reply({ content: '❌ คุณต้องอยู่ในห้องเสียงก่อนจึงจะสั่งบอทได้ครับ!', ephemeral: true });
    }

    if (commandName === 'testplay') {
        const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: interaction.guild.id, adapterCreator: interaction.guild.voiceAdapterCreator });
        const nativePlayer = createAudioPlayer();
        const resource = createAudioResource('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
        nativePlayer.play(resource);
        connection.subscribe(nativePlayer);
        return interaction.reply({ content: "✅ กำลังทดสอบระบบเสียงพื้นฐาน (Native Test)...", ephemeral: true });
    }

    if (commandName === 'play') {
        let cleanQuery = interaction.options.getString('query');
        if (cleanQuery.includes('youtube.com/watch') && cleanQuery.includes('&list=')) {
            cleanQuery = cleanQuery.split('&list=')[0];
        }

        await interaction.reply({ content: '⏳ กำลังค้นหาเพลง...', ephemeral: true });

        try {
            let trackInfo = null;
            if (cleanQuery.startsWith("http")) {
                const info = await playdl.video_info(cleanQuery).catch(() => null) || await playdl.soundcloud(cleanQuery).catch(() => null);
                if (info) {
                    trackInfo = {
                        title: info.video_details?.title || info.name || "Unknown Title",
                        url: info.video_details?.url || info.url,
                        thumbnail: info.video_details?.thumbnails?.[0]?.url || info.thumbnail,
                        author: info.video_details?.channel?.name || info.user?.name || "Unknown",
                        duration: info.video_details?.durationRaw || (info.durationInSec ? `${Math.floor(info.durationInSec / 60)}:${(info.durationInSec % 60).toString().padStart(2, '0')}` : "Unknown"),
                        requester: interaction.user
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
                        requester: interaction.user
                    };
                }
            }

            if (!trackInfo) return interaction.editReply({ content: '❌ ค้นหาเพลงไม่เจอครับ ลองเปลี่ยนชื่อเพลงดูนะครับ' });

            let queue = serverQueues.get(interaction.guild.id);
            if (!queue) {
                const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: interaction.guild.id, adapterCreator: interaction.guild.voiceAdapterCreator });
                connection.on('error', error => console.error(`[Connection Error] ${error.message}`));
                
                const player = createAudioPlayer();
                connection.subscribe(player);

                queue = { textChannel: interaction.channel, voiceChannel: voiceChannel, connection: connection, player: player, tracks: [], playing: false };
                serverQueues.set(interaction.guild.id, queue);

                player.on(AudioPlayerStatus.Idle, () => { queue.tracks.shift(); playNext(interaction.guild.id); });
                player.on('error', error => { console.error(`[Player Error] ${error.message}`); queue.tracks.shift(); playNext(interaction.guild.id); });
            }

            queue.tracks.push(trackInfo);
            
            const queueEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setAuthor({ name: 'Deay Music Player', iconURL: interaction.client.user.displayAvatarURL() })
                .setDescription(`Added to queue\n**${trackInfo.title}**\n${trackInfo.author} | \`${trackInfo.duration}\``)
                .setFooter({ text: `Node: Deay Server | ${trackInfo.url}` });

            if (trackInfo.thumbnail) queueEmbed.setImage(trackInfo.thumbnail);

            await interaction.editReply({ content: '', embeds: [queueEmbed] });

            if (!queue.playing) playNext(interaction.guild.id);

        } catch (e) {
            console.error(e);
            return interaction.editReply({ content: `❌ เกิดข้อผิดพลาด: ${e.message}` });
        }
    }

    if (commandName === 'stop') {
        const queue = serverQueues.get(interaction.guild.id);
        if (!queue) return interaction.reply({ content: '❌ ตอนนี้ไม่มีเพลงเล่นอยู่ครับ', ephemeral: true });
        queue.tracks = []; queue.player.stop(); queue.connection.destroy(); serverQueues.delete(interaction.guild.id);
        return interaction.reply({ content: '🛑 หยุดเพลง ล้างคิว และออกจากห้องเรียบร้อยแล้วครับ', ephemeral: true });
    }

    if (commandName === 'skip') {
        const queue = serverQueues.get(interaction.guild.id);
        if (!queue || !queue.playing) return interaction.reply({ content: '❌ ตอนนี้ไม่มีเพลงเล่นอยู่ครับ', ephemeral: true });
        queue.player.stop(); 
        return interaction.reply({ content: '⏭️ ข้ามเพลงปัจจุบันแล้วครับ', ephemeral: true });
    }

    if (commandName === 'queue') {
        const queue = serverQueues.get(interaction.guild.id);
        if (!queue || queue.tracks.length === 0) return interaction.reply({ content: '❌ ตอนนี้ไม่มีเพลงในคิวครับ', ephemeral: true });
        const tracks = queue.tracks;
        const queueString = tracks.slice(0, 10).map((t, i) => i === 0 ? `▶️ **กำลังเล่น:** ${t.title}` : `${i}. **${t.title}**`).join('\n');
        return interaction.reply({ content: `📋 **คิวเพลงปัจจุบัน:**\n${queueString}${tracks.length > 10 ? `\n...และอีก ${tracks.length - 10} เพลง` : ''}`, ephemeral: true });
    }
}

module.exports = handleCommands;
