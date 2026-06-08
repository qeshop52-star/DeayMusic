const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('discord-voip');
const playdl = require('play-dl');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

playdl.getFreeClientID().then((clientID) => {
    playdl.setToken({ soundcloud: { client_id: clientID } });
}).catch(err => console.error("Could not set SoundCloud token:", err));

const serverQueues = new Map();
const serverPanels = new Map(); // เก็บตัวแปรเพื่อจดจำแผงควบคุมของแต่ละเซิฟเวอร์

// ฟังก์ชัน 1: โครงสร้างแผงควบคุมตอน "ไม่มีเพลงเล่น"
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

// ฟังก์ชัน 2: โครงสร้างแผงควบคุมตอน "กำลังเล่นเพลง"
function getNowPlayingPanel(track, client, voiceChannel) {
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
        .setImage('https://static0.cbrimages.com/wordpress/wp-content/uploads/2020/10/cleaning.jpg') 
        .setFooter({ text: 'ถ้าชอบเพลงนี้พิมพ์ /play เพื่อเล่นเพลงต่อได้เลย' });

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

// ฟังก์ชัน 3: สั่งให้แผงควบคุมอัปเดตหน้าตาตามสถานะปัจจุบัน
async function updatePanelState(guildId) {
    const queue = serverQueues.get(guildId);
    const panelMsg = serverPanels.get(guildId);
    if (!panelMsg) return;

    try {
        if (!queue || queue.tracks.length === 0) {
            // ถ้าคิวว่างเปล่า ให้คืนร่างแผงกลับเป็นหน้าเดิม
            await panelMsg.edit(getDefaultPanel(panelMsg.client));
        } else {
            // ถ้ามีเพลงเล่นอยู่ ให้เปลี่ยนแผงเป็นหน้าตาตารางเพลง
            const currentTrack = queue.tracks[0];
            await panelMsg.edit(getNowPlayingPanel(currentTrack, panelMsg.client, queue.voiceChannel));
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
        updatePanelState(guildId); // พอเพลงจบหมดคิว สั่งให้แผงเปลี่ยนกลับหน้าเดิม!
        return;
    }

    const track = queue.tracks[0];
    queue.playing = true;
    updatePanelState(guildId); // พอเพลงเริ่มเล่น สั่งให้แผงเปลี่ยนเป็นรูปข้อมูลเพลง!

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

    // แยกระบบตอบรับระหว่างปุ่มกด กับการพิมพ์คำสั่งปกติ
    if (interaction.isButton()) {
        await interaction.deferUpdate(); // ให้ปุ่มหยุดหมุน
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
                    isRandom: isRandom // ส่งข้อมูลให้รู้ว่าเกิดจากการกดปุ่มสุ่ม
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
        
        // ตอบกลับเบาๆ แบบเห็นเฉพาะเราว่าเพิ่มเพลงลงคิวแล้ว (ไม่ต้องโชว์กรอบใหญ่กวนแชท)
        const addMsg = `✅ เพิ่มเพลง **${trackInfo.title}** ลงคิวแล้ว`;
        if (interaction.isButton()) {
            await interaction.followUp({ content: addMsg, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.editReply({ content: addMsg });
        }

        if (!queue.playing) playNext(interaction.guild.id);
        // ถ้าคิวเดินอยู่แล้ว ไม่ต้องอัปเดตแผง เดี๋ยวมันอัปเดตเองตอนเพลงถึงคิว

    } catch (e) {
        console.error(e);
        if (interaction.isButton()) {
            return interaction.followUp({ content: `❌ เกิดข้อผิดพลาด: ${e.message}`, flags: MessageFlags.Ephemeral });
        } else {
            return interaction.editReply({ content: `❌ เกิดข้อผิดพลาด: ${e.message}` });
        }
    }
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
            
            // สำคัญ! บันทึกว่าแผงควบคุมคือข้อความนี้นะ จะได้กลับมาแก้ไขถูก
            serverPanels.set(interaction.guild.id, interaction.message);

            return playLogic(interaction, randomQuery, true); 
        }
        return;
    }

    const commandName = interaction.commandName;

    if (commandName === 'panel') {
        // ใช้ fetchReply เพื่อเอา message ก้อนนี้ไปบันทึกเป็นแผงควบคุมหลัก
        const msg = await interaction.reply({ ...getDefaultPanel(interaction.client), fetchReply: true });
        
        // บันทึกแผงลงระบบความจำของเซิฟเวอร์
        serverPanels.set(interaction.guild.id, msg);
        
        // ถ้าระหว่างเรียกแผงใหม่ มีเพลงเล่นอยู่พอดี ให้มันอัปเดตโชว์เพลงทันที
        updatePanelState(interaction.guild.id);
        return;
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
        
        // สั่งให้แผงกลับเป็นหน้าเดิมหลังหยุดเพลง
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

module.exports = handleCommands;
