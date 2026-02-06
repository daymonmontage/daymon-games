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
        progress += 2 + Math.random() * stepMultiplier;
        if (progress > 100) progress = 100;

        barFill.style.width = progress + "%";
        percentEl.textContent = Math.floor(progress) + "%";

        const logChance = isQuickLoad ? 0.1 : 0.8; 
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

        if (progress >= 100) {
            clearInterval(interval);
            sessionStorage.setItem('arcade_loaded', 'true');
            setTimeout(() => { loader.classList.add('fade-out'); }, 200);
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
        if (avatarUrl) avatarEl.innerHTML = `<img src="${avatarUrl}" alt="P1">`;
        creditsEl.textContent = "CREDITS: ∞";
    } else {
        if (lockScreen) lockScreen.classList.add('active');
        
        authUi.classList.remove('logged-in');
        authUi.classList.add('guest');
        
        nameEl.textContent = "ГОСТЬ";
        avatarEl.innerHTML = "?";
        creditsEl.textContent = "ВСТАВЬТЕ МОНЕТУ";
    }
}

function setupHubSound() {
    const muteBtn = document.getElementById('hub-mute-btn');
    let isMuted = localStorage.getItem('arcade_muted') === 'true';

    const updateUI = () => {
        const icon = muteBtn.querySelector('i');
        icon.className = isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
        muteBtn.classList.toggle('muted', isMuted);
        isMuted ? hubMusic.pause() : hubMusic.play().catch(() => {});
    };

    const unlock = () => {
        if (!isMuted) hubMusic.play().then(() => {
            document.removeEventListener('click', unlock);
        }).catch(() => {});
    };

    document.addEventListener('click', unlock);
    muteBtn.onclick = (e) => {
        e.stopPropagation();
        isMuted = !isMuted;
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