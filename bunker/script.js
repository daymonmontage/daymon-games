import { CONFIG } from '../js/modules/config.js';
import { BUNKER_DATA, getRandomItem } from './game_data.js';
import { showScreen, showError, showAlert, showConfirm, screens } from './js/ui.js';
import { renderPlayersList, renderMyCards, renderVoteOptions } from './js/render.js';
import { initChat } from './js/chat.js';
import { startTutorial } from './js/tutorial.js';
import { LORE_PRESETS, generateBetaLore } from './js/lore.js';
import './js/animations.js';

window.BUNKER_DATA_REF = BUNKER_DATA;
window.getRandomItemRef = getRandomItem;

const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

let currentUser = null;
let currentRoomId = null;
let currentRoomCode = null;
let isHost = false;
let isSpectator = false;
let realtimeChannel = null;
let syncInterval = null; 
let lobbyRoomsTimer = null;
let heartbeatInterval = null;
let currentPresenceIds = new Set(); 


const playersListEl = document.getElementById('players-list');
const gamePlayersListEl = document.getElementById('game-players-list');
const startGameBtn = document.getElementById('start-game-btn');
const myCardsContainer = document.getElementById('my-cards');

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        showAlert("Для игры в Бункер необходимо авторизоваться через Discord в главном меню!", () => {
            window.location.href = '../index.html';
        });
        return;
    }
    currentUser = session.user;

    
    if (currentUser) {
        const onlineChannel = supabase.channel('bunker_presence_global')
            .on('presence', { event: 'sync' }, () => {
                const state = onlineChannel.presenceState();
                const count = Object.keys(state).length;
                const el = document.getElementById('online-count-val');
                if (el) el.textContent = count;
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await onlineChannel.track({ 
                        user_id: currentUser.id,
                        online_at: new Date().toISOString() 
                    });
                }
            });
    }

    initChat(supabase, window.playBunkerSFX);

    
    await checkExistingRoom();

    
    document.getElementById('create-room-btn').addEventListener('click', () => {
        document.getElementById('room-settings-modal').classList.add('active');
    });

    
    document.getElementById('cancel-create-btn').addEventListener('click', () => {
        document.getElementById('room-settings-modal').classList.remove('active');
    });

    
    document.getElementById('confirm-create-btn').addEventListener('click', createRoom);
    document.getElementById('join-room-btn').addEventListener('click', joinRoom);
    startGameBtn.addEventListener('click', startGame);

    
    const loreSelect = document.getElementById('setting-lore');
    const lorePreviewBox = document.getElementById('lore-preview-box');
    const lorePreviewText = document.getElementById('lore-preview-text');
    const loreRerollBtn = document.getElementById('lore-reroll-btn');

    function updateLorePreview() {
        const val = loreSelect.value;
        lorePreviewBox.style.display = 'block';
        if (val === 'auto_beta') {
            loreRerollBtn.style.display = 'block';
            lorePreviewText.textContent = generateBetaLore();
        } else {
            loreRerollBtn.style.display = 'none';
            const preset = LORE_PRESETS.find(p => p.id === val);
            lorePreviewText.textContent = preset ? `[${preset.name}]\n\n${preset.text}` : '';
        }
    }
    
    loreSelect.addEventListener('change', updateLorePreview);
    loreRerollBtn.addEventListener('click', updateLorePreview);
    
    
    updateLorePreview();

    
    const maxPlayersInput = document.getElementById('setting-max-players');
    const survivorsInput = document.getElementById('setting-survivors');
    maxPlayersInput.addEventListener('input', () => {
        const val = parseInt(maxPlayersInput.value);
        survivorsInput.max = val;
        
        if (parseInt(survivorsInput.value) > val) {
            survivorsInput.value = val;
            document.getElementById('survivors-val').textContent = val;
        }
    });

    loadPublicRooms();
    lobbyRoomsTimer = setInterval(loadPublicRooms, 5000);
    document.querySelectorAll('.leave-game-btn').forEach(btn => {
        btn.addEventListener('click', window.leaveRoom);
    });

    
    document.getElementById('restart-room-btn').addEventListener('click', async () => {
        if (!isHost) return;
        
        document.getElementById('restart-room-btn').textContent = "СБРОС...";
        document.getElementById('restart-room-btn').disabled = true;

        
        await supabase.from('bunker_players').update({ 
            is_alive: true, 
            cards: null, 
            revealed_cards: [] 
        }).eq('room_id', currentRoomId);

        
        await supabase.from('bunker_rooms').update({ 
            status: 'waiting',
            voting_active: false,
            votes: {} 
        }).eq('id', currentRoomId);

        document.getElementById('restart-room-btn').textContent = "ИГРАТЬ ЕЩЕ";
        document.getElementById('restart-room-btn').disabled = false;
        
        
        document.getElementById('game-over-modal').classList.remove('active');
        showScreen('waiting');
    });

    
    document.getElementById('start-vote-btn').addEventListener('click', startVotingProcess);
    document.getElementById('end-vote-btn').addEventListener('click', endVotingProcess);
    
    const tutBtn = document.getElementById('tutorial-trigger-btn');
    if (tutBtn) {
        tutBtn.addEventListener('click', () => {
            if (screens.game.classList.contains('active')) {
                window._forceTutorial = true;
                startTutorial();
            } else {
                showAlert("Обучение доступно только во время самой игры за столом!");
            }
        });
    }
});



async function loadPublicRooms() {
    if (!screens.lobby.classList.contains('active')) return;

    if (window.connectGlobalChat && currentUser) {
        window.connectGlobalChat({
            id: currentUser.id,
            username: currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.user_metadata?.username || currentUser.user_metadata?.custom_claims?.global_name || currentUser.email.split('@')[0],
            avatar_url: currentUser.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.id}`
        });
    }

    
    const d = new Date();
    d.setMinutes(d.getMinutes() - 5); 
    
    
    const { data: rooms, error } = await supabase
        .from('bunker_rooms')
        .select('*')
        .gte('last_active', d.toISOString())
        .eq('is_private', false) 
        .order('last_active', { ascending: false })
        .limit(10);

    const listEl = document.getElementById('public-rooms-list');
    if (error || !rooms || rooms.length === 0) {
        listEl.innerHTML = '<div class="radar-loading" style="color: #ef4444; text-shadow: 0 0 10px rgba(239, 68, 68, 0.5);">СИГНАЛОВ НЕ ОБНАРУЖЕНО</div>';
        return;
    }

    
    const roomIds = rooms.map(r => r.id);
    const { data: players } = await supabase
        .from('bunker_players')
        .select('room_id, user_id, username')
        .in('room_id', roomIds);

    let html = '';
    for (const room of rooms) {
        const isPlaying = room.status === 'playing';
        const statusText = isPlaying ? 'В ИГРЕ (СЕССИЯ АКТИВНА)' : 'ОЖИДАЕТ ВЫЖИВШИХ';
        const statusClass = isPlaying ? 'playing' : 'waiting';
        
        
        const hostPlayer = players?.find(p => p.room_id === room.id && p.user_id === room.host_id);
        const hostName = hostPlayer ? hostPlayer.username : 'Неизвестный';
        
        
        const playersInRoom = players?.filter(p => p.room_id === room.id).length || 0;
        const maxPlayers = room.max_players || 10;
        
        let actionBtn = '';
        if (isPlaying) {
            actionBtn = `<button class="room-card-action spectate" onclick="window.spectateRoom('${room.room_code}')"><i class="fas fa-eye"></i> СМОТРЕТЬ</button>`;
        } else {
            
            if (playersInRoom >= maxPlayers) {
                actionBtn = `<button class="room-card-action" style="opacity: 0.5; border-color: #ef4444; color: #ef4444; cursor: not-allowed;" title="Мест нет"><i class="fas fa-times"></i> ПОЛНАЯ</button>`;
            } else {
                actionBtn = `<button class="room-card-action" onclick="window.joinRoomByCode('${room.room_code}')"><i class="fas fa-sign-in-alt"></i> ВОЙТИ</button>`;
            }
        }

        
        html += `
            <div class="room-card ${statusClass}">
                <div class="room-card-info" style="width: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 10px;">
                        <span class="room-card-code">БУНКЕР #${room.room_code}</span>
                        <span style="font-size: 0.7rem; color: #a1a1aa; font-family: var(--font-pixel);"><i class="fas fa-users" style="color: #3b82f6;"></i> ${playersInRoom}/${maxPlayers}</span>
                    </div>
                    <span class="room-card-host"><i class="fas fa-crown"></i> ${hostName}</span>
                    <span class="room-card-status ${statusClass}">${statusText}</span>
                </div>
                <div style="margin-left: 10px;">
                    ${actionBtn}
                </div>
            </div>
        `;
    }
    listEl.innerHTML = html;
}

window.joinRoomByCode = function(code) {
    document.getElementById('room-code-input').value = code;
    joinRoom();
};

window.spectateRoom = async function(code) {
    const { data: room, error } = await supabase.from('bunker_rooms').select('*').eq('room_code', code).single();
    if (error || !room) return showError("Комната не найдена!");

    currentRoomId = room.id;
    currentRoomCode = code;
    isHost = false;
    isSpectator = true; 

    document.getElementById('current-room-code').textContent = code + " (НАБЛЮДЕНИЕ)";
    
    if (lobbyRoomsTimer) clearInterval(lobbyRoomsTimer);

    window._loreShownOnStart = false;
    showScreen('waiting');
    startSync();
};



function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

async function createRoom() {
    
    const maxPlayers = parseInt(document.getElementById('setting-max-players').value);
    const isPrivate = document.getElementById('setting-privacy').value === 'private';
    const requireApproval = document.getElementById('setting-approval').checked;
    
    
    const lorePreviewEl = document.getElementById('lore-preview-text');
    let fullLoreText = lorePreviewEl ? lorePreviewEl.textContent : "Неизвестная глобальная катастрофа...";

    
    if (document.getElementById('setting-lore').value === "auto_beta") {
        if (!fullLoreText.startsWith("[БЕТА-ПРОТОКОЛ")) {
            fullLoreText = "[БЕТА-ПРОТОКОЛ СГЕНЕРИРОВАН]\n\n" + fullLoreText;
        }
    }

    const survivorsLimit = parseInt(document.getElementById('setting-survivors').value);
    fullLoreText += `\n\n📌 МЕСТ В БУНКЕРЕ (КВОТА ВЫЖИВШИХ): ${survivorsLimit} чел.`;

    
    document.getElementById('room-settings-modal').classList.remove('active');

    const code = generateRoomCode();
    
    
    const { data: room, error } = await supabase.from('bunker_rooms').insert([{ 
        room_code: code, 
        host_id: currentUser.id, 
        status: 'waiting',
        max_players: maxPlayers,
        is_private: isPrivate,
        require_approval: requireApproval,
        lore: fullLoreText
    }]).select().single();

    if (error) {
        console.error(error);
        return showError("Ошибка создания комнаты. Проверьте БД.");
    }

    currentRoomId = room.id;
    currentRoomCode = code;
    isHost = true;

    await addPlayerToRoom();
    document.getElementById('current-room-code').textContent = code;
    startGameBtn.style.display = 'block';
    
    if (lobbyRoomsTimer) clearInterval(lobbyRoomsTimer);
    showScreen('waiting');
    
    window._loreShownOnStart = false;
    startSync();
    startHeartbeat();
}

async function joinRoom() {
    const codeInput = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (codeInput.length !== 6) return showError("Код должен состоять из 6 символов!");

    const { data: room, error } = await supabase.from('bunker_rooms').select('*').eq('room_code', codeInput).single();
    if (error || !room) return showError("Комната не найдена!");
    if (room.status !== 'waiting') return showError("Игра уже началась!");

    currentRoomId = room.id;
    currentRoomCode = codeInput;
    isHost = (room.host_id === currentUser.id); 

    
    let joinStatus = 'approved';
    if (room.require_approval && !isHost) {
        joinStatus = 'pending';
    }

    const joined = await addPlayerToRoom(joinStatus);
    if (!joined) return;

    document.getElementById('current-room-code').textContent = codeInput;
    
    if (joinStatus === 'pending') {
        document.getElementById('join-pending-modal').classList.add('active');
    }

    if (isHost) {
        document.getElementById('start-game-btn').style.display = 'block';
        if (typeof startHeartbeat === 'function') startHeartbeat(); 
    }

    if (lobbyRoomsTimer) clearInterval(lobbyRoomsTimer);
    
    window._loreShownOnStart = false;
    showScreen('waiting');
    startSync();
}

async function addPlayerToRoom(status = 'approved') {
    const meta = currentUser.user_metadata;
    const { error } = await supabase.from('bunker_players').insert([{ 
        room_id: currentRoomId, 
        user_id: currentUser.id, 
        username: meta.full_name || meta.name || "Игрок", 
        avatar_url: meta.avatar_url || '../assets/avatar.png',
        join_status: status 
    }]);
    if (error && error.code !== '23505') {
        showError("Ошибка подключения.");
        return false;
    }
    return true;
}


function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    
    heartbeatInterval = setInterval(async () => {
        if (isHost && currentRoomId) {
            await supabase
                .from('bunker_rooms')
                .update({ last_active: new Date().toISOString() })
                .eq('id', currentRoomId);
        }
    }, 60000); 
}


function startSync() {
    
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    realtimeChannel = supabase.channel(`room:${currentRoomId}`)
        .on('presence', { event: 'sync' }, () => {
            const state = realtimeChannel.presenceState();
            currentPresenceIds = new Set();
            let specCount = 0;
            for (const key in state) {
                state[key].forEach(p => {
                    if (p.user_id) currentPresenceIds.add(p.user_id);
                    if (p.is_spectator) specCount++;
                });
            }
            const specDisplay = document.getElementById('spectator-count-display');
            if (specDisplay) {
                specDisplay.textContent = specCount;
                specDisplay.parentElement.style.display = specCount > 0 ? 'inline-flex' : 'none';
            }
            
            fetchGameState();
        })
        .on('postgres', { event: '*', schema: 'public', table: 'bunker_players', filter: `room_id=eq.${currentRoomId}` }, fetchGameState)
        .on('postgres', { event: 'UPDATE', schema: 'public', table: 'bunker_rooms', filter: `id=eq.${currentRoomId}` }, fetchGameState)
        .on('broadcast', { event: 'reaction' }, ({ payload }) => {
            if (window.spawnReaction && payload) {
                
                if (payload.senderId !== currentUser.id) {
                    window.spawnReaction(payload.targetId, payload.emoji, payload.senderName);
                }
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await realtimeChannel.track({ user_id: currentUser.id, is_spectator: isSpectator });
            }
        });

    
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(fetchGameState, 3000);
    
    fetchGameState(); 
}


async function fetchGameState() {
    
    if (!currentRoomId || screens.lobby.classList.contains('active')) return; 

    
    const { data: room } = await supabase.from('bunker_rooms').select('*').eq('id', currentRoomId).single();
    if (!room) return;

    
    const { data: allPlayers } = await supabase.from('bunker_players').select('*').eq('room_id', currentRoomId).order('created_at', { ascending: true });
    if (!allPlayers) return;

    
    const players = allPlayers.filter(p => p.join_status === 'approved');
    window.bunkerPlayersCache = players; 
    const pendingPlayers = allPlayers.filter(p => p.join_status === 'pending');

    
    const isHostPresent = players.some(p => p.user_id === room.host_id);

    if (!isHostPresent) {
        if (players.length > 0) {
            
            
            
            if (!isSpectator && !pendingPlayers.some(p => p.user_id === currentUser.id)) {
                console.log("Хост не найден, передаем корону первому игроку...");
                await supabase.from('bunker_rooms').update({ host_id: players[0].user_id }).eq('id', currentRoomId);
                return; 
            }
        } else {
            
            
            if (isSpectator) {
                clearInterval(syncInterval);
                showAlert("В этом бункере никого нет. Возвращаемся на радар.", () => {
                    window.location.reload();
                });
                return;
            }
        }
    }

    
    if (!isSpectator) {
        const wasHost = isHost;
        isHost = (room.host_id === currentUser.id);
        
        
        if (!wasHost && isHost) {
            if (room.status === 'waiting') document.getElementById('start-game-btn').style.display = 'block';
            if (typeof startHeartbeat === 'function') startHeartbeat();
            showAlert("Вы назначены новым Лидером бункера!");
        }
    } else {
        
        isHost = false;
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('start-vote-btn').style.display = 'none';
    }

    const amIHere = players.some(p => p.user_id === currentUser.id);
    const amIPending = pendingPlayers.some(p => p.user_id === currentUser.id);

    
    if (!amIHere && !amIPending && !isSpectator) {
        clearInterval(syncInterval);
        document.getElementById('join-pending-modal').classList.remove('active');
        showAlert("Доступ в комнату закрыт или заявка отклонена хостом.", () => {
            window.location.reload();
        });
        return;
    }

    
    if (amIPending && !isHost) {
        document.getElementById('join-pending-modal').classList.add('active');
        return; 
    } else {
        document.getElementById('join-pending-modal').classList.remove('active');
    }

    
    if (isHost) {
        const hostModal = document.getElementById('host-approval-modal');
        const requestsList = document.getElementById('approval-requests-list');
        
        if (pendingPlayers.length > 0) {
            if (!hostModal.classList.contains('active')) hostModal.classList.add('active');
            
            requestsList.innerHTML = pendingPlayers.map(p => `
                <div class="approval-item">
                    <div class="approval-info">
                        <img src="${p.avatar_url}">
                        <span>${p.username}</span>
                    </div>
                    <div class="approval-actions">
                        <button class="appr-btn appr-yes" onclick="window.approvePlayer('${p.id}')"><i class="fas fa-check"></i></button>
                        <button class="appr-btn appr-no" onclick="window.rejectPlayer('${p.id}')"><i class="fas fa-times"></i></button>
                    </div>
                </div>
            `).join('');
        } else {
            hostModal.classList.remove('active');
        }
    }

    
    renderPlayersList(players, room.host_id, room.status, currentUser.id, isHost, room.voting_active, currentPresenceIds);

    
    if (room.voting_active) {
        renderVoteOptions(players, currentUser.id, isHost, isSpectator);
        
        if (room.votes && room.votes.end_time) {
            if (window.currentVoteEndTime !== room.votes.end_time) {
                window.currentVoteEndTime = room.votes.end_time;
                updateVoteTimer(room.votes.end_time);
            }
            
            
            if (isHost && Date.now() >= room.votes.end_time) {
                const endBtn = document.getElementById('end-vote-btn');
                if (endBtn && !endBtn.disabled) {
                    endVotingProcess();
                }
            }
        }
    } else {
        window.currentVoteEndTime = null;
        stopVoteTimer();
    }

    
    const loreTextEl = document.getElementById('game-lore-text');
    const voiceBtn = document.getElementById('voice-lore-btn');
    if (loreTextEl) {
        if (room.lore) {
            loreTextEl.textContent = room.lore;
            if (voiceBtn) {
                if (isHost && !room.lore.startsWith("[БЕТА-ПРОТОКОЛ")) {
                    voiceBtn.style.display = 'block';
                } else {
                    voiceBtn.style.display = 'none';
                }
            }
        } else {
            loreTextEl.textContent = "Лор не выбран. Видимо, это классический бункер!";
            if (voiceBtn) voiceBtn.style.display = 'none';
        }
    }

    if (room.status === 'playing') {
        if (screens.waiting.classList.contains('active')) {
            showScreen('game');
            if (isSpectator) {
                myCardsContainer.innerHTML = '<div style="color: #fbbf24; font-family: var(--font-pixel); font-size: 0.8rem; text-align: center; margin: 20px 0; border: 1px dashed #fbbf24; padding: 15px;">РЕЖИМ НАБЛЮДАТЕЛЯ.<br><br>ВЫ НЕ УЧАСТВУЕТЕ В ИГРЕ, ПРОСТО НАСЛАЖДАЙТЕСЬ ШОУ! 🍿</div>';
            }
            
            
            if (!window._loreShownOnStart) {
                window._loreShownOnStart = true;
                setTimeout(() => {
                    document.getElementById('lore-modal').classList.add('active');
                }, 100);
            }

            if (!isSpectator) {
                setTimeout(startTutorial, 1500); 
            }
        }

        
        if (!isSpectator) {
            renderMyCards(players, currentUser.id);
        }


        
        if (isHost) {
            document.getElementById('start-vote-btn').style.display = room.voting_active ? 'none' : 'block';
            document.getElementById('end-vote-btn').style.display = room.voting_active ? 'block' : 'none';
        }
    }

    if (room.status === 'finished') {
        const gameOverModal = document.getElementById('game-over-modal');
        
        
        if (!gameOverModal.classList.contains('active')) {
            window.playBunkerSFX('survive');
        }
        
        const winnerMsg = document.getElementById('winner-msg');
        
        
        const survivors = players.filter(p => p.is_alive).map(p => p.username).join(', ');
        
        if (survivors.length > 0) {
            winnerMsg.textContent = `МЕСТО В БУНКЕРЕ ЗАСЛУЖИЛ(И): ${survivors}`;
        } else {
            winnerMsg.textContent = `ВСЕ ПОГИБЛИ. БУНКЕР ПУСТ.`;
        }

        gameOverModal.classList.add('active');

        
        if (isHost) {
            document.getElementById('restart-room-btn').style.display = 'block';
        }
    } else {
        document.getElementById('game-over-modal').classList.remove('active');
    }
}




window.leaveRoom = function() {
    
    const gameOverModal = document.getElementById('game-over-modal');
    if (gameOverModal) gameOverModal.classList.remove('active');

    showConfirm("Вы уверены, что хотите покинуть бункер?", async () => {
        const roomIdToDelete = currentRoomId; 
        
        
        const { data: roomData } = await supabase.from('bunker_rooms').select('status').eq('id', roomIdToDelete).single();
        const isGamePlaying = roomData && roomData.status === 'playing';

        if (!isSpectator && currentUser && roomIdToDelete) {
            
            
            if (isGamePlaying) {
                console.log("Игра в процессе, сохраняем запись для возможности возврата.");
            } else {
                
                if (isHost) {
                    const { data: nextPlayers } = await supabase
                        .from('bunker_players')
                        .select('user_id')
                        .eq('room_id', roomIdToDelete)
                        .eq('join_status', 'approved')
                        .neq('user_id', currentUser.id)
                        .order('created_at', { ascending: true })
                        .limit(1);

                    if (nextPlayers && nextPlayers.length > 0) {
                        const newHostId = nextPlayers[0].user_id;
                        await supabase.from('bunker_rooms').update({ host_id: newHostId }).eq('id', roomIdToDelete);
                    } else {
                        await supabase.from('bunker_rooms').delete().eq('id', roomIdToDelete);
                    }
                }

                await supabase.from('bunker_players').delete().eq('user_id', currentUser.id).eq('room_id', roomIdToDelete);

                if (!isHost) {
                    const { data: remPlayers } = await supabase.from('bunker_players').select('id').eq('room_id', roomIdToDelete);
                    if (!remPlayers || remPlayers.length === 0) {
                        await supabase.from('bunker_rooms').delete().eq('id', roomIdToDelete);
                    }
                }
            }
        }

        
        if (syncInterval) clearInterval(syncInterval);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (window.disconnectChat) window.disconnectChat();

        currentRoomId = null;
        currentRoomCode = null;
        isHost = false;
        isSpectator = false;

        showScreen('lobby');
        loadPublicRooms();
        lobbyRoomsTimer = setInterval(loadPublicRooms, 5000);
        
        
        checkExistingRoom();
    });
};




async function checkExistingRoom() {
    const reconnectBtn = document.getElementById('reconnect-room-btn');
    if (reconnectBtn) {
        reconnectBtn.style.display = 'none';
        const newBtn = reconnectBtn.cloneNode(true);
        reconnectBtn.parentNode.replaceChild(newBtn, reconnectBtn);
    }

    if (!currentUser) return;

    
    const { data: players, error: pError } = await supabase
        .from('bunker_players')
        .select('room_id, join_status')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(1);

    if (pError) console.error("Ошибка поиска игрока:", pError);
    const player = players && players.length > 0 ? players[0] : null;

    if (player && player.room_id) {
        
        const { data: room, error: rError } = await supabase
            .from('bunker_rooms')
            .select('*')
            .eq('id', player.room_id)
            .maybeSingle();

        if (rError) console.error("Ошибка поиска комнаты:", rError);

        if (room && (room.status === 'waiting' || room.status === 'playing')) {
            console.log(`Найдена активная комната для возврата: #${room.room_code} (Статус: ${room.status})`);
            
            
            if (screens.lobby.classList.contains('active')) {
                const btn = document.getElementById('reconnect-room-btn');
                if (btn) {
                    btn.style.display = 'block';
                    btn.innerHTML = `<i class="fas fa-undo"></i> ВЕРНУТЬСЯ В БУНКЕР #${room.room_code}`;
                    btn.onclick = () => {
                        console.log("Реконнект через кнопку...");
                        currentRoomId = room.id;
                        currentRoomCode = room.room_code;
                        isHost = (room.host_id === currentUser.id);
                        isSpectator = false; 

                        document.getElementById('current-room-code').textContent = room.room_code;
                        if (lobbyRoomsTimer) clearInterval(lobbyRoomsTimer);

                        if (isHost && room.status === 'waiting') {
                            document.getElementById('start-game-btn').style.display = 'block';
                        }
                        if (isHost) startHeartbeat();

                        showScreen('waiting');
                        startSync();
                    };
                }
                return;
            }

            
            currentRoomId = room.id;
            currentRoomCode = room.room_code;
            isHost = (room.host_id === currentUser.id);
            isSpectator = false; 

            document.getElementById('current-room-code').textContent = room.room_code;
            if (lobbyRoomsTimer) clearInterval(lobbyRoomsTimer);

            if (isHost && room.status === 'waiting') {
                document.getElementById('start-game-btn').style.display = 'block';
            }
            if (isHost) startHeartbeat();

            showScreen('waiting');
            startSync(); 
        } else if (player.room_id) {
            
            console.log("Чистка устаревшей записи игрока...");
            await supabase.from('bunker_players').delete().eq('user_id', currentUser.id).eq('room_id', player.room_id);
        }
    }
}


window.kickPlayer = function(playerId) {
    if (!isHost) return;
    
    showConfirm("Точно выгнать этого игрока из лобби?", async () => {
        
        const { error } = await supabase
            .from('bunker_players')
            .delete()
            .eq('id', playerId);

        if (error) {
            showError("Ошибка при удалении игрока.");
            console.error(error);
        }
    });
};


async function startGame() {
    if (!isHost) return;
    startGameBtn.disabled = true;
    startGameBtn.textContent = "ГЕНЕРАЦИЯ...";

    
    const { data: players } = await supabase.from('bunker_players').select('id').eq('room_id', currentRoomId);
    
    
    
    for (const player of players) {
        const generatedCards = {
            profession: getRandomItem(BUNKER_DATA.professions),
            health: getRandomItem(BUNKER_DATA.health),
            biology: getRandomItem(BUNKER_DATA.biology),
            hobby: getRandomItem(BUNKER_DATA.hobbies),
            phobia: getRandomItem(BUNKER_DATA.phobias),
            baggage: getRandomItem(BUNKER_DATA.baggage),
            fact: getRandomItem(BUNKER_DATA.facts),
            special1: getRandomItem(BUNKER_DATA.specials)
        };

        
        await supabase.from('bunker_players')
            .update({ 
                cards: generatedCards, 
                revealed_cards: [], 
                has_immunity: false, 
                is_alive: true, 
                voted_for_id: null 
            })
            .eq('id', player.id);
    }

    
    await supabase.from('bunker_rooms').update({ status: 'playing' }).eq('id', currentRoomId);
    window.playBunkerSFX('start');
    if (window.usedSpecials) window.usedSpecials.clear();
}









let voteTimerInterval = null;

function updateVoteTimer(endTime) {
    if (voteTimerInterval) clearInterval(voteTimerInterval);
    
    voteTimerInterval = setInterval(() => {
        const remain = Math.max(0, endTime - Date.now());
        const secs = Math.ceil(remain / 1000);
        
        const timerEl = document.getElementById('vote-timer-display');
        if (timerEl) {
            timerEl.textContent = `00:${secs < 10 ? '0' + secs : secs}`;
        }
        
        if (remain <= 0) {
            clearInterval(voteTimerInterval);
            if (isHost && !document.getElementById('end-vote-btn').disabled) {
                
                endVotingProcess();
            }
        }
    }, 100);
}

function stopVoteTimer() {
    if (voteTimerInterval) {
        clearInterval(voteTimerInterval);
        voteTimerInterval = null;
    }
}





async function startVotingProcess() {
    if (!isHost) return;
    try {
        
        await supabase.from('bunker_players')
            .update({ voted_for_id: null })
            .eq('room_id', currentRoomId);
            
        
        await supabase.from('bunker_rooms')
            .update({ voting_active: true, votes: { end_time: Date.now() + 60000 } })
            .eq('id', currentRoomId);
            
        window.playBunkerSFX('alarm');
            
        
        fetchGameState();
    } catch (e) {
        console.error("Ошибка старта голосования:", e);
        showAlert("Не удалось начать голосование.");
    }
}

async function endVotingProcess() {
    if (!isHost) return;

    const btn = document.getElementById('end-vote-btn');
    btn.disabled = true;
    btn.textContent = "ПОДСЧЕТ...";

    try {
        
        const { data: allPlayers, error: pError } = await supabase
            .from('bunker_players')
            .select('user_id, voted_for_id, is_alive, username, join_status, cards, has_immunity')
            .eq('room_id', currentRoomId)
            .eq('join_status', 'approved'); 

        if (pError) throw pError;

        
        const counts = {};
        const effects = {};
        allPlayers.forEach(p => {
            effects[p.user_id] = p.cards?.temp_effects || {};
        });

        allPlayers.forEach(p => {
            if (p.voted_for_id) {
                
                if (effects[p.user_id].silenced) return;

                
                const multiplier = effects[p.user_id].vote_multiplier || 1;
                let targetId = p.voted_for_id;

                
                
                if (effects[targetId].transfer_votes_to) {
                    targetId = effects[targetId].transfer_votes_to;
                }

                counts[targetId] = (counts[targetId] || 0) + multiplier;
            }
        });

        
        document.getElementById('vote-modal').classList.remove('active');

        const activeTargets = Object.keys(counts);
        if (activeTargets.length > 0) {
            
            let loserId = activeTargets.reduce((a, b) => counts[a] > counts[b] ? a : b);
            const loserName = allPlayers.find(p => p.user_id === loserId)?.username || "Игрок";
            
            
            const loserObj = allPlayers.find(p => p.user_id === loserId);
            if (loserObj && loserObj.has_immunity) {
                
                await supabase.from('bunker_players')
                    .update({ has_immunity: false })
                    .eq('user_id', loserId)
                    .eq('room_id', currentRoomId);
                
                showAlert(`🛡️ ${loserName} был под защитой! Щит сломан, но игрок остается в бункере.`);
                
                await supabase.from('bunker_rooms').update({ 
                    voting_active: false 
                }).eq('id', currentRoomId);
            } else {
                
                await supabase.from('bunker_players')
                    .update({ is_alive: false })
                    .eq('user_id', loserId)
                    .eq('room_id', currentRoomId);
                
                window.playBunkerSFX('kick');
                
                const aliveCount = allPlayers.filter(p => p.is_alive && p.user_id !== loserId).length;
                const newStatus = aliveCount <= 1 ? 'finished' : 'playing';
                
                await supabase.from('bunker_rooms').update({ 
                    status: newStatus, 
                    voting_active: false 
                }).eq('id', currentRoomId);

                showAlert(`Голосование завершено! ${loserName} изгнан из бункера.`);
            }
        } else {
            await supabase.from('bunker_rooms').update({ 
                voting_active: false 
            }).eq('id', currentRoomId);
            showAlert("Никто не проголосовал (или все голоса аннулированы). Все остаются.");
        }

        
        for (const p of allPlayers) {
            if (p.cards?.temp_effects) {
                const updatedCards = { ...p.cards };
                delete updatedCards.temp_effects;
                await supabase.from('bunker_players').update({ cards: updatedCards }).eq('user_id', p.user_id).eq('room_id', currentRoomId);
            }
        }

    } catch (err) {
        console.error("Критическая ошибка завершения:", err);
        showAlert("Ошибка при завершении голосования.");
    } finally {
        btn.disabled = false;
        btn.textContent = "ЗАВЕРШИТЬ ГОЛОСОВАНИЕ";
        fetchGameState();
    }
}


window.castVote = async function(targetUserId) {
    if (isSpectator) return;
    const { error } = await supabase
        .from('bunker_players')
        .update({ voted_for_id: targetUserId })
        .eq('user_id', currentUser.id)
        .eq('room_id', currentRoomId);
    
    if (!error) fetchGameState();
};




window.animateAndReveal = function(cardKey, cardValue, cardElement) {
    showConfirm(`Открыть характеристику "${cardKey}" для всех игроков? Это запустит её в центр стола!`, async () => {
        
        
        cardElement.classList.add('revealed');
        cardElement.style.pointerEvents = 'none';
        cardElement.style.cursor = 'not-allowed';
        

        const overlay = document.getElementById('card-animation-overlay');
        const cardRect = cardElement.getBoundingClientRect();
        
        
        const animCard = document.createElement('div');
        animCard.className = 'animating-card';
        
        const keyEl = cardElement.querySelector('.card-key');
        
        animCard.innerHTML = `
            <div class="card-trail"></div>
            <div class="bunker-card ${cardElement.classList.value}" style="transform:none!important; width:100%;">
                <div class="card-key">${keyEl.innerHTML}</div>
                <div class="card-value">${cardValue}</div>
            </div>
        `;
        
        animCard.style.top = `${cardRect.top}px`;
        animCard.style.left = `${cardRect.left}px`;
        overlay.appendChild(animCard);

        const tableCenter = document.getElementById('game-players-list').getBoundingClientRect();
        const targetX = (tableCenter.left + tableCenter.width / 2) - (cardRect.left + cardRect.width / 2);
        const targetY = (tableCenter.top + tableCenter.height / 2) - (cardRect.top + cardRect.height / 2);

        let animStyleTag = document.getElementById('dynamic-card-anim');
        if (!animStyleTag) {
            animStyleTag = document.createElement('style');
            animStyleTag.id = 'dynamic-card-anim';
            document.head.appendChild(animStyleTag);
        }
        
        animStyleTag.innerHTML = `
            @keyframes throwCardDynamic {
                0% { transform: translate(0px, 0px) rotate(0deg) scale(1); opacity: 1; }
                30% { transform: translate(${targetX * 0.1}px, ${targetY - 100}px) rotate(180deg) scale(1.1); }
                100% { transform: translate(${targetX}px, ${targetY}px) rotate(720deg) scale(0.1); opacity: 0; }
            }
        `;

        animCard.style.animation = 'throwCardDynamic 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';

        window.playBunkerSFX('card');

        
        const { data: me } = await supabase.from('bunker_players').select('revealed_cards').eq('user_id', currentUser.id).eq('room_id', currentRoomId).single();
        let revealed = me.revealed_cards || [];
        
        if (!revealed.some(r => r.key.toLowerCase() === cardKey.toLowerCase())) {
            revealed.push({ key: cardKey, value: cardValue });
            await supabase.from('bunker_players').update({ revealed_cards: revealed }).eq('user_id', currentUser.id).eq('room_id', currentRoomId);
        } else {
            console.log('[REVEAL] Characteristic already revealed, skipping...');
        }

        
        setTimeout(() => { 
            animCard.remove(); 
            fetchGameState(); 
        }, 1200);
    }, 'bunker_skip_reveal_confirm');
};


window.approvePlayer = async function(playerId) {
    await supabase.from('bunker_players').update({ join_status: 'approved' }).eq('id', playerId);
    fetchGameState(); 
};

window.rejectPlayer = async function(playerId) {
    await supabase.from('bunker_players').delete().eq('id', playerId);
    fetchGameState();
};




const bunkerTracks = [
    new Audio('../assets/bunker-bg1.mp3'),
    new Audio('../assets/bunker-bg2.mp3')
];

let currentTrackIndex = 0;
let isBunkerMuted = localStorage.getItem('bunker_muted') === 'true';

function initBunkerMusic() {
    const muteBtn = document.getElementById('bunker-mute-btn');
    if (!muteBtn) return;
    
    const icon = muteBtn.querySelector('i');

    
    bunkerTracks.forEach(track => {
        track.volume = 0.05; 
        track.addEventListener('ended', playNextTrack);
    });

    function playNextTrack() {
        currentTrackIndex = (currentTrackIndex + 1) % bunkerTracks.length;
        if (!isBunkerMuted) {
            bunkerTracks[currentTrackIndex].play().catch(() => {});
        }
    }

    function updateMusicUI() {
        if (isBunkerMuted) {
            icon.className = 'fas fa-volume-mute';
            muteBtn.style.color = '#ef4444';
            muteBtn.style.borderColor = '#ef4444';
            bunkerTracks[currentTrackIndex].pause();
        } else {
            icon.className = 'fas fa-music';
            muteBtn.style.color = '#10b981';
            muteBtn.style.borderColor = '#10b981';
            bunkerTracks[currentTrackIndex].play().catch(() => {});
        }
    }

    
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isBunkerMuted = !isBunkerMuted;
        localStorage.setItem('bunker_muted', isBunkerMuted);
        updateMusicUI();
    });

    
    const unlockAudio = () => {
        if (!isBunkerMuted) {
            bunkerTracks[currentTrackIndex].play().catch(() => {});
        }
        document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);

    updateMusicUI();
}


initBunkerMusic();




window.isExecutingSpecial = false;
window.pendingSpecialAction = null;
window.usedSpecials = new Set();

window.activateSpecial = async function(specialKey, specialId) {
    console.log('[SPECIAL] activateSpecial called:', specialKey, specialId, 'isExecuting:', window.isExecutingSpecial, 'used:', [...window.usedSpecials]);
    
    if (window.isExecutingSpecial) {
        console.log('[SPECIAL] BLOCKED: isExecutingSpecial is true');
        return;
    }
    if (window.usedSpecials.has(specialKey)) {
        showError("⛔ Эта спецуха уже использована!", 2000);
        return;
    }
    
    
    if (window.pendingSpecialAction) {
        console.log('[SPECIAL] Cancelling pending action');
        highlightSpecialCard(window.pendingSpecialAction.key, false); 
        window.pendingSpecialAction = null;
        showError("Применение отменено.", 1500);
        fetchGameState();
        return;
    }

    
    const specData = window.BUNKER_DATA_REF ? window.BUNKER_DATA_REF.specials.find(s => s.id === specialId) : null;
    const needsTarget = specData ? specData.targetRequired : true;
    const specialText = specData ? specData.text : specialId;

    if (needsTarget) {
        window.pendingSpecialAction = { key: specialKey, id: specialId, value: specialText, targetRequired: true };
        highlightSpecialCard(specialKey, true); 
        showError("🎯 ВЫБЕРИТЕ ИГРОКА ЗА СТОЛОМ", 2000);
        fetchGameState();
    } else {
        window.pendingSpecialAction = { key: specialKey, id: specialId, value: specialText, targetRequired: false };
        await window.executeSpecialAction(currentUser.id);
    }
};

window.executeSpecialAction = async function(targetId) {
    console.log('[SPECIAL] executeSpecialAction called, target:', targetId, 'isExecuting:', window.isExecutingSpecial);
    
    if (window.isExecutingSpecial) {
        console.log('[SPECIAL] BLOCKED: already executing');
        return;
    }
    
    const action = window.pendingSpecialAction;
    if (!action || !action.id) {
        console.log('[SPECIAL] BLOCKED: no pending action');
        return;
    }

    
    window.isExecutingSpecial = true;
    const { key, id, value } = action;
    window.pendingSpecialAction = null;
    window.usedSpecials.add(key);
    highlightSpecialCard(key, false); 
    console.log('[SPECIAL] Executing:', id, 'key:', key, 'usedSpecials now:', [...window.usedSpecials]);

    try {
        showError("⚡ ПРИМЕНЕНИЕ КОЗЫРЯ...", 2000);

        
        const { data: freshTargetArr } = await supabase.from('bunker_players').select('*').eq('user_id', targetId).eq('room_id', currentRoomId);
        const targetUserObj = freshTargetArr && freshTargetArr[0] ? freshTargetArr[0] : null;
        if (!targetUserObj) {
            console.error('[SPECIAL] Target not found:', targetId);
            return;
        }

        const { data: meObj } = await supabase.from('bunker_players').select('revealed_cards, cards').eq('user_id', currentUser.id).eq('room_id', currentRoomId).single();
        if (!meObj) {
            console.error('[SPECIAL] Self not found');
            return;
        }

        
        const labelToReveal = 'Спецуха';
        let currentRevealed = meObj.revealed_cards || [];
        
        if (!currentRevealed.some(r => r.key === labelToReveal)) {
            currentRevealed.push({ key: labelToReveal, value: value });
            await supabase.from('bunker_players').update({ revealed_cards: currentRevealed }).eq('user_id', currentUser.id).eq('room_id', currentRoomId);
        }

        let effectMessage = "";
        const tCards = targetUserObj.cards;
        
        if (id === 'HEAL') {
            tCards.health = "Идеально здоров (Вылечен)";
            await updateTargetCardsAndRevealed(targetId, tCards, targetUserObj.revealed_cards, 'Здоровье', tCards.health, true);
            effectMessage = `⚕️ ВЫЛЕЧИЛ ${targetUserObj.username}!`;
        } 
        else if (id === 'REROLL_PROF') {
            tCards.profession = window.BUNKER_DATA_REF ? window.getRandomItemRef(window.BUNKER_DATA_REF.professions) : "Случайная Профессия";
            await updateTargetCardsAndRevealed(targetId, tCards, targetUserObj.revealed_cards, 'Профессия', tCards.profession, true);
            effectMessage = `🔄 СМЕНИЛ ПРОФЕССИЮ ${targetUserObj.username}!`;
        }
        else if (id === 'IMMUNITY') {
            await supabase.from('bunker_players').update({ has_immunity: true }).eq('user_id', currentUser.id).eq('room_id', currentRoomId);
            effectMessage = `🛡️ АБСОЛЮТНЫЙ ИММУНИТЕТ АКТИВИРОВАН!`;
        }
        else if (id === 'STEAL_BAGGAGE') {
            const myCards = meObj.cards;
            const stolenItem = tCards.baggage;
            tCards.baggage = "Украден / Пусто";
            myCards.baggage = stolenItem;
            await updateTargetCardsAndRevealed(targetId, tCards, targetUserObj.revealed_cards, 'Багаж', "Украден / Пусто", true);
            await updateTargetCardsAndRevealed(currentUser.id, myCards, currentRevealed, 'Багаж', stolenItem, false);
            effectMessage = `🧤 УКРАЛ БАГАЖ у ${targetUserObj.username}!`;
        }
        else if (id === 'SABOTAGE') {
            tCards.baggage = "Уничтожено саботерами";
            await updateTargetCardsAndRevealed(targetId, tCards, targetUserObj.revealed_cards, 'Багаж', "Уничтожено саботерами", true);
            effectMessage = `💣 УНИЧТОЖИЛ БАГАЖ ${targetUserObj.username}!`;
        }
        else if (id === 'VETO') {
            if (isHost) {
                endVotingProcess();
            } else {
                await supabase.from('bunker_rooms').update({ voting_active: false }).eq('id', currentRoomId);
            }
            effectMessage = `✋ ПРАВО ВЕТО! Голосование отменено.`;
        }
        else if (id === 'HEAL_PHOBIA') {
            tCards.phobia = "Нет фобий (Инкапсулирована)";
            await updateTargetCardsAndRevealed(targetId, tCards, targetUserObj.revealed_cards, 'Фобия', tCards.phobia, true);
            effectMessage = `🧠 ИЗЛЕЧИЛ ФОБИЮ у ${targetUserObj.username}!`;
        }
        else if (id === 'REVEAL_SPECIFIC' || id === 'REVEAL_ANY') {
            const targetRevealed = targetUserObj.revealed_cards || [];
            const keyMap = {
                'profession': 'Профессия', 'biology': 'Биология', 'health': 'Здоровье',
                'hobby': 'Хобби', 'phobia': 'Фобия', 'baggage': 'Багаж', 'fact': 'Факт'
            };
            const unrevealedKeys = Object.keys(keyMap).filter(k => {
                const rusLabel = keyMap[k];
                return !targetRevealed.some(r => r.key.toLowerCase() === rusLabel.toLowerCase());
            });
            if (unrevealedKeys.length > 0) {
                const kToReveal = unrevealedKeys[Math.floor(Math.random() * unrevealedKeys.length)];
                const val = tCards[kToReveal];
                const rusLabel = keyMap[kToReveal];
                targetRevealed.push({ key: rusLabel, value: val });
                await supabase.from('bunker_players').update({ revealed_cards: targetRevealed }).eq('user_id', targetId).eq('room_id', currentRoomId);
                effectMessage = `🕵️ ДЕТЕКТИВ! Вскрыта карта (${rusLabel}) у ${targetUserObj.username}!`;
            } else {
                effectMessage = `🕵️ У ${targetUserObj.username} уже вскрыто всё!`;
            }
        }
        else if (id === 'SWAP_HIDDEN') {
            const myCards = meObj.cards;
            const categories = ['profession', 'health', 'hobby', 'phobia', 'baggage', 'fact'];
            const cat = categories[Math.floor(Math.random() * categories.length)];
            const keyMap = { 'profession': 'Профессия', 'health': 'Здоровье', 'hobby': 'Хобби', 'phobia': 'Фобия', 'baggage': 'Багаж', 'fact': 'Факт' };
            
            const myVal = myCards[cat];
            const targetVal = tCards[cat];
            
            myCards[cat] = targetVal;
            tCards[cat] = myVal;
            
            
            await updateTargetCardsAndRevealed(targetId, tCards, targetUserObj.revealed_cards, keyMap[cat], targetVal, false);
            await updateTargetCardsAndRevealed(currentUser.id, myCards, currentRevealed, keyMap[cat], myVal, false);
            
            effectMessage = `🔃 ОБМЕН! Вы поменялись [${keyMap[cat]}] с ${targetUserObj.username}!`;
        }
        else if (id === 'DOUBLE_VOTE') {
            const myCards = meObj.cards;
            myCards.temp_effects = { ...(myCards.temp_effects || {}), vote_multiplier: 2 };
            await supabase.from('bunker_players').update({ cards: myCards }).eq('user_id', currentUser.id).eq('room_id', currentRoomId);
            effectMessage = `🗳️ ВАШ ГОЛОС ТЕПЕРЬ ДВОЙНОЙ!`;
        }
        else if (id === 'SILENCE') {
            const tCards = targetUserObj.cards;
            tCards.temp_effects = { ...(tCards.temp_effects || {}), silenced: true };
            await supabase.from('bunker_players').update({ cards: tCards }).eq('user_id', targetId).eq('room_id', currentRoomId);
            effectMessage = `🤐 ИГРОК ${targetUserObj.username} ЗАМОЛЧАЛ! (Не может голосовать)`;
        }
        else if (id === 'TRANSFER_VOTES') {
            const myCards = meObj.cards;
            myCards.temp_effects = { ...(myCards.temp_effects || {}), transfer_votes_to: targetId };
            await supabase.from('bunker_players').update({ cards: myCards }).eq('user_id', currentUser.id).eq('room_id', currentRoomId);
            effectMessage = `🔄 ПЕРЕВОД ГОЛОСОВ! Все голоса против вас перейдут к ${targetUserObj.username}!`;
        }
        else if (id === 'XRAY') {
            const targetCards = targetUserObj.cards;
            const targetRevealed = targetUserObj.revealed_cards || [];
            const keyMap = { 'profession': 'Профессия', 'biology': 'Биология', 'health': 'Здоровье', 'hobby': 'Хобби', 'phobia': 'Фобия', 'baggage': 'Багаж', 'fact': 'Факт' };
            const unrevealedKeys = Object.keys(keyMap).filter(k => !targetRevealed.some(r => r.key === keyMap[k]));
            if (unrevealedKeys.length > 0) {
                const k = unrevealedKeys[Math.floor(Math.random() * unrevealedKeys.length)];
                const val = targetCards[k];
                const msg = `🦴 РЕНТГЕН: Вы узнали тайную характеристику ${targetUserObj.username} [${keyMap[k]}]: ${val}`;
                showAlert(msg); 
                effectMessage = `🦴 РЕНТГЕН ПРОВЕДЕН! Информация только у вас в руках.`;
            } else {
                effectMessage = `🦴 У ${targetUserObj.username} все карты уже вскрыты!`;
            }
        }
        else {
            effectMessage = `Спецуха (${id}) активирована!`;
        }

        if (effectMessage) {
            window.playBunkerSFX('alarm');
            showAlert(effectMessage);
        }
        
        console.log('[SPECIAL] Effect done:', effectMessage);
        
    } catch (err) {
        console.error('[SPECIAL] ERROR during execution:', err);
        showError("Ошибка при применении спецухи!", 3000);
    } finally {
        window.isExecutingSpecial = false;
        console.log('[SPECIAL] Lock released. isExecuting:', window.isExecutingSpecial, 'usedSpecials:', [...window.usedSpecials]);
        
        
        markUsedSpecialsInDOM();
        fetchGameState();
    }
};


function markUsedSpecialsInDOM() {
    const container = document.getElementById('my-cards');
    if (!container) return;
    
    container.querySelectorAll('.bunker-card.type-special').forEach(card => {
        const keyEl = card.querySelector('.card-key');
        if (!keyEl) return;
        
        const text = keyEl.textContent.trim();
        const isSpecialLabel = text.includes('Спецуха');
        const specialKey = isSpecialLabel ? 'special1' : null;
        
        if (specialKey && window.usedSpecials.has(specialKey)) {
            
            card.classList.add('revealed');
            card.setAttribute('onclick', '');
            card.style.pointerEvents = 'none';
            
            
            const hint = card.querySelector('.card-action-hint');
            if (hint) hint.remove();
            
            
            if (!card.querySelector('.card-used-badge')) {
                const badge = document.createElement('div');
                badge.className = 'card-used-badge';
                badge.textContent = 'ИСПОЛЬЗОВАНО ✓';
                card.appendChild(badge);
            }
        }
    });
}
window.markUsedSpecialsInDOM = markUsedSpecialsInDOM;


function highlightSpecialCard(specialKey, on) {
    const label = 'Спецуха';
    const container = document.getElementById('my-cards');
    if (!container) return;
    
    container.querySelectorAll('.bunker-card.type-special').forEach(card => {
        const keyEl = card.querySelector('.card-key');
        if (keyEl && keyEl.textContent.includes(label)) {
            if (on) {
                card.classList.add('special-active');
            } else {
                card.classList.remove('special-active');
            }
        }
    });
}


async function updateTargetCardsAndRevealed(userId, newCardsObj, revealedCardsArr, keyLabelToBust, newValueStr, forceReveal = false) {
    const arr = revealedCardsArr || [];
    const idx = arr.findIndex(r => r.key.toLowerCase() === keyLabelToBust.toLowerCase());
    if (idx !== -1) {
        arr[idx].value = newValueStr;
    } else if (forceReveal) {
        
        arr.push({ key: keyLabelToBust, value: newValueStr });
    }
    
    await supabase.from('bunker_players').update({ 
        cards: newCardsObj, 
        revealed_cards: arr 
    }).eq('user_id', userId).eq('room_id', currentRoomId);
}




const BUNKER_SFX = {
    start: new Audio('../assets/bunker-start.wav'),
    card: new Audio('../assets/card-throw.wav'),
    alarm: new Audio('../assets/alarm.wav'),
    kick: new Audio('../assets/kick.wav'),
    survive: new Audio('../assets/survive.wav')
};


let bunkerSfxVolume = localStorage.getItem('bunker_sfx_vol') !== null 
    ? parseFloat(localStorage.getItem('bunker_sfx_vol')) 
    : 0.1;


function updateSfxVolume(vol) {
    bunkerSfxVolume = vol;
    Object.values(BUNKER_SFX).forEach(audio => audio.volume = bunkerSfxVolume);
    localStorage.setItem('bunker_sfx_vol', bunkerSfxVolume);
}


function initSfxMixer() {
    updateSfxVolume(bunkerSfxVolume); 
    
    const sfxSlider = document.getElementById('bunker-sfx-slider');
    const sfxIcon = document.getElementById('sfx-icon');
    
    if (sfxSlider) {
        sfxSlider.value = bunkerSfxVolume;
        
        
        const sfxVolVal = document.getElementById('sfx-vol-val');
        if (sfxVolVal) sfxVolVal.textContent = Math.round(bunkerSfxVolume * 100) + '%';
        
        if (bunkerSfxVolume === 0) {
            sfxIcon.className = 'fas fa-volume-mute';
            sfxIcon.style.color = '#ef4444';
        }
        
        
        sfxSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            updateSfxVolume(val);
            
            
            const sfxVolVal = document.getElementById('sfx-vol-val');
            if (sfxVolVal) sfxVolVal.textContent = Math.round(val * 100) + '%';

            if (val === 0) {
                sfxIcon.className = 'fas fa-volume-mute';
                sfxIcon.style.color = '#ef4444';
            } else {
                sfxIcon.className = 'fas fa-volume-up';
                sfxIcon.style.color = '#10b981';
            }
        });
    }
}


window.playBunkerSFX = function(name) {
    if (BUNKER_SFX[name] && bunkerSfxVolume > 0) {
        const sound = BUNKER_SFX[name].cloneNode();
        sound.volume = bunkerSfxVolume;
        sound.play().catch(() => {});
    }
};


initSfxMixer();




let bunkerMusicVolume = localStorage.getItem('bunker_music_vol') !== null 
    ? parseFloat(localStorage.getItem('bunker_music_vol')) 
    : 0.1;

let isMusicMuted = localStorage.getItem('bunker_music_muted') === 'true';
const bunkerMusic = new Audio('../assets/bunker-bg-music.mp3');
bunkerMusic.loop = true;

function updateMusicVolume() {
    if (isMusicMuted) {
        bunkerMusic.volume = 0;
    } else {
        bunkerMusic.volume = bunkerMusicVolume;
    }
    localStorage.setItem('bunker_music_vol', bunkerMusicVolume);
    localStorage.setItem('bunker_music_muted', isMusicMuted);
}

function initMusicMixer() {
    const musicSlider = document.getElementById('bunker-music-slider');
    const muteBtn = document.getElementById('bunker-mute-btn');
    const musicIcon = document.getElementById('music-icon');

    if (musicSlider) {
        musicSlider.value = bunkerMusicVolume;
        musicSlider.addEventListener('input', (e) => {
            bunkerMusicVolume = parseFloat(e.target.value);
            if (bunkerMusicVolume > 0) isMusicMuted = false;
            updateMusicVolume();
            syncMusicUI();
            
            const musicVolVal = document.getElementById('music-vol-val');
            if (musicVolVal) musicVolVal.textContent = Math.round(bunkerMusicVolume * 100) + '%';
        });
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            isMusicMuted = !isMusicMuted;
            
            bunkerMusic.play().catch(() => {});
            updateMusicVolume();
            syncMusicUI();
        });
    }

    function syncMusicUI() {
        if (!muteBtn || !musicIcon) return;
        if (isMusicMuted || bunkerMusicVolume === 0) {
            muteBtn.innerHTML = '<i class="fas fa-play"></i>'; 
            muteBtn.style.color = '#ef4444';
            musicIcon.className = 'fas fa-volume-mute';
            musicIcon.style.color = '#ef4444';
        } else {
            muteBtn.innerHTML = '<i class="fas fa-pause"></i>'; 
            muteBtn.style.color = '#8b5cf6';
            musicIcon.className = 'fas fa-music';
            musicIcon.style.color = '#8b5cf6';
        }

        const musicVolVal = document.getElementById('music-vol-val');
        if (musicVolVal) {
            musicVolVal.textContent = Math.round(bunkerMusicVolume * 100) + '%';
        }
    }

    
    updateMusicVolume();
    syncMusicUI();
    
    
    const firstInteraction = () => {
        bunkerMusic.play().catch(() => {});
        document.removeEventListener('click', firstInteraction);
    };
    document.addEventListener('click', firstInteraction);
}

initMusicMixer();


window.playLoreAudio = function() {
    if (!isHost) return;
    
    
    

    showError("Файлы озвучки в разработке! (SOON)", 3000);
};


window.toggleReactionPicker = function(targetId, btn) {
    const existing = document.querySelector('.emoji-picker');
    if (existing) {
        const isSame = existing._btn === btn;
        existing.remove();
        if (isSame) return;
    }

    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker._btn = btn;
    
    const emojis = ['😂', '🤔', '👍', '👎', '💀', '😲'];
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.className = 'picker-emoji';
        span.onclick = (e) => {
            e.stopPropagation();
            window.sendReaction(targetId, emoji);
            picker.remove();
        };
        picker.appendChild(span);
    });

    document.body.appendChild(picker);
    
    const rect = btn.getBoundingClientRect();
    picker.style.left = `${rect.left + rect.width / 2}px`;
    picker.style.top = `${rect.top - 5}px`;

    setTimeout(() => {
        const clickOutside = (e) => {
            if (!picker.contains(e.target) && e.target !== btn) {
                picker.remove();
                document.removeEventListener('click', clickOutside);
            }
        };
        document.addEventListener('click', clickOutside);
    }, 10);
};

window.sendReaction = function(targetId, emoji) {
    if (realtimeChannel && currentUser) {
        const myName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || "Игрок";
        
        realtimeChannel.send({
            type: 'broadcast',
            event: 'reaction',
            payload: { 
                targetId, 
                emoji, 
                senderId: currentUser.id,
                senderName: myName
            }
        }).then(res => {
            if (res !== 'ok') console.warn("Broadcast send failed:", res);
        });
        
        
        if (window.spawnReaction) window.spawnReaction(targetId, emoji, "Вы");
    } else {
        console.warn("Канал связи не готов к отправке реакций.");
    }
};
