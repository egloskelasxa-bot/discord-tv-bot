require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { Streamer } = require('@dank074/discord-video-stream');
const { 
    MessageEmbed, 
    MessageActionRow, 
    MessageButton, 
    MessageSelectMenu 
} = require('discord.js-selfbot-v13');
const channelsData = require('./channels.js');

const client = new Client();
const streamer = new Streamer(client);
const activeSessions = new Map();

// Global Error Handler agar bot tidak gampang crash
process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
});
process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

client.once('ready', () => {
    console.log(`🛡️ AGC Supreme AFK TV Bot online sebagai ${client.user.tag}`);
});

const getAllChannels = () => {
    return [
        ...channelsData.categories.nasional_umum, 
        ...channelsData.categories.berita_dewasa,
        ...channelsData.categories.anak_anak
    ];
};

// Fungsi UI Remote Control Interaktif
function createRemotePayload(session) {
    const { channel, quality, isAutoRotate, startTime } = session;
    const allChannels = getAllChannels();
    const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);

    const embed = new MessageEmbed()
        .setTitle('📺 AGC SUPREME AFK TV LOUNGE')
        .setDescription('Channel hiburan, berita, & anak-anak real-time untuk menemani waktu santai/AFK Anda di Voice Channel.')
        .addField('Stasiun TV Aktif', `**${channel.name}**`, true)
        .addField('Kualitas Stream', `\`${quality}\``, true)
        .addField('Mode Auto-Rotate', isAutoRotate ? '🟢 ON (Ganti otomatis)' : '🔴 OFF', true)
        .addField('Durasi Nonton (Uptime)', `⏱️ ${uptimeMinutes} Menit`, false)
        .setColor('#5865F2')
        .setTimestamp()
        .setFooter({ text: 'Arcania Gaming Network • AFK Stream Engine' });

    const selectMenu = new MessageSelectMenu()
        .setCustomId('tv_select_channel')
        .setPlaceholder('📂 Pilih Stasiun TV...')
        .addOptions(
            allChannels.map(ch => ({
                label: ch.name,
                value: ch.id,
                description: `Pindah siaran ke ${ch.name}`,
                default: ch.id === channel.id
            }))
        );

    const rowSelect = new MessageActionRow().addComponents(selectMenu);

    const row1 = new MessageActionRow().addComponents(
        new MessageButton().setCustomId('tv_prev').setLabel('◀ Prev').setStyle('PRIMARY'),
        new MessageButton().setCustomId('tv_autorotate').setLabel(isAutoRotate ? '🛑 Matikan Auto-Rotate' : '🔄 Auto-Rotate: ON').setStyle(isAutoRotate ? 'SUCCESS' : 'SECONDARY'),
        new MessageButton().setCustomId('tv_next').setLabel('Next ▶').setStyle('PRIMARY')
    );

    const row2 = new MessageActionRow().addComponents(
        new MessageButton().setCustomId('tv_quality').setLabel('⚙️ Kualitas').setStyle('SECONDARY'),
        new MessageButton().setCustomId('tv_refresh').setLabel('🔄 Reconnect Stream').setStyle('SUCCESS'),
        new MessageButton().setCustomId('tv_off').setLabel('⏹ Matikan TV').setStyle('DANGER')
    );

    return { embeds: [embed], components: [rowSelect, row1, row2] };
}

// Fungsi inti untuk memutar video
async function playStream(guildId, channelObj, qualitySetting) {
    const session = activeSessions.get(guildId);
    if (!session) return;

    try {
        try { streamer.stopStream(); } catch (e) {}
        
        const fpsVal = qualitySetting.includes('60') ? 60 : 30;
        const bitrateVal = qualitySetting.includes('1080') ? 4500 : 2500;

        const udpConn = await streamer.createStream({
            fps: fpsVal,
            bitrate: bitrateVal,
            videoCodec: 'H264'
        });

        session.streamProcess = streamer.playVideo(channelObj.url, udpConn);
        session.channel = channelObj;
        session.quality = qualitySetting;
    } catch (err) {
        console.error(`Gagal memutar stream ${channelObj.name}:`, err);
        setTimeout(() => {
            if (activeSessions.has(guildId)) {
                playStream(guildId, channelObj, qualitySetting);
            }
        }, 5000);
    }
}

// Interval Auto-Rotate channel setiap 20 menit khusus mode AFK
setInterval(() => {
    for (const [guildId, session] of activeSessions.entries()) {
        if (session.isAutoRotate) {
            const allCh = getAllChannels();
            let currentIndex = allCh.findIndex(c => c.id === session.channel.id);
            currentIndex = (currentIndex + 1) % allCh.length;
            const nextCh = allCh[currentIndex];

            playStream(guildId, nextCh, session.quality);
            
            if (session.remoteMessage) {
                session.remoteMessage.edit(createRemotePayload(session)).catch(() => {});
            }
        }
    }
}, 20 * 60 * 1000);

// Event Handler Command Pesan
client.on('messageCreate', async (message) => {
    if (message.author.id !== client.user.id || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'tv-on') {
        const voiceChannel = message.member?.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ Anda harus masuk ke dalam **Voice Channel** terlebih dahulu untuk menemani sesi AFK!');
        }

        if (activeSessions.has(message.guild.id)) {
            try { streamer.stopStream(); } catch (e) {}
            activeSessions.delete(message.guild.id);
        }

        const allChannels = getAllChannels();
        const initialChannel = allChannels[0];
        const defaultQuality = '720p30';

        try {
            await message.reply('📺 Membuka siaran TV untuk ruang AFK...');

            await streamer.joinVoiceChannel(voiceChannel);

            const sessionData = {
                channel: initialChannel,
                quality: defaultQuality,
                isAutoRotate: false,
                startTime: Date.now(),
                streamProcess: null,
                voiceChannelId: voiceChannel.id,
                remoteMessage: null
            };

            activeSessions.set(message.guild.id, sessionData);
            await playStream(message.guild.id, initialChannel, defaultQuality);

            const remoteMessage = await message.channel.send(createRemotePayload(sessionData));
            sessionData.remoteMessage = remoteMessage;

            const collector = remoteMessage.createMessageComponentCollector({ time: 86400000 });

            collector.on('collect', async (interaction) => {
                const session = activeSessions.get(interaction.guild.id);
                if (!session) {
                    return interaction.reply({ content: '❌ Sesi TV sudah berakhir.', ephemeral: true });
                }

                const allCh = getAllChannels();

                if (interaction.isSelectMenu()) {
                    await interaction.deferUpdate();
                    const selectedId = interaction.values[0];
                    const newChannel = allCh.find(c => c.id === selectedId);
                    
                    if (newChannel) {
                        await playStream(interaction.guild.id, newChannel, session.quality);
                        await interaction.editReply(createRemotePayload(session));
                    }
                } 
                else if (interaction.isButton()) {
                    await interaction.deferUpdate();

                    if (interaction.customId === 'tv_next' || interaction.customId === 'tv_prev') {
                        let currentIndex = allCh.findIndex(c => c.id === session.channel.id);
                        if (interaction.customId === 'tv_next') {
                            currentIndex = (currentIndex + 1) % allCh.length;
                        } else {
                            currentIndex = (currentIndex - 1 + allCh.length) % allCh.length;
                        }
                        
                        await playStream(interaction.guild.id, allCh[currentIndex], session.quality);
                        await interaction.editReply(createRemotePayload(session));
                    } 
                    else if (interaction.customId === 'tv_autorotate') {
                        session.isAutoRotate = !session.isAutoRotate;
                        await interaction.editReply(createRemotePayload(session));
                    }
                    else if (interaction.customId === 'tv_quality') {
                        if (session.quality === '720p30') session.quality = '720p60';
                        else if (session.quality === '720p60') session.quality = '1080p60';
                        else session.quality = '720p30';

                        await playStream(interaction.guild.id, session.channel, session.quality);
                        await interaction.editReply(createRemotePayload(session));
                    }
                    else if (interaction.customId === 'tv_refresh') {
                        await playStream(interaction.guild.id, session.channel, session.quality);
                        await interaction.followUp({ content: '🔄 Stream berhasil disegarkan kembali!', ephemeral: true });
                    }
                    else if (interaction.customId === 'tv_off') {
                        try { streamer.stopStream(); } catch (e) {}
                        try { streamer.leaveVoiceChannel(); } catch (e) {}
                        activeSessions.delete(interaction.guild.id);
                        collector.stop();

                        await interaction.editReply({
                            content: '🔴 **Televisi AFK dimatikan.** Sampai jumpa lagi!',
                            embeds: [],
                            components: []
                        });
                    }
                }
            });

        } catch (error) {
            console.error(error);
            message.channel.send('❌ Gagal menyalakan TV AFK. Pastikan dependensi FFmpeg aktif.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
