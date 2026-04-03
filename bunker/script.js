import { CONFIG } from '../js/modules/config.js';
import { BUNKER_DATA, getRandomItem } from './game_data.js';
import { showScreen, showError, showAlert, showConfirm, screens } from './js/ui.js';
import { renderPlayersList, renderMyCards, renderVoteOptions } from './js/render.js';
import { initChat } from './js/chat.js';
import { startTutorial } from './js/tutorial.js';
import './js/animations.js'; // Просто импортируем, чтобы файл отработал и привязал функции к window

const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

let currentUser = null;
let currentRoomId = null;
let currentRoomCode = null;
let isHost = false;
let isSpectator = false;
let realtimeChannel = null;
let syncInterval = null; // Резервный таймер
let lobbyRoomsTimer = null;
let heartbeatInterval = null; // <-- НОВАЯ ПЕРЕМЕННАЯ ДЛЯ ПУЛЬСА


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

    initChat(supabase, window.playBunkerSFX);

    // Проверка активной сессии (реконнект)
    await checkExistingRoom();

    // Открытие модалки настроек вместо моментального создания
    document.getElementById('create-room-btn').addEventListener('click', () => {
        document.getElementById('room-settings-modal').classList.add('active');
    });

    // Закрытие модалки
    document.getElementById('cancel-create-btn').addEventListener('click', () => {
        document.getElementById('room-settings-modal').classList.remove('active');
    });

    // Подтверждение создания с настройками
    document.getElementById('confirm-create-btn').addEventListener('click', createRoom);
    document.getElementById('join-room-btn').addEventListener('click', joinRoom);
    startGameBtn.addEventListener('click', startGame);

    loadPublicRooms();
    lobbyRoomsTimer = setInterval(loadPublicRooms, 5000);
    document.querySelectorAll('.leave-game-btn').forEach(btn => {
        btn.addEventListener('click', window.leaveRoom);
    });

    // Рестарт комнаты (Хост)
    document.getElementById('restart-room-btn').addEventListener('click', async () => {
        if (!isHost) return;
        
        document.getElementById('restart-room-btn').textContent = "СБРОС...";
        document.getElementById('restart-room-btn').disabled = true;

        // 1. Оживляем всех игроков и стираем им карты
        await supabase.from('bunker_players').update({ 
            is_alive: true, 
            cards: null, 
            revealed_cards: [] 
        }).eq('room_id', currentRoomId);

        // 2. Переводим комнату обратно в лобби ожидания
        await supabase.from('bunker_rooms').update({ 
            status: 'waiting',
            voting_active: false,
            votes: {} 
        }).eq('id', currentRoomId);

        document.getElementById('restart-room-btn').textContent = "ИГРАТЬ ЕЩЕ";
        document.getElementById('restart-room-btn').disabled = false;
        
        // Закрываем модалку и перекидываем в лобби
        document.getElementById('game-over-modal').classList.remove('active');
        showScreen('waiting');
    });

    // --- ВНУТРИ DOMContentLoaded ---
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


// Радар комнат (Лобби)
async function loadPublicRooms() {
    if (!screens.lobby.classList.contains('active')) return;

    if (window.connectGlobalChat && currentUser) {
        window.connectGlobalChat({
            id: currentUser.id,
            username: currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.user_metadata?.username || currentUser.user_metadata?.custom_claims?.global_name || currentUser.email.split('@')[0],
            avatar_url: currentUser.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.id}`
        });
    }

    // Ищем комнаты, которые были активны последние 5 минут
    const d = new Date();
    d.setMinutes(d.getMinutes() - 5); 
    
    // 1. Получаем список публичных комнат
    const { data: rooms, error } = await supabase
        .from('bunker_rooms')
        .select('*')
        .gte('last_active', d.toISOString())
        .eq('is_private', false) // Только публичные
        .order('last_active', { ascending: false })
        .limit(10);

    const listEl = document.getElementById('public-rooms-list');
    if (error || !rooms || rooms.length === 0) {
        listEl.innerHTML = '<div class="radar-loading" style="color: #ef4444; text-shadow: 0 0 10px rgba(239, 68, 68, 0.5);">СИГНАЛОВ НЕ ОБНАРУЖЕНО</div>';
        return;
    }

    // 2. Вытягиваем игроков для этих комнат, чтобы узнать ники хостов
    const roomIds = rooms.map(r => r.id);
    const { data: players } = await supabase
        .from('bunker_players')
        .select('room_id, user_id, username')
        .in('room_id', roomIds);

    let html = '';
    for (const room of rooms) {
        const isPlaying = room.status === 'playing';
        const statusText = isPlaying ? 'В ИГРЕ (ИДЕТ РЕЗНЯ)' : 'ОЖИДАЕТ ВЫЖИВШИХ';
        const statusClass = isPlaying ? 'playing' : 'waiting';
        
        // 3. Ищем имя хоста
        const hostPlayer = players?.find(p => p.room_id === room.id && p.user_id === room.host_id);
        const hostName = hostPlayer ? hostPlayer.username : 'Неизвестный';
        
        let actionBtn = '';
        if (isPlaying) {
            actionBtn = `<button class="room-card-action spectate" onclick="window.spectateRoom('${room.room_code}')"><i class="fas fa-eye"></i> СМОТРЕТЬ</button>`;
        } else {
            actionBtn = `<button class="room-card-action" onclick="window.joinRoomByCode('${room.room_code}')"><i class="fas fa-sign-in-alt"></i> ВОЙТИ</button>`;
        }

        // Рендерим карточку с ником хоста
        html += `
            <div class="room-card ${statusClass}">
                <div class="room-card-info">
                    <span class="room-card-code">БУНКЕР #${room.room_code}</span>
                    <span class="room-card-host"><i class="fas fa-crown"></i> ${hostName}</span>
                    <span class="room-card-status ${statusClass}">${statusText}</span>
                </div>
                ${actionBtn}
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
    isSpectator = true; // Зритель!

    document.getElementById('current-room-code').textContent = code + " (НАБЛЮДЕНИЕ)";
    
    if (lobbyRoomsTimer) clearInterval(lobbyRoomsTimer);

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
    // 1. Считываем настройки из формы
    const maxPlayers = parseInt(document.getElementById('setting-max-players').value);
    const isPrivate = document.getElementById('setting-privacy').value === 'private';
    const requireApproval = document.getElementById('setting-approval').checked;

    // 2. Закрываем модалку настроек
    document.getElementById('room-settings-modal').classList.remove('active');

    const code = generateRoomCode();
    
    // 3. Отправляем в Supabase новые параметры
    const { data: room, error } = await supabase.from('bunker_rooms').insert([{ 
        room_code: code, 
        host_id: currentUser.id, 
        status: 'waiting',
        max_players: maxPlayers,
        is_private: isPrivate,
        require_approval: requireApproval
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

    // Проверяем, нужен ли аппрув (и если мы НЕ хост)
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
        join_status: status // <-- Передаем статус
    }]);
    if (error && error.code !== '23505') {
        showError("Ошибка подключения.");
        return false;
    }
    return true;
}

// === СИСТЕМА ПУЛЬСА ХОСТА ===
function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    // Отправляем сигнал каждую 1 минуту (60000 мс)
    heartbeatInterval = setInterval(async () => {
        if (isHost && currentRoomId) {
            await supabase
                .from('bunker_rooms')
                .update({ last_active: new Date().toISOString() })
                .eq('id', currentRoomId);
        }
    }, 60000); 
}

// === НАДЕЖНАЯ СИНХРОНИЗАЦИЯ (Realtime + Polling) ===
function startSync() {
    // 1. Пытаемся включить Realtime
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    realtimeChannel = supabase.channel(`room:${currentRoomId}`)
        .on('presence', { event: 'sync' }, () => {
            const state = realtimeChannel.presenceState();
            let specCount = 0;
            for (const key in state) {
                state[key].forEach(p => {
                    if (p.is_spectator) specCount++;
                });
            }
            const specDisplay = document.getElementById('spectator-count-display');
            if (specDisplay) {
                specDisplay.textContent = specCount;
                specDisplay.parentElement.style.display = specCount > 0 ? 'inline-flex' : 'none';
            }
        })
        .on('postgres', { event: '*', schema: 'public', table: 'bunker_players', filter: `room_id=eq.${currentRoomId}` }, fetchGameState)
        .on('postgres', { event: 'UPDATE', schema: 'public', table: 'bunker_rooms', filter: `id=eq.${currentRoomId}` }, fetchGameState)
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await realtimeChannel.track({ user_id: currentUser.id, is_spectator: isSpectator });
            }
        });

    // 2. Резервный таймер (каждые 3 секунды проверяем базу принудительно)
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(fetchGameState, 3000);
    
    fetchGameState(); // Первый вызов
}

// Главная функция обновления состояния игры
async function fetchGameState() {
    // ФИКС: Если ID комнаты стерт или мы уже перешли на экран лобби — ничего не делаем
    if (!currentRoomId || screens.lobby.classList.contains('active')) return; 

    // 1. Получаем данные комнаты
    const { data: room } = await supabase.from('bunker_rooms').select('*').eq('id', currentRoomId).single();
    if (!room) return;

    // 2. Получаем всех игроков (одобренных и ожидающих)
    const { data: allPlayers } = await supabase.from('bunker_players').select('*').eq('room_id', currentRoomId).order('created_at', { ascending: true });
    if (!allPlayers) return;

    // Сортируем: одобренные игроки и те, кто еще ждет
    const players = allPlayers.filter(p => p.join_status === 'approved');
    const pendingPlayers = allPlayers.filter(p => p.join_status === 'pending');

    // --- ФИКС: ПРОВЕРКА ПРИЗРАЧНОГО ХОСТА И ПУСТОЙ КОМНАТЫ ---
    const isHostPresent = players.some(p => p.user_id === room.host_id);

    if (!isHostPresent) {
        if (players.length > 0) {
            // Хост пропал, но в комнате есть другие живые игроки.
            // Передаем корону, но ТОЛЬКО если мы сами — полноценный игрок.
            // Зрители (isSpectator) НЕ могут захватывать власть в базе.
            if (!isSpectator && !pendingPlayers.some(p => p.user_id === currentUser.id)) {
                console.log("Хост не найден, передаем корону первому игроку...");
                await supabase.from('bunker_rooms').update({ host_id: players[0].user_id }).eq('id', currentRoomId);
                return; // Ждем следующего цикла синхронизации
            }
        } else {
            // В комнате вообще нет игроков (только зрители или пустота).
            // Если мы зашли как зритель — кикаем обратно, так как смотреть не на кого.
            if (isSpectator) {
                clearInterval(syncInterval);
                showAlert("В этом бункере никого нет. Возвращаемся на радар.", () => {
                    window.location.reload();
                });
                return;
            }
        }
    }

    // --- ОБНОВЛЕНИЕ ЛОКАЛЬНОГО СТАТУСА ХОСТА ---
    if (!isSpectator) {
        const wasHost = isHost;
        isHost = (room.host_id === currentUser.id);
        
        // Если права хоста перешли к нам прямо сейчас
        if (!wasHost && isHost) {
            if (room.status === 'waiting') document.getElementById('start-game-btn').style.display = 'block';
            if (typeof startHeartbeat === 'function') startHeartbeat();
            showAlert("Вы назначены новым Лидером бункера!");
        }
    } else {
        // Гарантируем, что зритель НИКОГДА не считает себя хостом
        isHost = false;
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('start-vote-btn').style.display = 'none';
    }

    const amIHere = players.some(p => p.user_id === currentUser.id);
    const amIPending = pendingPlayers.some(p => p.user_id === currentUser.id);

    // Если нас нет ни в одобренных, ни в ожидающих — кикаем
    if (!amIHere && !amIPending && !isSpectator) {
        clearInterval(syncInterval);
        document.getElementById('join-pending-modal').classList.remove('active');
        showAlert("Доступ в комнату закрыт или заявка отклонена хостом.", () => {
            window.location.reload();
        });
        return;
    }

    // ЛОГИКА ДЛЯ ПОДКЛЮЧАЮЩЕГОСЯ: Показываем модалку и блокируем отрисовку лобби
    if (amIPending && !isHost) {
        document.getElementById('join-pending-modal').classList.add('active');
        return; 
    } else {
        document.getElementById('join-pending-modal').classList.remove('active');
    }

    // ЛОГИКА ДЛЯ ХОСТА: Выкидываем менюшку с заявками
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

    // Рендерим ТОЛЬКО одобренных игроков
    renderPlayersList(players, room.host_id, room.status, currentUser.id, isHost, room.voting_active);

    // ВЫНОСИМ ЛОГИКУ ГЕНЕРАЦИИ ОПЦИЙ (обновление статистики)
    if (room.voting_active) {
        renderVoteOptions(players, currentUser.id, isHost, isSpectator);
        
        if (room.votes && room.votes.end_time) {
            if (window.currentVoteEndTime !== room.votes.end_time) {
                window.currentVoteEndTime = room.votes.end_time;
                updateVoteTimer(room.votes.end_time);
            }
            
            // Auto close vote if expired
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

    if (room.status === 'playing') {
        if (screens.waiting.classList.contains('active')) {
            showScreen('game');
            if (isSpectator) {
                myCardsContainer.innerHTML = '<div style="color: #fbbf24; font-family: var(--font-pixel); font-size: 0.8rem; text-align: center; margin: 20px 0; border: 1px dashed #fbbf24; padding: 15px;">РЕЖИМ НАБЛЮДАТЕЛЯ.<br><br>ВЫ НЕ УЧАСТВУЕТЕ В ИГРЕ, ПРОСТО НАСЛАЖДАЙТЕСЬ ШОУ! 🍿</div>';
            } else {
                renderMyCards(players, currentUser.id);
            }
            
            // Запускаем обучение после небольшой паузы для полной отрисовки
            if (!isSpectator) {
                setTimeout(startTutorial, 800);
            }
        }

        // Логика отображения кнопок
        if (isHost) {
            document.getElementById('start-vote-btn').style.display = room.voting_active ? 'none' : 'block';
            document.getElementById('end-vote-btn').style.display = room.voting_active ? 'block' : 'none';
        }
    }

    if (room.status === 'finished') {
        const gameOverModal = document.getElementById('game-over-modal');
        
        // Проверяем, не показывали ли мы уже окно (чтобы звук не спамил)
        if (!gameOverModal.classList.contains('active')) {
            window.playBunkerSFX('survive');
        }
        
        const winnerMsg = document.getElementById('winner-msg');
        
        // Ищем кто выжил
        const survivors = players.filter(p => p.is_alive).map(p => p.username).join(', ');
        
        if (survivors.length > 0) {
            winnerMsg.textContent = `МЕСТО В БУНКЕРЕ ЗАСЛУЖИЛ(И): ${survivors}`;
        } else {
            winnerMsg.textContent = `ВСЕ ПОГИБЛИ. БУНКЕР ПУСТ.`;
        }

        gameOverModal.classList.add('active');

        // Показываем кнопку "ИГРАТЬ ЕЩЕ" только хосту
        if (isHost) {
            document.getElementById('restart-room-btn').style.display = 'block';
        }
    } else {
        document.getElementById('game-over-modal').classList.remove('active');
    }
}



// === ПОКИНУТЬ ИГРУ ===
window.leaveRoom = function() {
    // ФИКС: Сразу скрываем окно завершения игры
    const gameOverModal = document.getElementById('game-over-modal');
    if (gameOverModal) gameOverModal.classList.remove('active');

    showConfirm("Вы уверены, что хотите покинуть бункер?", async () => {
        const roomIdToDelete = currentRoomId; // Запоминаем ID перед сбросом

        if (!isSpectator && currentUser && roomIdToDelete) {
            
            // --- НОВАЯ ЛОГИКА: ПЕРЕДАЧА КОРОНЫ ---
            if (isHost) {
                // Ищем следующего игрока (кто зашел раньше всех, кроме нас, и кого уже пустили)
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
                    // Отдаем корону новому хосту
                    await supabase.from('bunker_rooms').update({ host_id: newHostId }).eq('id', roomIdToDelete);
                } else {
                    // Если нормальных игроков больше нет — удаляем комнату
                    await supabase.from('bunker_rooms').delete().eq('id', roomIdToDelete);
                }
            }

            // 2. Удаляем себя из списка игроков
            await supabase.from('bunker_players').delete().eq('user_id', currentUser.id).eq('room_id', roomIdToDelete);

            // 3. Если мы НЕ были хостом, просто проверяем, не опустела ли комната
            if (!isHost) {
                const { data: remPlayers } = await supabase.from('bunker_players').select('id').eq('room_id', roomIdToDelete);
                if (!remPlayers || remPlayers.length === 0) {
                    await supabase.from('bunker_rooms').delete().eq('id', roomIdToDelete);
                }
            }
        }

        // Очистка локального состояния
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
    });
};



// === ПРОВЕРКА АКТИВНОЙ СЕССИИ (РЕКОННЕКТ) ===
async function checkExistingRoom() {
    // 1. Ищем игрока в таблице bunker_players
    const { data: player } = await supabase
        .from('bunker_players')
        .select('room_id')
        .eq('user_id', currentUser.id)
        .single();

    if (player && player.room_id) {
        // 2. Игрок числится в комнате. Проверяем, жива ли сама комната.
        const { data: room } = await supabase
            .from('bunker_rooms')
            .select('*')
            .eq('id', player.room_id)
            .single();

        if (room && (room.status === 'waiting' || room.status === 'playing')) {
            // 3. Комната активна! Восстанавливаем локальные переменные
            currentRoomId = room.id;
            currentRoomCode = room.room_code;
            isHost = (room.host_id === currentUser.id);
            isSpectator = false; 

            document.getElementById('current-room-code').textContent = room.room_code;
            
            // Выключаем радар лобби, так как мы уже в игре
            if (lobbyRoomsTimer) clearInterval(lobbyRoomsTimer);

            // Если ты хост и игра еще не началась, показываем кнопку старта
            if (isHost && room.status === 'waiting') {
                document.getElementById('start-game-btn').style.display = 'block';
            }

            // Запускаем пульс, если ты хост
            if (isHost) {
                startHeartbeat();
            }

            // Переводим на экран ожидания
            showScreen('waiting');
            startSync(); 
            
            console.log("Успешное переподключение к комнате:", room.room_code);
        } else {
            // Комната удалена или завершена, чистим "зависшую" запись игрока
            await supabase.from('bunker_players').delete().eq('user_id', currentUser.id);
        }
    }
}

// === ФУНКЦИЯ КИКА ИГРОКА ===
window.kickPlayer = function(playerId) {
    if (!isHost) return;
    
    showConfirm("Точно выгнать этого игрока из лобби?", async () => {
        // Удаляем игрока из базы
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

// === СТАРТ ИГРЫ И ГЕНЕРАЦИЯ КАРТОЧЕК ===
async function startGame() {
    if (!isHost) return;
    startGameBtn.disabled = true;
    startGameBtn.textContent = "ГЕНЕРАЦИЯ...";

    // 1. Получаем всех игроков в комнате
    const { data: players } = await supabase.from('bunker_players').select('id').eq('room_id', currentRoomId);
    
    // 2. Генерируем карточки для каждого игрока
    for (const player of players) {
        const generatedCards = {
            profession: getRandomItem(BUNKER_DATA.professions),
            health: getRandomItem(BUNKER_DATA.health),
            biology: getRandomItem(BUNKER_DATA.biology),
            hobby: getRandomItem(BUNKER_DATA.hobbies),
            phobia: getRandomItem(BUNKER_DATA.phobias),
            baggage: getRandomItem(BUNKER_DATA.baggage),
            fact: getRandomItem(BUNKER_DATA.facts)
        };

        // Сохраняем карточки игрока в БД
        await supabase.from('bunker_players').update({ cards: generatedCards }).eq('id', player.id);
    }

    // 3. Меняем статус комнаты на playing (это запустит игру у всех)
    await supabase.from('bunker_rooms').update({ status: 'playing' }).eq('id', currentRoomId);
    window.playBunkerSFX('start');
}



// === ФУНКЦИЯ ВСКРЫТИЯ КАРТЫ Удалена и заменена на animateAndReveal ниже ===

// ==========================================
// СИСТЕМА ГОЛОСОВАНИЯ
// ==========================================

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
                // Auto end vote
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

// === ЛОГИКА ГОЛОСОВАНИЯ (НОВАЯ) ===

// === УЛУЧШЕННАЯ ЛОГИКА ГОЛОСОВАНИЯ ===

async function startVotingProcess() {
    if (!isHost) return;
    try {
        // 1. Сначала СБРАСЫВАЕМ все старые голоса в базе для этой комнаты
        await supabase.from('bunker_players')
            .update({ voted_for_id: null })
            .eq('room_id', currentRoomId);
            
        // 2. Включаем режим голосования в комнате с таймером 60с
        await supabase.from('bunker_rooms')
            .update({ voting_active: true, votes: { end_time: Date.now() + 60000 } })
            .eq('id', currentRoomId);
            
        window.playBunkerSFX('alarm');
            
        // Принудительно обновляем состояние у хоста
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
        // 1. Получаем ТОЛЬКО одобренных игроков этой комнаты
        const { data: allPlayers, error: pError } = await supabase
            .from('bunker_players')
            .select('user_id, voted_for_id, is_alive, username, join_status')
            .eq('room_id', currentRoomId)
            .eq('join_status', 'approved'); // КРИТИЧЕСКИЙ ФИКС: только одобренные

        if (pError) throw pError;

        // Фильтруем тех, кто реально отдал голос
        const activeVotes = allPlayers.filter(p => p.voted_for_id !== null).map(p => p.voted_for_id);

        // ФИКС: Принудительно закрываем окно у хоста сразу
        document.getElementById('vote-modal').classList.remove('active');

        if (activeVotes.length > 0) {
            // Считаем голоса
            const counts = {};
            activeVotes.forEach(id => counts[id] = (counts[id] || 0) + 1);
            
            // Находим ID того, за кого больше всего голосов
            let loserId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            const loserName = allPlayers.find(p => p.user_id === loserId)?.username || "Игрок";
            
            // 2. Убиваем проигравшего в базе
            await supabase.from('bunker_players')
                .update({ is_alive: false })
                .eq('user_id', loserId)
                .eq('room_id', currentRoomId);
            
            window.playBunkerSFX('kick');
            
            // Считаем сколько живых осталось (среди одобренных)
            const aliveCount = allPlayers.filter(p => p.is_alive && p.user_id !== loserId).length;

            // 3. Определяем статус: если выжил 1 — финиш, иначе продолжаем игру
            const newStatus = aliveCount <= 1 ? 'finished' : 'playing';
            
            // Сбрасываем флаг голосования и обновляем статус комнаты
            await supabase.from('bunker_rooms').update({ 
                status: newStatus, 
                voting_active: false 
            }).eq('id', currentRoomId);

            showAlert(`Голосование завершено! ${loserName} изгнан из бункера.`);
        } else {
            // Если никто не проголосовал — просто закрываем окно
            await supabase.from('bunker_rooms').update({ 
                voting_active: false 
            }).eq('id', currentRoomId);
            showAlert("Никто не проголосовал. Все остаются в бункере.");
        }
    } catch (err) {
        console.error("Критическая ошибка завершения:", err);
        showAlert("Ошибка при завершении голосования. Проверьте права доступа.");
    } finally {
        btn.disabled = false;
        btn.textContent = "ЗАВЕРШИТЬ ГОЛОСОВАНИЕ";
        // Моментально синхронизируем UI
        fetchGameState();
    }
}

// Игрок отдает голос (заменяем старый window.castVote)
window.castVote = async function(targetUserId) {
    if (isSpectator) return;
    const { error } = await supabase
        .from('bunker_players')
        .update({ voted_for_id: targetUserId })
        .eq('user_id', currentUser.id)
        .eq('room_id', currentRoomId);
    
    if (!error) fetchGameState();
};



// === АНИМАЦИЯ БРОСКА КАРТЫ НА СТОЛ ===
window.animateAndReveal = function(cardKey, cardValue, cardElement) {
    showConfirm(`Открыть характеристику "${cardKey}" для всех игроков? Это запустит её в центр стола!`, async () => {
        
        // --- ФИКС СПАМА: Блокируем карту визуально и технически сразу после клика ---
        cardElement.classList.add('revealed');
        cardElement.style.pointerEvents = 'none';
        cardElement.style.cursor = 'not-allowed';
        // -------------------------------------------------------------------------

        const overlay = document.getElementById('card-animation-overlay');
        const cardRect = cardElement.getBoundingClientRect();
        
        // Создаем клон для анимации
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

        // Сохранение в базу
        const { data: me } = await supabase.from('bunker_players').select('revealed_cards').eq('user_id', currentUser.id).eq('room_id', currentRoomId).single();
        let revealed = me.revealed_cards || [];
        revealed.push({ key: cardKey, value: cardValue });
        await supabase.from('bunker_players').update({ revealed_cards: revealed }).eq('user_id', currentUser.id).eq('room_id', currentRoomId);
        
        setTimeout(() => { 
            animCard.remove(); 
            fetchGameState(); // Это перерендерит карточки и окончательно закрепит статус "revealed"
        }, 1200);
    }, 'bunker_skip_reveal_confirm');
};

// === УПРАВЛЕНИЕ ЗАЯВКАМИ ===
window.approvePlayer = async function(playerId) {
    await supabase.from('bunker_players').update({ join_status: 'approved' }).eq('id', playerId);
    fetchGameState(); // Моментально обновляем интерфейс
};

window.rejectPlayer = async function(playerId) {
    await supabase.from('bunker_players').delete().eq('id', playerId);
    fetchGameState();
};

// ==========================================
// СИСТЕМА ФОНОВОЙ МУЗЫКИ (ПЛЕЙЛИСТ)
// ==========================================
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

    // Настройка громкости (5%) и переключения треков
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

    // Обработчик клика по кнопке
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isBunkerMuted = !isBunkerMuted;
        localStorage.setItem('bunker_muted', isBunkerMuted);
        updateMusicUI();
    });

    // Автоплей при первом клике в любом месте экрана (обход блокировки браузеров)
    const unlockAudio = () => {
        if (!isBunkerMuted) {
            bunkerTracks[currentTrackIndex].play().catch(() => {});
        }
        document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);

    updateMusicUI();
}

// Запускаем инициализацию музыки
initBunkerMusic();

// ==========================================
// СИСТЕМА ЗВУКОВЫХ ЭФФЕКТОВ (SFX) И МИКШЕР
// ==========================================
const BUNKER_SFX = {
    start: new Audio('../assets/bunker-start.wav'),
    card: new Audio('../assets/card-throw.wav'),
    alarm: new Audio('../assets/alarm.wav'),
    kick: new Audio('../assets/kick.wav'),
    survive: new Audio('../assets/survive.wav')
};

// Загружаем громкость из памяти или ставим 10% (0.1) по умолчанию
let bunkerSfxVolume = localStorage.getItem('bunker_sfx_vol') !== null 
    ? parseFloat(localStorage.getItem('bunker_sfx_vol')) 
    : 0.1;

// Функция применения громкости
function updateSfxVolume(vol) {
    bunkerSfxVolume = vol;
    Object.values(BUNKER_SFX).forEach(audio => audio.volume = bunkerSfxVolume);
    localStorage.setItem('bunker_sfx_vol', bunkerSfxVolume);
}

// Инициализация микшера
function initSfxMixer() {
    updateSfxVolume(bunkerSfxVolume); // Применяем на старте
    
    const sfxSlider = document.getElementById('bunker-sfx-slider');
    const sfxIcon = document.getElementById('sfx-icon');
    
    if (sfxSlider) {
        sfxSlider.value = bunkerSfxVolume;
        
        // Обновляем иконку при старте
        if (bunkerSfxVolume === 0) {
            sfxIcon.className = 'fas fa-volume-mute';
            sfxIcon.style.color = '#ef4444';
        }
        
        // Слушаем изменения ползунка
        sfxSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            updateSfxVolume(val);
            
            // Меняем иконку, если звук выкрутили в ноль
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

// Функция воспроизведения (учитывает текущую громкость)
window.playBunkerSFX = function(name) {
    if (BUNKER_SFX[name] && bunkerSfxVolume > 0) {
        const sound = BUNKER_SFX[name].cloneNode();
        sound.volume = bunkerSfxVolume;
        sound.play().catch(() => {});
    }
};

// Запускаем микшер
initSfxMixer();
