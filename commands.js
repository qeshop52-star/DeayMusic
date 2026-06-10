const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('discord-voip');
const ytSearch = require('yt-search');
const scdl = require('soundcloud-downloader').default; 
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } = require('discord.js');

const serverQueues = new Map();
const serverPanels = new Map(); 

function getControllerComponents(queue) {
    // เพิ่มบรรทัดนี้: ถ้าไม่มีคิวเพลง (ยังไม่เล่นเพลง) ให้ซ่อนปุ่มทั้งหมด
    if (!queue) return [];

    const currentFilter = queue?.filter && queue.filter !== 'none' ? queue.filter : 'none';
    
    const filterOptions = [
        { label: 'Clear', value: 'none', description: 'ล้างเอฟเฟคทั้งหมด' },
        { label: 'Bassboost', value: 'bassboost', description: 'เพิ่มเบสกระหึ่ม' },
        { label: 'Distort', value: 'distort', description: 'เสียงแตกๆ' },
        { label: 'Karaoke', value: 'karaoke', description: 'พยายามตัดเสียงร้อง' },
        { label: 'Nightcore', value: 'nightcore', description: 'เสียงแหลมเร็วขึ้น' },
        { label: 'Slowmo', value: 'slowmo', description: 'เสียงช้าลงยานๆ' },
        { label: 'Soft', value: 'soft', description: 'เสียงนุ่มนวล' },
        { label: 'TV', value: 'tv', description: 'เหมือนฟังผ่านทีวีเก่า' },
        { label: 'Treble Bass', value: 'treble_bass', description: 'เพิ่มทั้งแหลมและเบส' },
        { label: 'Vaporwave', value: 'vaporwave', description: 'เสียงยานช้าและหน่วง' },
        { label: '8D', value: '8d', description: 'เสียงหมุนรอบหัว' }
    ];

    const row1 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_effect')
            .setPlaceholder(`Active filters: ${currentFilter === 'none' ? 'ไม่มี' : currentFilter}`)
            .addOptions(filterOptions)
            .setDisabled(false) 
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
        .setColor('#ffb6c1') // แถบสีชมพูด้านซ้าย
        .setAuthor({ name: 'Deay Music Room', iconURL: client.user.displayAvatarURL() })
        .setDescription('Type name song or url to play music ˚ ⊹')
        .setImage('https://static0.cbrimages.com/wordpress/wp-content/uploads/2020/10/cleaning.jpg') // 📌 อย่าลืมเอาลิงก์รูปแบนเนอร์น้องชมพูมาใส่ตรงนี้นะครับ
        .setFooter({ text: 'Deaybot.work' });

    return { embeds: [embed], components: getControllerComponents(null) };
}

function getNowPlayingPanel(track, client, voiceChannel, queue) {
    const loopStates = ['ปิด', 'เพลงเดียว', 'ทั้งคิว'];
    const volText = queue.isMuted ? 'Mute' : Math.round(queue.volume * 100);
    const filterText = queue.filter === 'none' ? 'ไม่มี' : queue.filter;

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
        .setFooter({ text: `Node: Deay Server [Proxy] • loop: ${loopStates[queue.loopMode]} • volume: ${volText} • filter: ${filterText}` });

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

    return { embeds: [embed], components: getControllerComponents(queue) };
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
        
        try {
            queue.connection.destroy();
            serverQueues.delete(guildId);
        } catch (e) {
            console.error(e);
        }
        return;
    }

    const track = queue.tracks[0];
    queue.playing = true;
    updatePanelState(guildId); 

    try {
        let cleanTitle = track.title
            .replace(/\(Official.*?\)/gi, '')
            .replace(/\[Official.*?\]/gi, '')
            .replace(/\(Music Video\)/gi, '')
            .replace(/\(Audio\)/gi, '')
            .replace(/\(Lyric.*?\)/gi, '')
            .trim();

        let searchResults = null;
        let isOfficialNightcore = false;

        // ถ้าระบบเปิด Nightcore อยู่ ให้ลองค้นหาเพลงเวอร์ชั่น Nightcore แท้ๆ ดูก่อน
        if (queue.filter === 'nightcore') {
            let ncResults = await scdl.search({ query: `${cleanTitle} nightcore`, resourceType: 'tracks' });
            if (ncResults.collection && ncResults.collection.length > 0) {
                searchResults = ncResults;
                isOfficialNightcore = true; // เจอเวอร์ชั่นแท้แล้ว
            }
        }

        // ถ้าหาเวอร์ชั่น Nightcore แท้ไม่เจอ หรือไม่ได้เปิด Nightcore ให้หาเพลงต้นฉบับ
        if (!searchResults || !searchResults.collection || searchResults.collection.length === 0) {
            searchResults = await scdl.search({ query: cleanTitle, resourceType: 'tracks' });
        }

        if (!searchResults || !searchResults.collection || searchResults.collection.length === 0) {
            const extraCleanTitle = track.title.replace(/\[.*?\]|\(.*?\)/g, '').trim();
            searchResults = await scdl.search({ query: extraCleanTitle, resourceType: 'tracks' });
        }

        if (!searchResults || !searchResults.collection || searchResults.collection.length === 0) {
            let extraCleanTitle = track.title.replace(/\[.*?\]|\(.*?\)/g, '').trim();
            const titleOnly = extraCleanTitle.split('-').pop().trim(); 
            searchResults = await scdl.search({ query: titleOnly, resourceType: 'tracks' });
        }

        if (!searchResults || !searchResults.collection || searchResults.collection.length === 0) {
            throw new Error('ไม่พบไฟล์เสียงของเพลงนี้ในฐานข้อมูล SoundCloud');
        }

        const soundcloudTrackUrl = searchResults.collection[0].permalink_url;
        const stream = await scdl.download(soundcloudTrackUrl);

        let resource;

        if (queue.filter && queue.filter !== 'none') {
            const filters = {
                'bassboost': 'bass=g=15,dynaudnorm=f=200',
                'distort': 'extrastereo=m=2.5,tremolo=f=5.0:d=0.9',
                'karaoke': 'stereotools=mlev=0.1',
                'nightcore': 'asetrate=55200,aresample=48000,bass=g=4,treble=g=2', // แก้เลขตรงนี้
                'slowmo': 'atempo=0.8',
                'soft': 'compand=attacks=0:points=-80/-80|-15/-15|0/-15|20/-15',
                'tv': 'highpass=f=200,lowpass=f=3000',
                'treble_bass': 'treble=g=5,bass=g=5',
                'vaporwave': 'asetrate=38400,aresample=48000', // แก้เลขตรงนี้
                '8d': 'apulsator=hz=0.08'
            };

            let appliedFilter = filters[queue.filter] || 'anull';

            // หากหาเวอร์ชั่น Nightcore แท้เจอแล้ว ไม่ต้องให้ FFmpeg เร่งความเร็วซ้ำ (ให้ใส่แค่เบสกับเสียงแหลมพอ)
            if (queue.filter === 'nightcore' && isOfficialNightcore) {
                appliedFilter = 'bass=g=4,treble=g=2';
            }

            const prism = require('prism-media');
            const transcoder = new prism.FFmpeg({
                args: [
                    '-analyzeduration', '0',
                    '-loglevel', '0',
                    '-i', '-',
                    '-af', appliedFilter,
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2'
                ]
            });

            transcoder.on('error', (err) => {
                console.error("FFmpeg Transcoder Error:", err);
            });

            stream.pipe(transcoder);

            resource = createAudioResource(transcoder, { 
                inputType: StreamType.Raw,
                inlineVolume: true 
            });
        } else {
            resource = createAudioResource(stream, { inlineVolume: true });
        }

        resource.volume.setVolume(queue.isMuted ? 0 : queue.volume); 
        queue.resource = resource; 
        queue.player.play(resource);

    } catch (error) {
        console.error(`[Error] เล่นเพลงไม่ได้: ${error.message}`);
        
        try {
            await track.interaction.followUp({ content: `❌ ข้ามเพลง **${track.title}** (ดึงไฟล์เสียงไม่สำเร็จ)`, flags: MessageFlags.Ephemeral });
        } catch (e) {
            queue.textChannel.send(`❌ ข้ามเพลง **${track.title}** (ดึงไฟล์เสียงไม่สำเร็จ)`).then(msg => setTimeout(() => msg.delete().catch(()=>{}), 10000));
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

            queue = { 
                textChannel: interaction.channel, 
                voiceChannel: voiceChannel, 
                connection: connection, 
                player: player, 
                tracks: [], 
                playing: false,
                volume: 2.0,         
                isMuted: false,      
                loopMode: 0, 
                filter: 'none',
                restartPending: false, // สำหรับใช้รีสตาร์ทเพลงตอนเปลี่ยนเอฟเฟค
                resource: null 
            };
            serverQueues.set(interaction.guild.id, queue);

            player.on(AudioPlayerStatus.Idle, () => { 
                if (queue.restartPending) {
                     queue.restartPending = false;
                     playNext(interaction.guild.id);
                     return;
                }

                const currentTrack = queue.tracks[0];
                if (queue.loopMode === 0) { 
                    queue.tracks.shift(); 
                } else if (queue.loopMode === 1) { 
                    // โหมดวนเพลงเดิม ไม่ต้อง shift
                } else if (queue.loopMode === 2) { 
                    queue.tracks.shift();
                    queue.tracks.push(currentTrack);
                }
                playNext(interaction.guild.id); 
            });

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

        if (customId === 'select_effect') {
             if (!queue) return interaction.reply({ content: '❌ ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
             
             const selectedFilter = interaction.values[0];
             queue.filter = selectedFilter;
             
             if (queue.player.state.status === AudioPlayerStatus.Playing || queue.player.state.status === AudioPlayerStatus.Paused) {
                 queue.restartPending = true;
                 queue.player.stop(); 
             }
             
             updatePanelState(interaction.guild.id);
             
             const filterNames = {
                 'none': 'Clear (ไม่มีเอฟเฟค)', 'bassboost': 'Bassboost', 'distort': 'Distort', 
                 'karaoke': 'Karaoke', 'nightcore': 'Nightcore', 'slowmo': 'Slowmo',
                 'soft': 'Soft', 'tv': 'TV', 'treble_bass': 'Treble Bass', 'vaporwave': 'Vaporwave', '8d': '8D'
             };
             return interaction.reply({ content: `🎛️ เปลี่ยนเอฟเฟคเป็น: **${filterNames[selectedFilter]}** (กำลังประมวลผลเสียง...)`, flags: MessageFlags.Ephemeral });
        }

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

        if (customId === 'btn_loop') {
             if (!queue) return interaction.reply({ content: '❌ ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
             queue.loopMode = (queue.loopMode + 1) % 3; 
             const loopNames = ['ปิดลูป', 'วนเพลงเดียว', 'วนทั้งคิว'];
             updatePanelState(interaction.guild.id);
             return interaction.reply({ content: `🔁 โหมดลูป: **${loopNames[queue.loopMode]}**`, flags: MessageFlags.Ephemeral });
        }

        if (customId === 'btn_shuffle') {
             if (!queue || queue.tracks.length <= 1) return interaction.reply({ content: '❌ ไม่มีเพลงในคิวให้สลับครับ', flags: MessageFlags.Ephemeral });
             const upcoming = queue.tracks.slice(1);
             for (let i = upcoming.length - 1; i > 0; i--) {
                 const j = Math.floor(Math.random() * (i + 1));
                 [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
             }
             queue.tracks = [queue.tracks[0], ...upcoming];
             updatePanelState(interaction.guild.id);
             return interaction.reply({ content: '🔀 สลับตำแหน่งเพลงในคิวเรียบร้อย', flags: MessageFlags.Ephemeral });
        }

        if (customId === 'btn_vol_up') {
             if (!queue) return interaction.reply({ content: '❌ ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
             queue.volume = Math.min(2.0, queue.volume + 0.1); 
             if (!queue.isMuted && queue.resource) queue.resource.volume.setVolume(queue.volume);
             updatePanelState(interaction.guild.id);
             return interaction.reply({ content: `🔊 เพิ่มเสียงเป็น **${Math.round(queue.volume * 100)}%**`, flags: MessageFlags.Ephemeral });
        }

        if (customId === 'btn_vol_down') {
             if (!queue) return interaction.reply({ content: '❌ ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
             queue.volume = Math.max(0.1, queue.volume - 0.1); 
             if (!queue.isMuted && queue.resource) queue.resource.volume.setVolume(queue.volume);
             updatePanelState(interaction.guild.id);
             return interaction.reply({ content: `🔉 ลดเสียงเหลือ **${Math.round(queue.volume * 100)}%**`, flags: MessageFlags.Ephemeral });
        }

        if (customId === 'btn_mute') {
             if (!queue) return interaction.reply({ content: '❌ ไม่มีเพลงเล่นอยู่ครับ', flags: MessageFlags.Ephemeral });
             queue.isMuted = !queue.isMuted;
             if (queue.resource) queue.resource.volume.setVolume(queue.isMuted ? 0 : queue.volume);
             updatePanelState(interaction.guild.id);
             return interaction.reply({ content: queue.isMuted ? '🔇 ปิดเสียงชั่วคราว' : `🔊 เปิดเสียงกลับมาที่ **${Math.round(queue.volume * 100)}%**`, flags: MessageFlags.Ephemeral });
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
