const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('discord-voip');
const ytSearch = require('yt-search');
const scdl = require('soundcloud-downloader').default; // เครื่องยนต์ใหม่ของเรา!
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } = require('discord.js');

const serverQueues = new Map();
const serverPanels = new Map(); 

function getControllerComponents() {
    const row1 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_effect')
            .setPlaceholder('เลือกเอฟเฟคเสียงที่ต้องการ')
            .addOptions([{ label: 'ยังไม่เปิดใช้งาน', value: 'dummy' }])
            .setDisabled(true)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('saved_songs')
            .setPlaceholder('ไม่มีเพลงที่ท่านบันทึก')
            .addOptions([
                { label: 'สุ่มเพลง (Random Song)', value: 'random_song', description: 'คลิกเพื่อสุ่มเล่นเพลง' }
            ])
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('btn_loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary)
    );

    const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_vol_up').setEmoji('🔊').setLabel('เพิ่มเสียง').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_vol_down').setEmoji('🔉').setLabel('ลดเสียง').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_mute').setEmoji('🔇').setLabel('ปิด/เปิดเสียง').setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2, row3, row4];
}

function getDefaultPanel(client) {
    const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setAuthor({ name: `${client.user.username}'s - Music System`, iconURL: client.user.displayAvatarURL() })
        .setTitle('ไม่มีเพลงที่กำลังเล่นอยู่ในขณะนี้')
        .setDescription('ไม่มีเพลงฟังหรอ? ลองสุ่มเพลงดูสิ\n\n**Paste the song link or song name**')
        .setImage('https://static0.cbrimages.com/wordpress/wp-content/uploads/2020/10/cleaning.jpg?q=50&fit=crop&w=825&dpr=1.5') 
        .setFooter({ text: 'Discord Support : discord.gg/xxxxx | Developer : Deay' });

    return { embeds: [embed], components: getControllerComponents() };
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
            { name: '👤 เพิ่มเพลงโดย', value: `<@${track.requester.id}>`, inline: true },
            { name: '🔊 ช่องเสียง', value: `🔊 ${voiceChannel.name}`, inline: true },
            { name: '✨ เชิญบอท', value: `[Invite](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)`, inline: true }
        )
        .setImage(track.thumbnail || 'https://i.imgur.com/vHqBEM3.png')  
        .setFooter({ text: 'Node: Deay Server [Proxy] • loop: ปิด • volume: 100 • autoplay: ปิด' });

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

    return { embeds: [embed], components: getControllerComponents() };
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
        
        // ตัดการเชื่อมต่อและล้างฐานข้อมูลคิวเมื่อไม่มีเพลง
        queue.connection.destroy();
        serverQueues.delete(guildId);
        
        return;
    }

    const track = queue.tracks[0];
    queue.playing = true;
    updatePanelState(guildId); 

    try {
        // ล้างคำพ่วงท้ายในชื่อเพลง เพื่อให้หาใน SoundCloud เจอง่ายขึ้น
        let cleanTitle = track.title
            .replace(/\(Official.*?\)/gi, '')
            .replace(/\[Official.*?\]/gi, '')
            .replace(/\(Music Video\)/gi, '')
            .replace(/\(Audio\)/gi, '')
            .replace(/\(Lyric.*?\)/gi, '')
            .trim();

        // เอาชื่อเพลงไปค้นหาในฐานข้อมูล SoundCloud แทน
        const searchResults = await scdl.search({
            query: cleanTitle,
            resourceType: 'tracks'
        });

        if (!searchResults.collection || searchResults.collection.length === 0) {
            throw new Error('ไม่พบไฟล์เสียงของเพลงนี้ในฐานข้อมูล SoundCloud');
        }

        // ดึงลิงก์ไฟล์เสียงตรงๆ จาก SoundCloud มาเล่น
        const soundcloudTrackUrl = searchResults.collection[0].permalink_url;
        const stream = await scdl.download(soundcloudTrackUrl);

        const resource = createAudioResource(stream);
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

    let cleanQuery = query.trim();
    const urlMatch = cleanQuery.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
        cleanQuery = urlMatch[0]; 
    }

    if (cleanQuery.includes('youtube.com/watch') && cleanQuery.includes('&list=')) {
        cleanQuery = cleanQuery.split('&list=')[0];
    }

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await interaction.deferUpdate(); 
        await interaction.followUp({ content: isRandom ? '🎲 กำลังสุ่มเพลงให้คุณฟัง...' : '⏳ กำลังค้นหาเพลง...', flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ content: '⏳ กำลังค้นหาเพลง...', flags: MessageFlags.Ephemeral });
    }

    try {
        let trackInfo = null;
        let searchResult = null;

        // ดึงหน้าปกและข้อมูลความสวยงามจาก YouTube เหมือนเดิม (เพราะตรงนี้ไม่โดนบล็อก)
        if (cleanQuery.includes('youtube.com') || cleanQuery.includes('youtu.be')) {
             const videoIdMatch = cleanQuery.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
             if (videoIdMatch && videoIdMatch[1]) {
                 searchResult = await ytSearch({ videoId: videoIdMatch[1] }).catch(() => null);
             }
        }
        
        if (!searchResult) {
             const r = await ytSearch(cleanQuery).catch(() => null);
             if (r && r.videos && r.videos.length > 0) {
                  searchResult = r.videos[0];
             }
        }

        if (searchResult) {
            trackInfo = {
                title: searchResult.title,
                url: searchResult.url,
                thumbnail: searchResult.thumbnail || searchResult.image,
                author: searchResult.author?.name || "Unknown",
                duration: searchResult.timestamp || searchResult.duration?.timestamp || "Unknown",
                requester: interaction.user,
                interaction: interaction,
                isRandom: isRandom 
            };
        }

        if (!trackInfo) {
            const errorMsg = '❌ ค้นหาเพลงไม่เจอ แนะนำให้ตรวจสอบชื่อเพลงหรือลิงก์ใหม่นะครับ!';
            if (interaction.isButton() || interaction.isStringSelectMenu()) {
                return interaction.followUp({ content: errorMsg, flags: MessageFlags.Ephemeral });
            } else {
                return interaction.editReply({ content: errorMsg });
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
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
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
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
            return interaction.followUp({ content: `❌ เกิดข้อผิดพลาด: ${e.message}`, flags: MessageFlags.Ephemeral });
        } else {
            return interaction.editReply({ content: `❌ เกิดข้อผิดพลาด: ${e.message}` });
        }
    }
}

async function handleMessages(message) {
    message.delete().catch(() => {});

    const sendTempMsg = async (opts) => {
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

    const fakeInteraction = {
        guild: message.guild,
        member: message.member,
        user: message.author,
        channel: message.channel,
        client: message.client,
        isButton: () => false,
        isStringSelectMenu: () => false,
        reply: sendTempMsg,
        editReply: sendTempMsg,
        followUp: sendTempMsg
    };

    return playLogic(fakeInteraction, message.content, false);
}

async function handleCommands(interaction) {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const customId = interaction.customId;
        const queue = serverQueues.get(interaction.guild.id);

        if (customId === 'saved_songs' && interaction.values[0] === 'random_song') {
            const randomSongs = ["lofi hip hop radio - beats to relax/study to", "จี่หอย", "Shape of You", "ตามตะวัน", "ทรงอย่างแบด", "Every Summertime", "Sabrina Carpenter"];
            const randomQuery = randomSongs[Math.floor(Math.random() * randomSongs.length)];
            serverPanels.set(interaction.guild.id, interaction.message);
            return playLogic(interaction, randomQuery, true); 
        }

        if (customId === 'btn_pause') {
            if (!queue) return interaction.reply({ content: '❌ ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
            if (queue.player.state.status === AudioPlayerStatus.Playing) {
                queue.player.pause();
                return interaction.reply({ content: '⏸️ หยุดเพลงชั่วคราวแล้ว', flags: MessageFlags.Ephemeral });
            } else if (queue.player.state.status === AudioPlayerStatus.Paused) {
                queue.player.unpause();
                return interaction.reply({ content: '▶️ เล่นเพลงต่อแล้ว', flags: MessageFlags.Ephemeral });
            }
        }
        
        if (customId === 'btn_skip') {
             if (!queue || !queue.playing) return interaction.reply({ content: '❌ ไม่มีเพลงให้ข้ามครับ', flags: MessageFlags.Ephemeral });
             queue.player.stop(); 
             return interaction.reply({ content: '⏭️ ข้ามเพลงเรียบร้อย', flags: MessageFlags.Ephemeral });
        }

        if (customId === 'btn_stop') {
             if (!queue) return interaction.reply({ content: '❌ ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
             queue.tracks = []; queue.player.stop(); queue.connection.destroy(); serverQueues.delete(interaction.guild.id);
             updatePanelState(interaction.guild.id);
             return interaction.reply({ content: '⏹️ หยุดเพลงและล้างคิวเรียบร้อย', flags: MessageFlags.Ephemeral });
        }

        if (['btn_loop', 'btn_shuffle', 'btn_vol_up', 'btn_vol_down', 'btn_mute', 'select_effect'].includes(customId)) {
             return interaction.reply({ content: '🚧 ฟีเจอร์นี้กำลังพัฒนานะครับ อดใจรอการอัปเดตเวอร์ชั่นหน้านะ!', flags: MessageFlags.Ephemeral });
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

        try {
            const fetched = await targetChannel.messages.fetch({ limit: 50 });
            await targetChannel.bulkDelete(fetched);
        } catch(e) { }

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

module.exports = { handleCommands, handleMessages };
