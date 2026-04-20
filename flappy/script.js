import { CONFIG } from '../js/modules/config.js';

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_KEY = CONFIG.SUPABASE_KEY;

const imgBirdFlap = new Image(); imgBirdFlap.src = 'assets/gorilla-flap.png';
const imgBirdGlide = new Image(); imgBirdGlide.src = 'assets/gorilla-glide.png';
const imgPipeTop = new Image(); imgPipeTop.src = 'assets/daymon-top.png';
const imgPipeBot = new Image(); imgPipeBot.src = 'assets/daymon-bottom.png';
const imgCity = new Image(); imgCity.src = 'assets/city.png';

const sfxFlap = new Audio('../assets/jump.wav');
const sfxScore = new Audio('../assets/coin.wav');
const sfxHit = new Audio('../assets/explosion.wav');
const bgMusic = new Audio('assets/music.wav');
bgMusic.loop = true;

sfxFlap.load();
sfxScore.load();
sfxHit.load()

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const wrapper = document.querySelector('.arcade-wrapper');
const readyScreen = document.getElementById('get-ready-screen');
const pauseScreen = document.getElementById('pause-screen');

let frames = 0;
let score = 0;
let highScore = 0;
let gamePlaying = false;
let gameReady = false;
let gamePaused = false;
let baseSpeed = 3.0;

let musicVolume = localStorage.getItem('flappy_music_vol') !== null ? parseFloat(localStorage.getItem('flappy_music_vol')) : 0.3;
let sfxVolume = localStorage.getItem('flappy_sfx_vol') !== null ? parseFloat(localStorage.getItem('flappy_sfx_vol')) : 0.5;
let lastMusicVol = musicVolume > 0 ? musicVolume : 0.3;
let lastSfxVol = sfxVolume > 0 ? sfxVolume : 0.5;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentUser = null;

function initVolumeControls() {
    const musicSlider = document.getElementById('volume-music');
    const sfxSlider = document.getElementById('volume-sfx');
    const musicIcon = document.getElementById('mute-music');
    const sfxIcon = document.getElementById('mute-sfx');

    musicSlider.value = musicVolume;
    sfxSlider.value = sfxVolume;
    bgMusic.volume = musicVolume;
    updateMuteIcons();

    musicSlider.addEventListener('input', (e) => {
        musicVolume = parseFloat(e.target.value);
        bgMusic.volume = musicVolume;
        if (musicVolume > 0) lastMusicVol = musicVolume;
        localStorage.setItem('flappy_music_vol', musicVolume);
        updateMuteIcons();
    });

    // Колесико мыши для музыки
    musicSlider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = 0.05;
        const delta = e.deltaY < 0 ? step : -step;
        musicVolume = Math.min(1, Math.max(0, musicVolume + delta));
        musicSlider.value = musicVolume;
        bgMusic.volume = musicVolume;
        if (musicVolume > 0) lastMusicVol = musicVolume;
        localStorage.setItem('flappy_music_vol', musicVolume);
        updateMuteIcons();
    }, { passive: false });

    sfxSlider.addEventListener('input', (e) => {
        sfxVolume = parseFloat(e.target.value);
        if (sfxVolume > 0) lastSfxVol = sfxVolume;
        localStorage.setItem('flappy_sfx_vol', sfxVolume);
        updateMuteIcons();
    });

    // Колесико мыши для SFX
    sfxSlider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = 0.05;
        const delta = e.deltaY < 0 ? step : -step;
        sfxVolume = Math.min(1, Math.max(0, sfxVolume + delta));
        sfxSlider.value = sfxVolume;
        if (sfxVolume > 0) lastSfxVol = sfxVolume;
        localStorage.setItem('flappy_sfx_vol', sfxVolume);
        updateMuteIcons();
    }, { passive: false });

    musicIcon.addEventListener('click', () => {
        if (musicVolume > 0) {
            lastMusicVol = musicVolume;
            musicVolume = 0;
        } else {
            musicVolume = lastMusicVol;
        }
        musicSlider.value = musicVolume;
        bgMusic.volume = musicVolume;
        localStorage.setItem('flappy_music_vol', musicVolume);
        updateMuteIcons();
    });

    sfxIcon.addEventListener('click', () => {
        if (sfxVolume > 0) {
            lastSfxVol = sfxVolume;
            sfxVolume = 0;
        } else {
            sfxVolume = lastSfxVol;
        }
        sfxSlider.value = sfxVolume;
        localStorage.setItem('flappy_sfx_vol', sfxVolume);
        updateMuteIcons();
    });
}

function updateMuteIcons() {
    const musicIcon = document.getElementById('mute-music');
    const sfxIcon = document.getElementById('mute-sfx');
    if (musicVolume <= 0) musicIcon.classList.add('is-muted');
    else musicIcon.classList.remove('is-muted');
    if (sfxVolume <= 0) sfxIcon.className = 'fas fa-volume-mute is-muted';
    else sfxIcon.className = 'fas fa-volume-up';
}

function playSFX(audio, baseVol = 1) {
    if (sfxVolume <= 0) return;
    const sound = audio.cloneNode();
    sound.volume = sfxVolume * baseVol;
    sound.play().catch(() => {});
}

// === PAUSE LOGIC ===
function setPause(state) {
    if (!gamePlaying || gameReady) return; // Пауза работает только во время активной игры

    gamePaused = state;
    if (gamePaused) {
        pauseScreen.classList.add('active');
        bgMusic.pause();
    } else {
        pauseScreen.classList.remove('active');
        if (musicVolume > 0) bgMusic.play().catch(() => {});
    }
}

// Авто-пауза при потере фокуса
window.addEventListener('blur', () => setPause(true));
document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPause(true);
});

const background = {
    cityX: 0,
    floorX: 0,
    stars: [],
    initStars: function() {
        this.stars = [];
        for (let i = 0; i < 30; i++) {
            this.stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * (canvas.height / 2),
                size: Math.random() * 2 + 0.5,
                speed: Math.random() * 0.2 + 0.1
            });
        }
    },
    draw: function() {
        let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, '#0f0c29');
        grad.addColorStop(1, '#24243e');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (this.stars.length === 0) this.initStars();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        this.stars.forEach(star => {
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            ctx.fill();
            if (gamePlaying && !gamePaused) {
                star.x -= star.speed;
                if (star.x < 0) star.x = canvas.width;
            }
        });

        if (imgCity.complete) {
            let h = canvas.height * 0.6;
            let w = h * (imgCity.width / imgCity.height);
            let y = canvas.height - 100 - h + 20;
            ctx.drawImage(imgCity, this.cityX, y, w, h);
            ctx.drawImage(imgCity, this.cityX + w, y, w, h);
            if (w < canvas.width) ctx.drawImage(imgCity, this.cityX + w * 2, y, w, h);
            if (gamePlaying && !gamePaused) {
                this.cityX -= 0.5;
                if (this.cityX <= -w) this.cityX = 0;
            }
        }

        let floorH = 100;
        let floorY = canvas.height - floorH;
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, floorY, canvas.width, floorH);
        ctx.beginPath();
        ctx.moveTo(0, floorY);
        ctx.lineTo(canvas.width, floorY);
        ctx.strokeStyle = '#d946ef';
        ctx.lineWidth = 4;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#d946ef';
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.lineWidth = 2;
        let gap = 40;
        let offset = this.floorX % gap;
        for (let x = offset; x < canvas.width; x += gap) {
            ctx.beginPath();
            ctx.moveTo(x, floorY);
            ctx.lineTo(x - 20, canvas.height);
            ctx.stroke();
        }
        if (gamePlaying && !gamePaused) this.floorX -= pipes.dx;
    }
};

const bird = {
    x: 50, y: 150, w: 85, h: 85, velocity: 0, gravity: 0.25, jump: 4.6,
    draw: function() {
        let currentImg = (this.velocity < 0) ? imgBirdFlap : imgBirdGlide;
        if (currentImg.complete && currentImg.naturalWidth !== 0) {
            ctx.drawImage(currentImg, this.x, this.y, this.w, this.h);
        }
    },
    update: function() {
        if (gamePlaying && !gamePaused) {
            this.velocity += this.gravity;
            this.y += this.velocity;
            if (this.y + this.h >= canvas.height - 100 || this.y < 0) gameOver();
        } else if (!gamePlaying) {
            this.y = (canvas.height / 2) - 50 + Math.sin(frames * 0.05) * 10;
        }
    },
    flap: function() {
        this.velocity = -this.jump;
        playSFX(sfxFlap, 0.6);
    }
};

const pipes = {
    items: [], w: 80, gap: 240, dx: baseSpeed,
    draw: function() {
        for (let i = 0; i < this.items.length; i++) {
            let p = this.items[i];
            if (imgPipeTop.complete) ctx.drawImage(imgPipeTop, p.x, p.y, this.w, p.h);
            let bottomY = p.y + p.h + this.gap;
            let bottomH = canvas.height - bottomY - 100;
            if (imgPipeBot.complete) ctx.drawImage(imgPipeBot, p.x, bottomY, this.w, bottomH);
        }
    },
    update: function() {
        if (!gamePlaying || gamePaused) return;
        const spawnRate = Math.floor(400 / this.dx);
        if (frames % spawnRate === 0) {
            let maxH = canvas.height - this.gap - 200;
            let h = Math.floor(Math.random() * (maxH - 50) + 50);
            this.items.push({ x: canvas.width, y: 0, h: h, passed: false });
        }
        for (let i = 0; i < this.items.length; i++) {
            let p = this.items[i];
            p.x -= this.dx;
            let hitX = bird.x + 20; let hitY = bird.y + 20;
            let hitW = bird.w - 40; let hitH = bird.h - 40;
            if (hitX + hitW > p.x && hitX < p.x + this.w) {
                if (hitY < p.y + p.h || hitY + hitH > p.y + p.h + this.gap) gameOver();
            }
            if (p.x + this.w < bird.x && !p.passed) {
                score++;
                document.getElementById('score').innerText = score;
                p.passed = true;
                playSFX(sfxScore, 0.8);
                if (score % 5 === 0) this.dx += 0.2;
            }
            if (p.x + this.w < -100) { this.items.shift(); i--; }
        }
    }
};

function resize() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    background.initStars();
    const scale = Math.min(Math.max(canvas.height / 800, 0.6), 1.5);
    bird.gravity = 0.45 * scale;
    bird.jump = 9.5 * scale;
    pipes.gap = 260 * scale;
    pipes.dx = baseSpeed * scale;
    if (!gamePlaying && !gameReady) bird.y = (canvas.height / 2) - 50;
}

function loop() {
    background.draw();
    pipes.draw();
    pipes.update();
    bird.draw();
    bird.update();
    frames++;
    requestAnimationFrame(loop);
}

function action() {
    if (gamePaused) {
        setPause(false);
        return;
    }
    if (gameReady) {
        gameReady = false;
        gamePlaying = true;
        readyScreen.classList.remove('active');
        bird.flap();
        return;
    }
    if (gamePlaying) bird.flap();
}

function startGame() {
    if (document.activeElement) document.activeElement.blur();
    resize();
    gamePlaying = false;
    gameReady = true;
    gamePaused = false;
    if (musicVolume > 0) {
        bgMusic.currentTime = 0;
        bgMusic.play().catch(() => {});
    }
    score = 0; frames = 0; pipes.items = [];
    const scale = Math.min(Math.max(canvas.height / 800, 0.6), 1.5);
    pipes.dx = baseSpeed * scale;
    bird.y = canvas.height / 2; bird.velocity = 0;
    document.getElementById('score').innerText = '0';
    document.getElementById('start-screen').classList.remove('active');
    document.getElementById('game-over-screen').classList.remove('active');
    pauseScreen.classList.remove('active');
    readyScreen.classList.add('active');
    if (wrapper) wrapper.classList.add('playing');
}

function gameOver() {
    if (!gamePlaying) return;
    gamePlaying = false;
    gameReady = false;
    gamePaused = false;
    playSFX(sfxHit, 1);
    bgMusic.pause();
    document.getElementById('final-score').innerText = score;
    document.getElementById('game-over-screen').classList.add('active');
    if (score > highScore) {
        highScore = score;
        document.getElementById('new-record-msg').style.display = 'block';
        saveHighscore(highScore);
    } else {
        document.getElementById('new-record-msg').style.display = 'none';
    }
    document.getElementById('final-best').innerText = highScore;
    document.getElementById('best-score').innerText = highScore;
    if (wrapper) wrapper.classList.remove('playing');
}

async function initAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        updateProfileOnLogin();
        loadHighscore();
    } else {
        document.getElementById('best-score').innerText = 'Гость';
    }
}

async function updateProfileOnLogin() {
    if (!currentUser) return;
    const meta = currentUser.user_metadata;
    await supabase.from('profiles').update({
        username: meta.full_name || meta.name,
        avatar_url: meta.avatar_url
    }).eq('id', currentUser.id);
}

async function loadHighscore() {
    if (!currentUser) return;
    const { data } = await supabase.from('profiles').select('flappy_highscore').eq('id', currentUser.id).single();
    if (data) {
        highScore = data.flappy_highscore || 0;
        document.getElementById('best-score').innerText = highScore;
    }
}

async function saveHighscore(newScore) {
    if (!currentUser) return;
    const meta = currentUser.user_metadata;
    await supabase.from('profiles').update({
        flappy_highscore: newScore,
        username: meta.full_name || meta.name,
        avatar_url: meta.avatar_url
    }).eq('id', currentUser.id);
}

async function openLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    document.getElementById('leaderboard-screen').classList.add('active');
    list.innerHTML = 'Загрузка...';
    const { data } = await supabase.from('profiles').select('username, flappy_highscore, avatar_url').gt('flappy_highscore', 0).order('flappy_highscore', { ascending: false }).limit(20);
    if (!data || data.length === 0) {
        list.innerHTML = 'Пусто...';
        return;
    }
    let html = '';
    data.forEach((p, i) => {
        let isMe = currentUser && (p.username === (currentUser.user_metadata.full_name || currentUser.user_metadata.name));
        html += `<div class="lb-item" style="${isMe ? 'border:1px solid #3b82f6' : ''}"><div class="lb-left"><span class="lb-rank">#${i + 1}</span><img src="${p.avatar_url}" class="lb-avatar"><span class="lb-name">${p.username}</span></div><span class="lb-score">${p.flappy_highscore}</span></div>`;
    });
    list.innerHTML = html;
}

function closeLeaderboard() {
    document.getElementById('leaderboard-screen').classList.remove('active');
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        action();
    } else if (gameReady || gamePaused) {
        action();
    }
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    action();
});

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    action();
});

readyScreen.addEventListener('mousedown', (e) => {
    if (gameReady) {
        e.preventDefault();
        action();
    }
});

pauseScreen.addEventListener('mousedown', (e) => {
    if (gamePaused) {
        e.preventDefault();
        action();
    }
});

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
document.getElementById('leaderboard-btn').addEventListener('click', openLeaderboard);
document.getElementById('leaderboard-btn-over').addEventListener('click', openLeaderboard);
document.getElementById('close-lb-btn').addEventListener('click', closeLeaderboard);

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

initVolumeControls();
initAuth();
resize();
loop();