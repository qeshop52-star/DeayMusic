const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('discord-voip');
const playdl = require('play-dl');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

playdl.getFreeClientID().then((clientID) => {
    playdl.setToken({ soundcloud: { client_id: clientID } });
}).catch(err => console.error("Could not set SoundCloud token:", err));

const serverQueues = new Map();
const serverPanels = new Map(); 

function getDefaultPanel(client) {
    const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setAuthor({ name: `${client.user.username}'s - Music System`, iconURL: client.user.displayAvatarURL() })
        .setTitle('ไม่มีเพลงที่กำลังเล่นอยู่ในขณะนี้')
        .setDescription('ไม่มีเพลงฟังหรอ? ลองสุ่มเพลงดูสิ\n\n**Paste the song link or song name**')
        .setImage('https://i.imgur.com/vHqBEM3.png') 
        .setFooter({ text: 'Discord Support : discord.gg/xxxxx | Developer : Deay' });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('random_song')
                .setLabel('สุ่มเพลง')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setLabel('เชิญบอท')
                .setEmoji('⏭️')
                .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
                .setStyle(ButtonStyle.Link)
        );

    return { embeds: [embed], components: [row] };
}

function getNowPlayingPanel(track, client, voiceChannel, queue) {
    const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setAuthor({ name: `${client.user.username}'s - Music System`, iconURL: client.user.displayAvatarURL() })
        .setTitle(track.title)
        .setURL(track.url)
        .addFields(
            { name: '✨ เจ้าของเพลง', value: `\`${track.author}\``, inline: true },
            { name: '⏱️ ความยาว', value: `\`${track.duration}\``, inline: true },
            { name: '🎵 กำลังเล่นเพลง', value: `\`${client.guilds.cache.size} เซิฟเวอร์\``, inline: true },
            { name: track.isRandom ? '👤 สุ่มโดย' : '👤 ขอเพลงโดย', value: `<@${track.requester.id}>`, inline: true },
            { name: '🔊 ช่องเสียง', value: `🔊 ${voiceChannel.name}`, inline: true },
            { name: '✨ เชิญบอท', value: `[Invite](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)`, inline: true }
        )
        .setImage('https://i.imgur.com/vHqBEM3.png')  
        .setFooter({ text: 'ถ้าชอบเพลงนี้พิมพ์ /play เพื่อเล่นเพลงต่อได้เลย' });

    if (queue && queue.tracks.length > 1) {
        const upNext = queue.tracks.slice(1, 11); 
        let description = `**เพลงในคิว [ ${queue.tracks.length - 1} ] เพลง**\n\n`;
        description += upNext.map((t, i) => {
            let title = t.title;
            if (title.length > 35) title = title.substring(0, 35) + '...';
            return `${i + 1}. ${title}  \`${t.duration}\` <@${t.requester.id}>`;
        }).join('\n');
        
        embed.setDescription(description);
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('random_song')
                .setLabel('สุ่มเพลง')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setLabel('เชิญบอท')
                .setEmoji('⏭️')
                .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
                .setStyle(ButtonStyle.Link)
        );

    return { embeds: [embed], components: [row] };
}

async function updatePanelState(guildId) {
    const queue = serverQueues.get(guildId);
    const panelMsg = serverPanels.get(guildId);
    if (!panelMsg) return;

    try {
        if (!queue || queue.tracks.length === 0) {
            await panelMsg.edit(getDefaultPanel(panelMsg.client));
        } else {
            const currentTrack = queue.tracks[0];
            await panelMsg.edit(getNowPlayingPanel(currentTrack, panelMsg.client, queue.voiceChannel, queue));
        }
    } catch (e) {
        console.error("Failed to update panel message:", e);
    }
}

async function playNext(guildId) {
    const queue = serverQueues.get(guildId);
    if (!queue) return;

    if (queue.tracks.length === 0) {
        queue.playing = false;
        updatePanelState(guildId); 
        return;
    }

    const track = queue.tracks[0];
    queue.playing = true;
    updatePanelState(guildId); 

    try {
        const stream = await playdl.stream(track.url);
        const resource = createAudioResource(stream.stream, { inputType: stream.type });
        
        queue.player.play(resource);

    } catch (error) {
        console.error(`[Error] เล่นเพลงไม่ได้: ${error.message}`);
        
        try {
            await track.interaction.followUp({ 
                content: `❌ ข้ามเพลง **${track.title}** (ดึงไฟล์เสียงไม่สำเร็จ)`, 
                flags: MessageFlags.Ephemeral 
            });
        } catch (e) {
            queue.textChannel.send(`❌ ข้ามเพลง **${track.title}** (ดึงไฟล์เสียงไม่สำเร็จ)`).then(msg => {
                setTimeout(() => msg.delete().catch(()=>{}), 10000);
            });
        }

        queue.tracks.shift();
        playNext(guildId);
    }
}

async function playLogic(interaction, query, isRandom = false) {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
        return interaction.reply({ content: '❌ คุณต้องอยู่ในห้องเสียงก่อนจึงจะสั่งบอทได้ครับ!', flags: MessageFlags.Ephemeral });
    }

    let cleanQuery = query;
    if (cleanQuery.includes('youtube.com/watch') && cleanQuery.includes('&list=')) {
        cleanQuery = cleanQuery.split('&list=')[0];
    }

    if (interaction.isButton()) {
        await interaction.deferUpdate(); 
        await interaction.followUp({ content: isRandom ? '🎲 กำลังสุ่มเพลงให้คุณฟัง...' : '⏳ กำลังค้นหาเพลง...', flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ content: '⏳ กำลังค้นหาเพลง...', flags: MessageFlags.Ephemeral });
    }

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
                    requester: interaction.user,
                    interaction: interaction,
                    isRandom: isRandom 
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
                    requester: interaction.user,
                    interaction: interaction,
                    isRandom: isRandom
                };
            }
        }

        if (!trackInfo) {
            if (interaction.isButton()) {
                return interaction.followUp({ content: '❌ ค้นหาเพลงไม่เจอครับ ลองเปลี่ยนชื่อเพลงดูนะครับ', flags: MessageFlags.Ephemeral });
            } else {
                return interaction.editReply({ content: '❌ ค้นหาเพลงไม่เจอครับ ลองเปลี่ยนชื่อเพลงดูนะครับ' });
            }
        }

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
        
        const addMsg = `✅ เพิ่มเพลง **${trackInfo.title}** ลงคิวแล้ว`;
        if (interaction.isButton()) {
            await interaction.followUp({ content: addMsg, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.editReply({ content: addMsg });
        }

        if (!queue.playing) {
            playNext(interaction.guild.id);
        } else {
            updatePanelState(interaction.guild.id);
        }

    } catch (e) {
        console.error(e);
        if (interaction.isButton()) {
            return interaction.followUp({ content: `❌ เกิดข้อผิดพลาด: ${e.message}`, flags: MessageFlags.Ephemeral });
        } else {
            return interaction.editReply({ content: `❌ เกิดข้อผิดพลาด: ${e.message}` });
        }
    }
}

// ----------------------------------------
// ระบบใหม่: จัดการข้อความที่พิมพ์เข้ามาตรงๆ (Auto-Play)
// ----------------------------------------
async function handleMessages(message) {
    // ลบข้อความที่ผู้ใช้พิมพ์ เพื่อรักษาความสะอาดของห้อง
    message.delete().catch(() => {});

    // ฟังก์ชันสร้างข้อความแจ้งเตือนชั่วคราวแล้วลบทิ้งใน 5 วินาที
    const sendTempMsg = async (opts) => {
        // ต้องตัด flags (Ephemeral) ทิ้ง เพราะการตอบข้อความธรรมดาใช้ Ephemeral ไม่ได้
        const cleanOpts = typeof opts === 'string' ? { content: opts } : { ...opts };
        delete cleanOpts.flags;
        
        try {
            const msg = await message.channel.send(cleanOpts);
            setTimeout(() => msg.delete().catch(()=>{}), 5000);
            return msg;
        } catch (e) {
            console.error(e);
        }
    };

    // จำลอง Interaction ขึ้นมาหลอกฟังก์ชันเก่า ให้เล่นเพลงได้ปกติ
    const fakeInteraction = {
        guild: message.guild,
        member: message.member,
        user: message.author,
        channel: message.channel,
        client: message.client,
        isButton: () => false,
        reply: sendTempMsg,
        editReply: sendTempMsg,
        followUp: sendTempMsg
    };

    // ส่งลิงก์หรือชื่อเพลงไปเล่นเลย!
    return playLogic(fakeInteraction, message.content, false);
}

async function handleCommands(interaction) {
    if (interaction.isButton()) {
        if (interaction.customId === 'random_song') {
            const randomSongs = [
                "lofi hip hop radio - beats to relax/study to",
                "จี่หอย",
                "Shape of You",
                "ตามตะวัน",
                "ทรงอย่างแบด",
                "Every Summertime",
                "Sabrina Carpenter"
            ];
            const randomQuery = randomSongs[Math.floor(Math.random() * randomSongs.length)];
            
            serverPanels.set(interaction.guild.id, interaction.message);

            return playLogic(interaction, randomQuery, true); 
        }
        return;
    }

    const commandName = interaction.commandName;

    if (commandName === 'panel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); 

        let targetChannel = interaction.guild.channels.cache.find(c => c.name === 'deaymusic');
        
        if (!targetChannel) {
            try {
                targetChannel = await interaction.guild.channels.create({
                    name: 'deaymusic',
                    type: 0 
                });
            } catch (err) {
                console.error(err);
                return interaction.followUp({ content: '❌ บอทไม่สามารถสร้างห้องได้ครับ โปรดตรวจสอบให้แน่ใจว่าบอทมีสิทธิ์ Manage Channels ในเซิฟเวอร์นี้', flags: MessageFlags.Ephemeral });
            }
        }

        const msg = await targetChannel.send(getDefaultPanel(interaction.client));
        
        serverPanels.set(interaction.guild.id, msg);
        
        updatePanelState(interaction.guild.id);
        
        return interaction.followUp({ content: `✅ สร้างห้องและวางแผงควบคุมเรียบร้อยแล้ว แวะไปดูได้ที่ ${targetChannel} ครับ!`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'play') {
        const query = interaction.options.getString('query');
        return playLogic(interaction, query, false);
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
        return interaction.reply({ content: '❌ คุณต้องอยู่ในห้องเสียงก่อนจึงจะสั่งบอทได้ครับ!', flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'testplay') {
        const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: interaction.guild.id, adapterCreator: interaction.guild.voiceAdapterCreator });
        const nativePlayer = createAudioPlayer();
        const resource = createAudioResource('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
        nativePlayer.play(resource);
        connection.subscribe(nativePlayer);
        return interaction.reply({ content: "✅ กำลังทดสอบระบบเสียงพื้นฐาน (Native Test)...", flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'stop') {
        const queue = serverQueues.get(interaction.guild.id);
        if (!queue) return interaction.reply({ content: '❌ ตอนนี้ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
        queue.tracks = []; queue.player.stop(); queue.connection.destroy(); serverQueues.delete(interaction.guild.id);
        
        updatePanelState(interaction.guild.id); 

        return interaction.reply({ content: '🛑 หยุดเพลง ล้างคิว และออกจากห้องเรียบร้อยแล้วครับ', flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'skip') {
        const queue = serverQueues.get(interaction.guild.id);
        if (!queue || !queue.playing) return interaction.reply({ content: '❌ ตอนนี้ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
        queue.player.stop(); 
        return interaction.reply({ content: '⏭️ ข้ามเพลงปัจจุบันแล้วครับ', flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'queue') {
        const queue = serverQueues.get(interaction.guild.id);
        if (!queue || queue.tracks.length === 0) return interaction.reply({ content: '❌ ตอนนี้ไม่มีเพลงในคิวครับ', flags: MessageFlags.Ephemeral });
        const tracks = queue.tracks;
        const queueString = tracks.slice(0, 10).map((t, i) => i === 0 ? `▶️ **กำลังเล่น:** ${t.title}` : `${i}. **${t.title}**`).join('\n');
        return interaction.reply({ content: `📋 **คิวเพลงปัจจุบัน:**\n${queueString}${tracks.length > 10 ? `\n...และอีก ${tracks.length - 10} เพลง` : ''}`, flags: MessageFlags.Ephemeral });
    }
}

// ต้องส่งออก handleMessages ด้วย เพื่อให้ index.js เรียกใช้งานได้
module.exports = { handleCommands, handleMessages };
