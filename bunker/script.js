import { CONFIG } from '../js/modules/config.js';
import { BUNKER_DATA, getRandomItem } from './game_data.js';
import { showScreen, showError, showAlert, showConfirm, screens } from './js/ui.js';
import { renderPlayersList, renderMyCards, renderVoteOptions } from './js/render.js';
import { initChat } from './js/chat.js';
import { startTutorial } from './js/tutorial.js';
import { LORE_PRESETS, generateBetaLore, generateBunkerConditions } from './js/lore.js';
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
    setupFeedbackModal(); // Инициализация почтового ящика (ранняя)
    
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
    setupFeedbackModal(); // Инициализация почтового ящика
    
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
    
    // --- НОВОЕ: ОБРАБОТЧИК ДОСРОЧНОГО ФИНАЛА ---
    const forceEndBtn = document.getElementById('force-end-game-btn');
    if (forceEndBtn) {
        forceEndBtn.addEventListener('click', () => {
            if (!isHost) return;
            showConfirm("Вы уверены, что хотите досрочно завершить игру? Выживут все, кто сейчас остался за столом, и игра перейдет к Эпилогу.", async () => {
                await supabase.from('bunker_rooms').update({ 
                    status: 'epilogue',
                    voting_active: false 
                }).eq('id', currentRoomId);
                window.playBunkerSFX('alarm');
            });
        });
    }
});


// === ЛОГИКА ПРЕЗЕНТАЦИИ КАРТЫ НА СТОЛЕ ===
let tableCardTimeout = null; // Глобальная переменная для хранения таймера

window.displayTableCard = function(payload) {
    const container = document.getElementById('table-card-presentation');
    if (!container) return;

    // Очищаем предыдущий таймер, если карточка уже была открыта
    if (tableCardTimeout) {
        clearTimeout(tableCardTimeout);
        tableCardTimeout = null;
    }

    const getCardType = (label) => {
        const types = { 'Профессия': 'profession', 'Биология': 'biology', 'Телосложение': 'body', 'Характер': 'character', 'Привычка': 'habit', 'Здоровье': 'health', 'Хобби': 'trait', 'Фобия': 'trait', 'Багаж': 'equipment', 'Факт': 'trait', 'Спецуха': 'special' };
        return types[label] || 'default';
    };
    const getCardIcon = (label) => {
        const icons = { 'Профессия': 'fa-user-tie', 'Биология': 'fa-dna', 'Телосложение': 'fa-child', 'Характер': 'fa-masks-theater', 'Привычка': 'fa-smoking', 'Здоровье': 'fa-heartbeat', 'Хобби': 'fa-gamepad', 'Фобия': 'fa-ghost', 'Багаж': 'fa-briefcase', 'Факт': 'fa-info-circle', 'Спецуха': 'fa-star' };
        return icons[label] || 'fa-id-card';
    };

    const type = getCardType(payload.cardKey);
    const icon = getCardIcon(payload.cardKey);

    // Меняем цвет рамки в зависимости от типа карты
    const colors = { 'profession': '#3b82f6', 'biology': '#10b981', 'body': '#ec4899', 'character': '#f97316', 'habit': '#b91c1c', 'health': '#fbbf24', 'trait': '#a855f7', 'equipment': '#ef4444', 'special': '#f59e0b', 'default': '#fff' };
    container.style.borderColor = colors[type];
    container.style.boxShadow = `0 0 50px rgba(0,0,0,0.9), 0 0 30px ${colors[type]}66`;

    container.innerHTML = `
        <button class="tcp-close-btn" id="tcp-close-btn" title="Свернуть карту"><i class="fas fa-times"></i></button>
        <div class="tcp-header">
            ИГРОК <span class="tcp-player-name">${payload.userName}</span><br>ОТКРЫВАЕТ КАРТУ:
        </div>
        <div class="bunker-card type-${type}" style="width: 100%; cursor: default; transform: none; box-shadow: none; pointer-events: none;">
            <div class="card-key"><i class="fas ${icon}"></i> ${payload.cardKey}</div>
            <div class="card-value" style="font-size: 0.85rem; text-align: left; padding: 10px 0;">${payload.cardValue}</div>
        </div>
    `;

    // Кнопка закрытия доступна только тому, кто открыл карту, ИЛИ хосту комнаты
    const closeBtn = document.getElementById('tcp-close-btn');
    if (payload.userId === currentUser.id || isHost) {
        closeBtn.style.display = 'flex';
        closeBtn.onclick = () => {
            window.hideTableCard();
            if (realtimeChannel) {
                realtimeChannel.send({ type: 'broadcast', event: 'hide_table_card' });
            }
        };
    }

    container.classList.add('active');
    if (window.playBunkerSFX) window.playBunkerSFX('alarm'); // Звук привлечения внимания

    // --- НОВОЕ: АВТОМАТИЧЕСКОЕ ЗАКРЫТИЕ ЧЕРЕЗ 5 СЕКУНД ---
    tableCardTimeout = setTimeout(() => {
        window.hideTableCard();
    }, 5000);
};

window.hideTableCard = function() {
    const container = document.getElementById('table-card-presentation');
    if (container) container.classList.remove('active');
    
    // Очищаем таймер при ручном закрытии
    if (tableCardTimeout) {
        clearTimeout(tableCardTimeout);
        tableCardTimeout = null;
    }
};

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

    // Генерируем состояние бункера при создании комнаты
    if (typeof generateBunkerConditions === 'function') {
        fullLoreText += generateBunkerConditions();
    }
    
    // Квоту выживших добавим позже, при старте игры!

    
    document.getElementById('room-settings-modal').classList.remove('active');

    const code = generateRoomCode();
    
    
    const { data: room, error } = await supabase.from('bunker_rooms').insert([{ 
        room_code: code, 
        host_id: currentUser.id, 
        status: 'waiting',
        max_players: maxPlayers,
        is_private: isPrivate,
        require_approval: requireApproval,
        lore: fullLoreText,
        survivors_limit: 0 // Временно 0, система посчитает при старте
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
        .on('broadcast', { event: 'show_table_card' }, ({ payload }) => {
            window.displayTableCard(payload);
        })
        .on('broadcast', { event: 'hide_table_card' }, () => {
            window.hideTableCard();
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
            // --- НОВОЕ: ПОКАЗЫВАЕМ КНОПКУ ДОСРОЧНОГО ФИНАЛА ---
            const forceEndBtn = document.getElementById('force-end-game-btn');
            if (forceEndBtn) forceEndBtn.style.display = room.voting_active ? 'none' : 'block';
        }
    }

    // --- ОБРАБОТКА СТАДИИ ЭПИЛОГА ---
    if (room.status === 'epilogue') {
        document.getElementById('epilogue-modal').classList.add('active');
        
        if (isHost) {
            document.getElementById('epilogue-host-view').style.display = 'flex';
            document.getElementById('epilogue-player-view').style.display = 'none';
            
            // 1. Заполняем правую колонку (Лор и Условия)
            document.getElementById('epi-bunker-lore').textContent = room.lore;
            
            // 2. Заполняем левую колонку (Выжившие и их карты)
            const survivorsListEl = document.getElementById('epi-survivors-list');
            const survivors = players.filter(p => p.is_alive);
            
            if (survivors.length === 0) {
                survivorsListEl.innerHTML = '<div style="text-align:center; color:#ef4444; margin-top:20px;">ВСЕ МЕРТВЫ</div>';
            } else {
                survivorsListEl.innerHTML = survivors.map(p => {
                    let traitsHtml = '';
                    if (p.revealed_cards && p.revealed_cards.length > 0) {
                        traitsHtml = p.revealed_cards.map(c => `<div class="epi-survivor-trait"><span>${c.key}:</span> ${c.value}</div>`).join('');
                    } else {
                        traitsHtml = '<div class="epi-survivor-trait" style="color:#555;">Нет открытых данных</div>';
                    }
                    return `
                        <div class="epi-survivor-card">
                            <div class="epi-survivor-name">${p.username}</div>
                            ${traitsHtml}
                        </div>
                    `;
                }).join('');
            }
        } else {
            document.getElementById('epilogue-host-view').style.display = 'none';
            document.getElementById('epilogue-player-view').style.display = 'block';
        }
    } else {
        const epiModal = document.getElementById('epilogue-modal');
        if (epiModal) epiModal.classList.remove('active');
    }

    if (room.status === 'finished') {
        const gameOverModal = document.getElementById('game-over-modal');
        
        if (!gameOverModal.classList.contains('active')) {
            window.playBunkerSFX('survive');
        }
        
        const winnerMsg = document.getElementById('winner-msg');
        const survivors = players.filter(p => p.is_alive).map(p => p.username).join(', ');
        
        // Показываем сгенерированный текст эпилога (если он есть), иначе стандартный текст
        if (room.epilogue_text) {
            winnerMsg.innerHTML = `<div style="color: #10b981; margin-bottom: 15px; font-weight: bold;">ВЫЖИВШИЕ: ${survivors}</div><div style="text-align: left; background: rgba(0,0,0,0.5); padding: 15px; border-left: 3px solid #a855f7; border-radius: 4px;">${room.epilogue_text}</div>`;
        } else {
            winnerMsg.textContent = survivors.length > 0 ? `МЕСТО В БУНКЕРЕ ЗАСЛУЖИЛ(И): ${survivors}` : `ВСЕ ПОГИБЛИ. БУНКЕР ПУСТ.`;
        }

        gameOverModal.classList.add('active');
        if (isHost) document.getElementById('restart-room-btn').style.display = 'block';
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
            const lastActive = new Date(room.last_active);
            const now = new Date();
            const diffInMinutes = (now - lastActive) / 1000 / 60;

            if (diffInMinutes > 60) {
                const btn = document.getElementById('reconnect-room-btn');
                if (btn) btn.style.display = 'none';
                return;
            }

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

    // Получаем всех игроков, которые реально зашли в комнату
    const { data: players } = await supabase.from('bunker_players').select('id').eq('room_id', currentRoomId);
    
    // --- АВТОМАТИЧЕСКИЙ РАСЧЕТ ВЫЖИВШИХ ---
    // Выживает ровно половина (округление вниз). Минимум 1 человек.
    const actualPlayerCount = players.length;
    const survivorsLimit = Math.max(1, Math.floor(actualPlayerCount / 2)); 
    
    for (const player of players) {
        const generatedCards = {
            profession: getRandomItem(BUNKER_DATA.professions),
            health: getRandomItem(BUNKER_DATA.health),
            biology: getRandomItem(BUNKER_DATA.biology),
            body: getRandomItem(BUNKER_DATA.body),
            character: getRandomItem(BUNKER_DATA.character),
            habit: getRandomItem(BUNKER_DATA.habit),
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

    // Получаем текущий лор и дописываем в него рассчитанную квоту выживших
    const { data: roomData } = await supabase.from('bunker_rooms').select('lore').eq('id', currentRoomId).single();
    const updatedLore = roomData.lore + `\n\n📌 МЕСТ В БУНКЕРЕ (КВОТА ВЫЖИВШИХ): ${survivorsLimit} чел. (из ${actualPlayerCount})`;

    // Обновляем комнату: меняем статус, сохраняем лимит и обновленный лор
    await supabase.from('bunker_rooms').update({ 
        status: 'playing',
        survivors_limit: survivorsLimit,
        lore: updatedLore
    }).eq('id', currentRoomId);
    
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
                
                // Получаем лимит выживших из БД
                const { data: currentRoomData } = await supabase.from('bunker_rooms').select('survivors_limit').eq('id', currentRoomId).single();
                const limit = currentRoomData ? currentRoomData.survivors_limit : 1;

                // Если выживших осталось столько же, сколько мест в бункере (или меньше) — переходим к ЭПИЛОГУ
                const newStatus = aliveCount <= limit ? 'epilogue' : 'playing';
                
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

        
        // ЗАМЕНИ СТАРЫЙ setTimeout В КОНЦЕ animateAndReveal НА ЭТОТ:
        setTimeout(() => { 
            animCard.remove(); 
            
            // --- НОВАЯ ЛОГИКА: ФИКСИРУЕМ КАРТУ НА СТОЛЕ ---
            const myName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || "Игрок";
            const payload = {
                userId: currentUser.id,
                userName: myName,
                cardKey: cardKey,
                cardValue: cardValue
            };
            
            // Показываем у себя
            window.displayTableCard(payload);
            
            // Отправляем всем остальным за столом
            if (realtimeChannel) {
                realtimeChannel.send({
                    type: 'broadcast',
                    event: 'show_table_card',
                    payload: payload
                });
            }
            
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




/** 
 * УНИФИЦИРОВАННАЯ СИСТЕМА МУЗЫКИ БУНКЕРА
 */
const bunkerTracks = [
    '../assets/bunker-bg1.mp3',
    '../assets/bunker-bg2.mp3'
];

let currentTrackIndex = 0;
let bunkerMusic = null;
let bunkerMusicVolume = localStorage.getItem('bunker_music_vol') !== null 
    ? parseFloat(localStorage.getItem('bunker_music_vol')) 
    : 0.1;

let isMusicMuted = localStorage.getItem('bunker_music_muted') === 'true';

function initBunkerMusic() {
    bunkerMusic = new Audio(bunkerTracks[currentTrackIndex]);
    bunkerMusic.volume = isMusicMuted ? 0 : bunkerMusicVolume;
    bunkerMusic.addEventListener('ended', playNextTrack);

    const musicSlider = document.getElementById('bunker-music-slider');
    const muteBtn = document.getElementById('bunker-mute-btn');
    const musicIcon = document.getElementById('music-icon');
    const musicVolVal = document.getElementById('music-vol-val');

    if (musicSlider) {
        musicSlider.value = bunkerMusicVolume;
        musicSlider.addEventListener('input', (e) => {
            bunkerMusicVolume = parseFloat(e.target.value);
            if (bunkerMusicVolume > 0) isMusicMuted = false;
            updateMusicState();
            syncMusicUI();
        });

        // Поддержка колесика мыши
        musicSlider.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = 0.05;
            const delta = e.deltaY < 0 ? step : -step;
            let newVal = Math.min(1, Math.max(0, bunkerMusicVolume + delta));
            bunkerMusicVolume = newVal;
            musicSlider.value = bunkerMusicVolume;
            if (bunkerMusicVolume > 0) isMusicMuted = false;
            updateMusicState();
            syncMusicUI();
        }, { passive: false });
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            isMusicMuted = !isMusicMuted;
            if (!isMusicMuted) {
                bunkerMusic.play().catch(() => {});
            } else {
                bunkerMusic.pause();
            }
            updateMusicState();
            syncMusicUI();
        });
    }

    function playNextTrack() {
        currentTrackIndex = (currentTrackIndex + 1) % bunkerTracks.length;
        bunkerMusic.src = bunkerTracks[currentTrackIndex];
        bunkerMusic.volume = isMusicMuted ? 0 : bunkerMusicVolume;
        if (!isMusicMuted) bunkerMusic.play().catch(() => {});
    }

    function updateMusicState() {
        if (bunkerMusic) {
            bunkerMusic.volume = isMusicMuted ? 0 : bunkerMusicVolume;
        }
        localStorage.setItem('bunker_music_vol', bunkerMusicVolume);
        localStorage.setItem('bunker_music_muted', isMusicMuted);
    }

    function syncMusicUI() {
        if (!muteBtn || !musicIcon) return;
        
        if (isMusicMuted || bunkerMusicVolume === 0) {
            muteBtn.innerHTML = '<i class="fas fa-play"></i>';
            muteBtn.style.color = '#ef4444';
            muteBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            musicIcon.className = 'fas fa-volume-mute';
            musicIcon.style.color = '#ef4444';
        } else {
            muteBtn.innerHTML = '<i class="fas fa-pause"></i>';
            muteBtn.style.color = '#8b5cf6';
            muteBtn.style.borderColor = 'rgba(139, 92, 246, 0.3)';
            musicIcon.className = 'fas fa-music';
            musicIcon.style.color = '#8b5cf6';
        }

        if (musicVolVal) {
            musicVolVal.textContent = Math.round(bunkerMusicVolume * 100) + '%';
        }
    }

    // Разблокировка аудио при первом взаимодействии
    const unlockAudio = () => {
        if (!isMusicMuted) {
            bunkerMusic.play().catch(() => {});
        }
        document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);

    syncMusicUI();
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
                'profession': 'Профессия', 'biology': 'Биология', 'body': 'Телосложение', 'character': 'Характер', 'habit': 'Привычка', 'health': 'Здоровье',
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
            const categories = ['profession', 'health', 'body', 'character', 'habit', 'hobby', 'phobia', 'baggage', 'fact'];
            const cat = categories[Math.floor(Math.random() * categories.length)];
            const keyMap = { 'profession': 'Профессия', 'health': 'Здоровье', 'body': 'Телосложение', 'character': 'Характер', 'habit': 'Привычка', 'hobby': 'Хобби', 'phobia': 'Фобия', 'baggage': 'Багаж', 'fact': 'Факт' };
            
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
            const keyMap = { 'profession': 'Профессия', 'biology': 'Биология', 'body': 'Телосложение', 'character': 'Характер', 'habit': 'Привычка', 'health': 'Здоровье', 'hobby': 'Хобби', 'phobia': 'Фобия', 'baggage': 'Багаж', 'fact': 'Факт' };
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

        // Поддержка колесика мыши
        sfxSlider.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = 0.05;
            const delta = e.deltaY < 0 ? step : -step;
            let newVal = Math.min(1, Math.max(0, bunkerSfxVolume + delta));
            updateSfxVolume(newVal);
            sfxSlider.value = newVal;

            const sfxVolVal = document.getElementById('sfx-vol-val');
            if (sfxVolVal) sfxVolVal.textContent = Math.round(newVal * 100) + '%';

            if (newVal === 0) {
                sfxIcon.className = 'fas fa-volume-mute';
                sfxIcon.style.color = '#ef4444';
            } else {
                sfxIcon.className = 'fas fa-volume-up';
                sfxIcon.style.color = '#10b981';
            }
        }, { passive: false });
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




// Инициализация микшера звуков (SFX) уже вызвана выше через initSfxMixer()


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

// === СИСТЕМА ОБРАТНОЙ СВЯЗИ (TELEGRAM BOT) ===
function setupFeedbackModal() {
    const triggerBtn = document.getElementById('feedback-trigger-btn');
    const modal = document.getElementById('feedback-modal');
    const closeBtn = document.getElementById('close-feedback-btn');
    const form = document.getElementById('feedback-form');
    const statusEl = document.getElementById('feedback-status');

    if (!triggerBtn || !modal || !form) return;

    const TG_BOT_TOKEN = '7589435895:AAGqctK-hnYRjmBonADDUQwp8V5ZQEgdi7k';
    const TG_CHAT_ID = '1202772510';

    triggerBtn.addEventListener('click', () => {
        modal.classList.add('active');
        statusEl.textContent = '';
        statusEl.style.color = '#a1a1aa';
        
        if (currentUser) {
            const meta = currentUser.user_metadata;
            const nameInput = document.getElementById('feedback-name');
            if (nameInput) nameInput.value = meta.full_name || meta.name || "";
        }
    });

    const closeModal = () => {
        modal.classList.remove('active');
    };

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { 
        if (e.target === modal) closeModal(); 
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = form.querySelector('.submit-feedback-btn');
        const name = document.getElementById('feedback-name').value;
        const types = form.querySelectorAll('input[name="feedback-type"]');
        let type = "ИДЕЯ";
        types.forEach(t => { if(t.checked) type = t.value; });

        const message = document.getElementById('feedback-msg').value;

        submitBtn.disabled = true;
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> СИГНАЛ УХОДИТ...';
        statusEl.textContent = '';

        const text = `📬 *ПОСЛАНИЕ ИЗ БУНКЕРА!*\n\n👤 *От:* ${name}\n🏷️ *Тип:* ${type}\n📝 *Сообщение:* ${message}\n🌐 *Комната:* ${currentRoomCode || 'Lobby'}`;

        try {
            const response = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TG_CHAT_ID,
                    text: text,
                    parse_mode: 'Markdown'
                })
            });

            if (response.ok) {
                statusEl.textContent = '✅ ПОСЛАНИЕ ДОСТАВЛЕНО В ХАБ!';
                statusEl.style.color = '#10b981';
                form.reset();
                setTimeout(closeModal, 2000);
            } else {
                throw new Error('Signal lost');
            }
        } catch (err) {
            statusEl.textContent = '❌ ОШИБКА СВЯЗИ. ПОПРОБУЙ ЕЩЕ РАЗ.';
            statusEl.style.color = '#ef4444';
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    });

    // Стилизация кнопок выбора типа внутри бункера
    const typeLabels = form.querySelectorAll('.type-btn-bunker');
    const typeInputs = form.querySelectorAll('input[name="feedback-type"]');
    
    function updateTypeUI() {
        typeInputs.forEach((input, idx) => {
            if (input.checked) {
                typeLabels[idx].style.background = input.value === 'ИДЕЯ' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
                typeLabels[idx].style.fontWeight = 'bold';
            } else {
                typeLabels[idx].style.background = 'transparent';
                typeLabels[idx].style.fontWeight = 'normal';
            }
        });
    }
    
    typeInputs.forEach(input => input.addEventListener('change', updateTypeUI));
    updateTypeUI();
}

// === ПЕРЕКЛЮЧЕНИЕ ВИДА (КРУГ / ТАБЛИЦА) ===
window.isTableView = false;

window.toggleTableView = function() {
    window.isTableView = !window.isTableView;
    
    const radialTable = document.getElementById('game-players-list');
    const dataTable = document.getElementById('game-data-table');
    const btnIcon = document.querySelector('#toggle-view-btn i');
    
    if (window.isTableView) {
        // Включаем таблицу
        radialTable.style.display = 'none';
        dataTable.style.display = 'block';
        btnIcon.className = 'fas fa-circle-notch'; // Меняем иконку на "Круг"
        document.getElementById('toggle-view-btn').title = "Вид: Круглый стол";
    } else {
        // Включаем круглый стол
        radialTable.style.display = 'flex';
        dataTable.style.display = 'none';
        btnIcon.className = 'fas fa-table'; // Меняем иконку на "Таблица"
        document.getElementById('toggle-view-btn').title = "Вид: Сводная таблица";
    }
    
    if (window.playBunkerSFX) window.playBunkerSFX('click');
};

// === СИСТЕМА ДОСЬЕ ИГРОКОВ ===
window.openDossier = function(userId) {
    // Ищем игрока в кэше
    const player = window.bunkerPlayersCache ? window.bunkerPlayersCache.find(p => p.user_id === userId) : null;
    if (!player) return;

    // Заполняем шапку
    document.getElementById('dossier-avatar').src = player.avatar_url;
    document.getElementById('dossier-name').textContent = player.username;
    
    let statusText = player.is_alive ? "В ИГРЕ" : "ИЗГНАН 💀";
    if (player.has_immunity) statusText += " | ИММУНИТЕТ 🛡️";
    document.getElementById('dossier-status').textContent = statusText;
    document.getElementById('dossier-status').style.color = player.is_alive ? "#10b981" : "#ef4444";

    // Заполняем карты
    const container = document.getElementById('dossier-cards');
    if (!player.revealed_cards || player.revealed_cards.length === 0) {
        container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #555; font-family: var(--font-pixel); font-size: 0.7rem; padding: 30px;">НЕТ ОТКРЫТЫХ ДАННЫХ</div>';
    } else {
        const getCardType = (label) => {
            const types = { 'Профессия': 'profession', 'Биология': 'biology', 'Здоровье': 'health', 'Хобби': 'trait', 'Фобия': 'trait', 'Багаж': 'equipment', 'Факт': 'trait', 'Спецуха': 'special' };
            return types[label] || 'default';
        };
        const getCardIcon = (label) => {
            const icons = { 'Профессия': 'fa-user-tie', 'Биология': 'fa-dna', 'Здоровье': 'fa-heartbeat', 'Хобби': 'fa-gamepad', 'Фобия': 'fa-ghost', 'Багаж': 'fa-briefcase', 'Факт': 'fa-info-circle', 'Спецуха': 'fa-star' };
            return icons[label] || 'fa-id-card';
        };

        container.innerHTML = player.revealed_cards.map(c => {
            const type = getCardType(c.key);
            const icon = getCardIcon(c.key);
            return `
                <div class="bunker-card type-${type}" style="cursor: default;">
                    <div class="card-key"><i class="fas ${icon}"></i> ${c.key}</div>
                    <div class="card-value" style="font-size: 0.75rem;">${c.value}</div>
                </div>
            `;
        }).join('');
    }

    // Показываем модалку
    document.getElementById('dossier-modal').classList.add('active');
    if (window.playBunkerSFX) window.playBunkerSFX('click');
};

// === ГЕНЕРАТОР ФИНАЛА ИГРЫ (ОБНОВЛЕННЫЙ) ===
window.submitEpilogue = async function() {
    const btn = document.getElementById('submit-epilogue-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> АНАЛИЗ...';

    // Собираем ответы Хоста
    const qProblem = document.getElementById('epi-q-problem').checked; // Критично!
    const qThreat  = document.getElementById('epi-q-threat').checked;
    const qFood    = document.getElementById('epi-q-food').checked;    // Критично!
    const qMed     = document.getElementById('epi-q-med').checked;
    const qMental  = document.getElementById('epi-q-mental').checked;
    const qRep     = document.getElementById('epi-q-rep').checked;

    let epilogueText = "";
    let isDead = false;

    // ЖЕСТКАЯ ЛОГИКА ВЫЖИВАНИЯ
    if (!qProblem) {
        isDead = true;
        epilogueText = "💥 <b>КАТАСТРОФИЧЕСКИЙ ПРОВАЛ:</b> Команда не смогла решить главную техническую проблему бункера. Системы жизнеобеспечения отказали. Бункер стал вашей общей стальной могилой задолго до того, как закончилась еда.";
    } else if (!qFood) {
        isDead = true;
        epilogueText = "💀 <b>ГОЛОДНАЯ СМЕРТЬ:</b> Вы починили бункер, но запасы иссякли. Не имея навыков добычи пропитания, группа медленно сошла с ума от голода. Последние дни превратились в кровавую бойню за крошки.";
    } else {
        // Если базовые потребности решены, считаем очки качества жизни
        let score = 0;
        if (qThreat) score++;
        if (qMed) score++;
        if (qMental) score++;
        if (qRep) score++;

        if (score === 4) {
            epilogueText = "🌟 <b>ИДЕАЛЬНОЕ ВОЗРОЖДЕНИЕ:</b> Выжившие оказались безупречной командой. Вы не только пережили катастрофу в комфорте, сохранив рассудок и здоровье, но и успешно вышли на поверхность, основав новую колонию. Человечество спасено!";
        } else if (score >= 2) {
            epilogueText = "🏕️ <b>ТЯЖЕЛОЕ ВЫЖИВАНИЕ:</b> Годы в бункере дались нелегко. Были болезни, нервные срывы и потери, но ядро группы выстояло. Вы вышли на поверхность истощенными, но живыми. У человечества есть шанс.";
        } else {
            epilogueText = "🏚️ <b>МРАЧНОЕ СУЩЕСТВОВАНИЕ:</b> Вы выжили физически, но потеряли человеческий облик. Без медицины и психологической поддержки бункер превратился в сумасшедший дом. Те, кто в итоге вышел на поверхность, больше напоминали диких зверей, чем спасителей человечества.";
        }
    }

    // Добавляем детали по отсутствующим навыкам (если выжили, но с потерями)
    if (!isDead) {
        let details = "<br><br><span style='color: #ef4444; font-size: 0.8rem;'>Проблемы, с которыми столкнулась группа:</span><ul style='margin-top: 5px; padding-left: 20px; font-size: 0.8rem; color: #a1a1aa;'>";
        let hasDetails = false;
        
        if (!qThreat) { details += "<li>Выход на поверхность обернулся кошмаром из-за неготовности к внешним угрозам.</li>"; hasDetails = true; }
        if (!qMed) { details += "<li>Отсутствие медицины привело к тяжелым осложнениям от простых инфекций.</li>"; hasDetails = true; }
        if (!qMental) { details += "<li>Психологическое давление сломало нескольких членов команды, приведя к паранойе.</li>"; hasDetails = true; }
        if (!qRep) { details += "<li>Группа выжила, но продолжить род некому. Вы — последнее поколение людей.</li>"; hasDetails = true; }
        details += "</ul>";

        if (hasDetails) epilogueText += details;
    }

    // Сохраняем в БД и переводим игру в статус finished
    await supabase.from('bunker_rooms').update({ 
        status: 'finished',
        epilogue_text: epilogueText
    }).eq('id', currentRoomId);
};
