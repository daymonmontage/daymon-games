import { CONFIG } from './js/modules/config.js';

const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
let hubMusic = new Audio('assets/hub-b.mp3');
hubMusic.loop = true;
hubMusic.volume = 0.10;

// === ЗАГРУЗЧИК ===
(function preInit() {
    const bootMessages = [
        "INITIALIZING_KERNEL...",
        "LOADING_ASSETS: [################] 100%",
        "DETECTING_GURFIELD_ENTITY... FOUND",
        "CHECKING_PENIS_INTEGRITY... OK",
        "SYNCING_WITH_VOTV_SATELLITE...",
        "DOWNLOADING_RAM... (JUST KIDDING)",
        "LOADING_TEXTURES: MUSTANG.PNG",
        "LOADING_TEXTURES: CAT.PNG",
        "CALIBRATING_FLAPPY_PHYSICS...",
        "CHECKING_USER_PERMISSIONS... ADMIN",
        "SYSTEM_READY."
    ];

    const loader = document.getElementById('arcade-loader');
    const logContainer = document.getElementById('boot-log');
    const barFill = document.getElementById('loader-bar'); 
    const percentEl = document.getElementById('loader-percent');

    if (!loader || !logContainer || !barFill) return;

    const isQuickLoad = sessionStorage.getItem('arcade_loaded');
    let progress = 0;
    let msgIndex = 0;
    const speed = isQuickLoad ? 10 : 30; 
    const stepMultiplier = isQuickLoad ? 20 : 5; 

    const interval = setInterval(() => {
        // Ускоряем прогресс
        progress += (2 + Math.random() * stepMultiplier);
        if (progress > 100) progress = 100;

        if (barFill) barFill.style.width = progress + "%";
        if (percentEl) percentEl.textContent = Math.floor(progress) + "%";

        // Логирование (независимое от прогресс-бара)
        const logChance = isQuickLoad ? 0.4 : 0.8; 
        if (Math.random() < logChance && msgIndex < bootMessages.length) {
            const div = document.createElement('div');
            const text = bootMessages[msgIndex];
            if (text.includes("PENIS")) div.className = 'log-line warn';
            else if (text.includes("ERROR")) div.className = 'log-line err';
            else div.className = 'log-line';
            div.textContent = `> ${text}`;
            logContainer.appendChild(div);
            logContainer.scrollTop = logContainer.scrollHeight;
            msgIndex++;
        }

        // Выход: когда бар полон ИЛИ прошло слишком много времени
        if (progress >= 100) {
            // Если сообщения еще идут, ускоряем их вывод
            if (msgIndex < bootMessages.length) {
                const div = document.createElement('div');
                div.className = 'log-line';
                div.textContent = `> ${bootMessages[msgIndex++]}`;
                logContainer.appendChild(div);
            } else {
                clearInterval(interval);
                setTimeout(() => {
                    loader.style.opacity = '0';
                    setTimeout(() => {
                        loader.style.display = 'none';
                        sessionStorage.setItem('arcade_loaded', 'true');
                    }, 1000);
                }, 500);
            }
        }
    }, speed);
})();

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    const lockScreen = document.getElementById('auth-lock-screen');
    const overlayLoginBtn = document.getElementById('overlay-login-btn');
    const topLogoutBtn = document.getElementById('top-logout-btn');

    // 1. Проверяем сессию
    const [sessionRes, top3Res] = await Promise.all([
        supabase.auth.getSession(),
        loadFlappyTop3()
    ]);

    const session = sessionRes.data.session;

    // 2. Устанавливаем начальное состояние
    if (session) {
        setUiState(true, session.user);
    } else {
        setUiState(false);
    }

    // 3. Слушаем изменения (Вход/Выход)
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            setUiState(true, session.user);
        } else if (event === 'SIGNED_OUT') {
            setUiState(false);
        }
    });

    // 4. Кнопка ВХОДА (на экране блокировки)
    if (overlayLoginBtn) {
        overlayLoginBtn.onclick = async () => {
            await supabase.auth.signInWithOAuth({
                provider: 'discord',
                options: { redirectTo: window.location.href }
            });
        };
    }

    // 5. Кнопка ВЫХОДА (в навбаре)
    if (topLogoutBtn) {
        topLogoutBtn.onclick = async () => {
            await supabase.auth.signOut();
            window.location.reload(); 
        };
    }

    setupHubSound();
    setupLeaderboardModal();
    setupFeedbackModal(); // Инициализация почтового ящика
    setupGlobalSfx();
}

// Единая функция управления состоянием UI
function setUiState(isLoggedIn, user = null) {
    const lockScreen = document.getElementById('auth-lock-screen');
    const authUi = document.getElementById('auth-ui');
    const nameEl = authUi.querySelector('.player-name');
    const avatarEl = authUi.querySelector('.player-avatar');
    const creditsEl = document.getElementById('credits-val');

    if (isLoggedIn && user) {
        if (lockScreen) lockScreen.classList.remove('active');
        
        authUi.classList.remove('guest');
        authUi.classList.add('logged-in');
        
        const meta = user.user_metadata;
        const userName = meta.full_name || meta.name || "PLAYER";
        const avatarUrl = meta.avatar_url;

        nameEl.textContent = userName.toUpperCase();
        
        // Предзаполнение имени в форме обратной связи
        const feedbackNameInput = document.getElementById('feedback-name');
        if (feedbackNameInput) feedbackNameInput.value = userName;
        if (avatarUrl) avatarEl.innerHTML = `<img src="${avatarUrl}" alt="P1">`;
        creditsEl.textContent = "CREDITS: ∞";

        // ВЫЗЫВАЕМ ПРОВЕРКУ ИГРЫ
        checkActiveBunkerGame(user.id); 
    } else {
        if (lockScreen) lockScreen.classList.add('active');
        
        authUi.classList.remove('logged-in');
        authUi.classList.add('guest');
        
        nameEl.textContent = "ГОСТЬ";
        avatarEl.innerHTML = "?";
        creditsEl.textContent = "ВСТАВЬТЕ МОНЕТУ";

        document.getElementById('reconnect-container').style.display = 'none';
    }
}

function setupHubSound() {
    const muteBtn = document.getElementById('hub-mute-btn');
    const volSlider = document.getElementById('hub-volume-slider');
    const volVal = document.getElementById('hub-vol-val');
    
    let isMuted = localStorage.getItem('arcade_muted') === 'true';
    let currentVol = localStorage.getItem('arcade_vol') !== null ? parseFloat(localStorage.getItem('arcade_vol')) : 0.10;

    hubMusic.volume = isMuted ? 0 : currentVol;
    if (volSlider) volSlider.value = currentVol;
    if (volVal) volVal.textContent = Math.round(currentVol * 100) + '%';

    const updateUI = () => {
        const icon = muteBtn.querySelector('i');
        icon.className = isMuted ? 'fas fa-volume-mute' : (currentVol > 0 ? 'fas fa-volume-up' : 'fas fa-volume-mute');
        muteBtn.classList.toggle('muted', isMuted);
        hubMusic.volume = isMuted ? 0 : currentVol;
        if (volSlider) volSlider.value = currentVol;
        if (volVal) volVal.textContent = Math.round(currentVol * 100) + '%';
        
        if (!isMuted && currentVol > 0) {
            hubMusic.play().catch(() => {});
        } else {
            hubMusic.pause();
        }
    };

    if (volSlider) {
        volSlider.addEventListener('input', (e) => {
            currentVol = parseFloat(e.target.value);
            isMuted = currentVol === 0;
            localStorage.setItem('arcade_vol', currentVol);
            localStorage.setItem('arcade_muted', isMuted);
            updateUI();
        });

        // Поддержка колесика мыши
        volSlider.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = 0.05;
            const delta = e.deltaY < 0 ? step : -step;
            currentVol = Math.min(1, Math.max(0, currentVol + delta));
            isMuted = currentVol === 0;
            localStorage.setItem('arcade_vol', currentVol);
            localStorage.setItem('arcade_muted', isMuted);
            updateUI();
        }, { passive: false });
    }

    // Также добавляем поддержку колесика на всю панель управления звуком
    const controlsArea = document.querySelector('.hub-sound-controls');
    if (controlsArea) {
        controlsArea.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = 0.05;
            const delta = e.deltaY < 0 ? step : -step;
            currentVol = Math.min(1, Math.max(0, currentVol + delta));
            isMuted = currentVol === 0;
            localStorage.setItem('arcade_vol', currentVol);
            localStorage.setItem('arcade_muted', isMuted);
            updateUI();
        }, { passive: false });
    }

    const unlock = () => {
        if (!isMuted && currentVol > 0) hubMusic.play().then(() => {
            document.removeEventListener('click', unlock);
        }).catch(() => {});
    };

    document.addEventListener('click', unlock);
    muteBtn.onclick = (e) => {
        e.stopPropagation();
        isMuted = !isMuted;
        if (!isMuted && currentVol === 0) currentVol = 0.1; // Если был 0, ставим дефолт
        localStorage.setItem('arcade_muted', isMuted);
        updateUI();
    };
    updateUI();
}

async function loadFlappyTop3() {
    const container = document.querySelector('#flappy-top-3 .ml-list');
    if (!container) return;

    const { data } = await supabase
        .from('profiles')
        .select('username, flappy_highscore, avatar_url')
        .gt('flappy_highscore', 0)
        .order('flappy_highscore', { ascending: false })
        .limit(3);

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="ml-loading">Нет данных</div>';
        return;
    }

    container.innerHTML = data.map((p, i) => `
        <div class="ml-row">
            <div class="ml-left">
                <span class="ml-rank r-${i+1}">#${i+1}</span>
                <img src="${p.avatar_url || 'assets/avatar.png'}" class="ml-avatar">
                <span class="ml-name">${p.username}</span>
            </div>
            <span class="ml-score">${p.flappy_highscore}</span>
        </div>
    `).join('');
}

function setupLeaderboardModal() {
    const openBtn = document.getElementById('open-hub-lb');
    const modal = document.getElementById('hub-lb-modal');
    const list = document.getElementById('hub-full-list');

    if (!openBtn || !modal) return;

    openBtn.onclick = async () => {
        modal.classList.add('active');
        list.innerHTML = `<div class="lb-loader-wrap"><div class="lb-spinner"></div><div class="lb-loading-text">FETCHING...</div></div>`;

        const { data } = await supabase
            .from('profiles')
            .select('username, flappy_highscore, avatar_url')
            .gt('flappy_highscore', 0)
            .order('flappy_highscore', { ascending: false })
            .limit(50);

        if (data) {
            list.innerHTML = data.map((p, i) => `
                <div class="lb-full-row">
                    <div class="lb-full-left">
                        <span class="lb-full-rank">#${i+1}</span>
                        <img src="${p.avatar_url || 'assets/avatar.png'}" class="lb-full-avatar">
                        <span class="lb-full-name">${p.username}</span>
                    </div>
                    <span class="lb-full-score">${p.flappy_highscore}</span>
                </div>
            `).join('');
        }
    };

    modal.onclick = (e) => {
        if (e.target === modal || e.target.id === 'close-hub-lb') modal.classList.remove('active');
    };
}

function setupGlobalSfx() {
    const sfx = {
        hover: new Audio('assets/hover.wav'),
        click: new Audio('assets/click.wav'),
        whoosh: new Audio('assets/whoosh.wav')
    };

    Object.values(sfx).forEach(s => {
        s.load();
        s.volume = 0.2;
    });

    sfx.click.volume = 0.3;

    const play = (name) => {
        const clone = sfx[name].cloneNode();
        clone.volume = sfx[name].volume;
        clone.play().catch(() => {});
    };

    const selectors = [
        '.game-card',
        '.play-btn',
        '.icon-btn',
        '.back-btn',
        '.discord-btn-large',
        '.details-btn',
        '.close-modal-btn',
        '.ml-row',
        '.logout-icon-btn'
    ];

    document.querySelectorAll(selectors.join(', ')).forEach(el => {
        el.addEventListener('mouseenter', () => play('hover'));
        el.addEventListener('mousedown', () => play('click'));
    });

    document.querySelectorAll('a.play-btn, a.back-btn').forEach(el => {
        el.addEventListener('click', () => play('whoosh'));
    });
}

async function checkActiveBunkerGame(userId) {
    const reconnectBtn = document.getElementById('reconnect-container');
    
    // 1. Ищем игрока в таблице bunker_players
    const { data: player, error: pError } = await supabase
        .from('bunker_players')
        .select('room_id')
        .eq('user_id', userId)
        .maybeSingle();

    if (pError || !player) {
        reconnectBtn.style.display = 'none';
        return;
    }

    // 2. Проверяем, жива ли комната и в каком она статусе
    const { data: room, error: rError } = await supabase
        .from('bunker_rooms')
        .select('status, room_code, last_active')
        .eq('id', player.room_id)
        .maybeSingle();

    // Если игра еще идет или ждет игроков — проверяем на свежесть
    if (room && (room.status === 'waiting' || room.status === 'playing')) {
        const lastActive = new Date(room.last_active);
        const now = new Date();
        const diffInMinutes = (now - lastActive) / 1000 / 60;

        // Если хост не подавал сигналов более 60 минут — считаем комнату мертвой
        if (diffInMinutes < 60) {
            reconnectBtn.style.display = 'block';
            console.log("Найден активный бункер:", room.room_code);
        } else {
            reconnectBtn.style.display = 'none';
        }
    } else {
        reconnectBtn.style.display = 'none';
    }
}

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

    triggerBtn.onclick = () => {
        modal.classList.add('active');
        statusEl.textContent = '';
        statusEl.className = 'feedback-status';
    };

    const closeModal = () => {
        modal.classList.remove('active');
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    form.onsubmit = async (e) => {
        e.preventDefault();
        
        const submitBtn = form.querySelector('.submit-feedback-btn');
        const name = document.getElementById('feedback-name').value;
        const type = form.querySelector('input[name="feedback-type"]:checked').value;
        const message = document.getElementById('feedback-msg').value;

        // Блокировка кнопки
        submitBtn.disabled = true;
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> СИГНАЛ УХОДИТ...';
        statusEl.textContent = '';

        const text = `📬 *НОВОЕ ПОСЛАНИЕ!*\n\n👤 *От:* ${name}\n🏷️ *Тип:* ${type}\n📝 *Сообщение:* ${message}\n🌐 *Источник:* Arcade Hub`;

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
                statusEl.textContent = '✅ ПОСЛАНИЕ ДОСТАВЛЕНО В БУНКЕР!';
                statusEl.className = 'feedback-status success';
                form.reset();
                
                // Если залогинен, возвращаем имя
                const { data: { session } } = await supabase.auth.getSession();
                if (session && session.user) {
                    const userName = session.user.user_metadata.full_name || session.user.user_metadata.name || "";
                    document.getElementById('feedback-name').value = userName;
                }

                setTimeout(closeModal, 2000);
            } else {
                throw new Error('Signal lost');
            }
        } catch (err) {
            statusEl.textContent = '❌ ОШИБКА СВЯЗИ. ПОПРОБУЙ ЕЩЕ РАЗ.';
            statusEl.className = 'feedback-status error';
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    };
}