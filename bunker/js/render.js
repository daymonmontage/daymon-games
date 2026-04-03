// === ОТРИСОВКА СПИСКА ИГРОКОВ (ОЖИДАНИЕ + КРУГЛЫЙ СТОЛ) ===
export function renderPlayersList(players, hostId, status, currentUserId, isHost, votingActive = false) {
    const playersListEl = document.getElementById('players-list');
    const gamePlayersListEl = document.getElementById('game-players-list');

    if (status === 'waiting') {
        const html = players.map(p => {
            const isMe = p.user_id === currentUserId;
            const isRoomHost = p.user_id === hostId;
            const canKick = isHost && !isMe;

            return `
                <div class="player-item" data-id="${p.id}">
                    <div class="player-main">
                        <img src="${p.avatar_url}" class="player-avatar">
                        <span class="player-name" style="${isMe ? 'color: #10b981;' : ''}">${p.username}</span>
                        ${isRoomHost ? '<i class="fas fa-crown host-icon"></i>' : ''}
                        ${canKick ? `<button class="kick-btn" onclick="window.kickPlayer('${p.id}')" title="Выгнать"><i class="fas fa-times"></i></button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        if (playersListEl && playersListEl.innerHTML !== html) playersListEl.innerHTML = html;

    } else if (status === 'playing') {
        const total = players.length;
        const isDesktop = window.innerWidth >= 1024;
        const radius = isDesktop ? 220 : 130; 
        const angleStep = 360 / total;

        let centerProps = 'table-center-prop';
        let centerInner = '<i class="fas fa-biohazard" style="font-size: 2rem; opacity: 0.5;"></i>';
        if (votingActive) {
            centerProps += ' voting';
            const aliveCount = players.filter(p => p.is_alive).length;
            const votedCount = players.filter(p => p.voted_for_id !== null).length;
            
            // Generate current time string to avoid flickering
            let timeStr = "01:00";
            if (window.currentVoteEndTime) {
                const remain = Math.max(0, window.currentVoteEndTime - Date.now());
                const secs = Math.ceil(remain / 1000);
                timeStr = `00:${secs < 10 ? '0'+secs : secs}`;
            }

            centerInner = `
                <div id="vote-timer-display" style="font-size: 1.8rem; color: #ef4444; font-family: var(--font-pixel); text-shadow: 0 0 10px rgba(239, 68, 68, 0.8); margin-bottom: 8px;">${timeStr}</div>
                <div class="hologram-text" style="font-size: 0.55rem; letter-spacing: 2px;">ГОЛОСОВАНИЕ</div>
                <div class="hologram-stats" style="font-size: 0.6rem; color: #10b981; font-family: var(--font-pixel); margin-top: 5px;">${votedCount} / ${aliveCount} ГОЛОСОВ</div>
            `;
        }
        let html = `<div class="${centerProps}">${centerInner}</div>`;

        const getCardType = (label) => {
            const types = { 'Профессия': 'profession', 'Биология': 'biology', 'Здоровье': 'health', 'Хобби': 'trait', 'Фобия': 'trait', 'Багаж': 'equipment', 'Факт': 'trait' };
            return types[label] || 'default';
        };

        const meObj = players.find(pl => pl.user_id === currentUserId);
        const amIAlive = meObj ? meObj.is_alive : false;
        const myVote = meObj ? meObj.voted_for_id : null;

        html += players.map((p, i) => {
            const isMe = p.user_id === currentUserId;
            const isRoomHost = p.user_id === hostId;
            const isAlive = p.is_alive;
            let deadClass = isAlive ? '' : 'dead';
            const hasVoted = p.voted_for_id !== null;
            
            // Interactive voting logic
            const canBeVoted = votingActive && amIAlive && !myVote && isAlive;
            if (canBeVoted) deadClass += ' votable';
            
            const onclickAttr = canBeVoted ? `onclick="window.castVote('${p.user_id}')"` : '';
            
            const angle = angleStep * i; 
            const transformStyle = `transform: translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px) rotate(-${angle}deg);`;

            let revealedHtml = '';
            if (p.revealed_cards && p.revealed_cards.length > 0) {
                const total = p.revealed_cards.length;
                revealedHtml = '<div class="seat-revealed-cards-radial">' + 
                    p.revealed_cards.map((c, idx) => {
                        // Выстраиваем "веером" (нимбом) сверху и по бокам аватара
                        // Никнейм находится внизу (угол 0 градусов), поэтому мы вообще не используем нижнюю часть.
                        // Угол 180 - это ровно над головой. Угол 90 - слева, Угол 270 - справа.
                        let cardAngle;
                        if (total === 1) {
                            cardAngle = 180; // Ровно сверху
                        } else {
                            const maxSpan = 220; // Максимальный разлет веера (не доходит до низа)
                            let span = (total - 1) * 45; // Шаг между картами
                            if (span > maxSpan) span = maxSpan; // Сжимаем веер, если характеристик очень много
                            
                            const startAngle = 180 - (span / 2);
                            const step = span / (total - 1);
                            cardAngle = startAngle + (step * idx);
                        }

                        // Чуть увеличиваем радиус, чтобы не цеплять сильно длинные ники по бокам
                        const cardRadius = total > 4 ? 80 : 70; 

                        return `
                        <div class="mini-board-card radial-card type-${getCardType(c.key)}" style="--card-angle: ${cardAngle}deg; --card-radius: ${cardRadius}px;">
                            <div class="mbc-key">${c.key}</div>
                            <div class="mbc-val">${c.value}</div>
                        </div>
                        `;
                    }).join('') + 
                '</div>';
            }

            let badges = '';
            if (isRoomHost) badges += '<i class="fas fa-crown" style="color:#fbbf24; font-size:0.7rem;"></i>';
            if (!isAlive) badges += '<i class="fas fa-skull" style="color:#ef4444; font-size:0.7rem;"></i>';
            if (votingActive && hasVoted) badges += '<i class="fas fa-check-circle" style="color:#10b981; font-size:0.7rem;" title="Проголосовал"></i>';

            let avatarBorder = isMe ? 'border-color:#10b981;' : '';
            if (hasVoted) avatarBorder += 'border-color:#10b981;';

            return `
                <div class="player-seat ${deadClass}" style="${transformStyle}" ${onclickAttr}>
                    <div class="seat-avatar-wrap">
                        <img src="${p.avatar_url}" class="player-avatar" style="${avatarBorder}">
                        ${badges ? `<div class="seat-badges">${badges}</div>` : ''}
                    </div>
                    <span class="player-name" style="${isMe ? 'color:#10b981;' : ''}">${p.username}</span>
                    ${revealedHtml}
                </div>
            `;
        }).join('');

        if (gamePlayersListEl && gamePlayersListEl.innerHTML !== html) gamePlayersListEl.innerHTML = html;
    }
}

// === ОТРИСОВКА МОИХ КАРТОЧЕК ===
export function renderMyCards(players, currentUserId) {
    const myCardsContainer = document.getElementById('my-cards');
    const me = players.find(p => p.user_id === currentUserId);
    if (!me || !me.cards) return;

    const c = me.cards;
    const revealed = me.revealed_cards || [];
    const isAlive = me.is_alive !== false;

    const cardConfig = [
        { key: 'profession', label: 'Профессия', type: 'profession', icon: 'fa-user-tie' },
        { key: 'biology', label: 'Биология', type: 'biology', icon: 'fa-dna' },
        { key: 'health', label: 'Здоровье', type: 'health', icon: 'fa-heartbeat' },
        { key: 'hobby', label: 'Хобби', type: 'trait', icon: 'fa-gamepad' },
        { key: 'phobia', label: 'Фобия', type: 'trait', icon: 'fa-ghost' },
        { key: 'baggage', label: 'Багаж', type: 'equipment', icon: 'fa-briefcase' },
        { key: 'fact', label: 'Факт', type: 'trait', icon: 'fa-info-circle' }
    ];

    let html = cardConfig.map(cfg => {
        const value = c[cfg.key];
        const isRevealed = revealed.some(r => r.key === cfg.label);

        return `
            <div class="bunker-card type-${cfg.type} ${isRevealed ? 'revealed' : ''} ${!isAlive ? 'disabled' : ''}" 
                 onclick="${!isRevealed && isAlive ? `window.animateAndReveal('${cfg.label}', '${value}', this)` : ''}"
                 onmousemove="window.applyCard3D(event, this)"
                 onmouseleave="window.removeCard3D(this)">
                
                <div class="card-key"><i class="fas ${cfg.icon}"></i> ${cfg.label}</div>
                <div class="card-value">${value}</div> ${!isRevealed && isAlive ? '<div class="card-action-hint">ОТКРЫТЬ <i class="fas fa-eye"></i></div>' : ''}
            </div>
        `;
    }).join('');

    if (!isAlive) {
        html = `<div style="color: #ef4444; font-family: var(--font-pixel); font-size: 0.8rem; margin-bottom: 15px; border: 1px solid #ef4444; padding: 10px; background: rgba(239, 68, 68, 0.1);">ВЫ ИЗГНАНЫ ИЗ БУНКЕРА 💀</div>` + html;
    }

    if (myCardsContainer && myCardsContainer.innerHTML !== html) {
        myCardsContainer.innerHTML = html;
    }
}

// === ОТРИСОВКА ОКНА ГОЛОСОВАНИЯ ===
export function renderVoteOptions(players, currentUserId, isHost, isSpectator) {
    const me = players.find(p => p.user_id === currentUserId);
    const myVote = me ? me.voted_for_id : null;
    const amIAlive = me ? me.is_alive : false;

    let html = '';
    const voteOptionsContainer = document.getElementById('vote-options');
    
    if (isSpectator) {
        html = '<p style="color:#fbbf24; font-family: var(--font-pixel); font-size: 0.7rem;">РЕЖИМ НАБЛЮДАТЕЛЯ.</p>';
    } else if (!amIAlive) {
        html = '<p style="color:#ef4444; font-family: var(--font-pixel); font-size: 0.7rem;">ВЫ ИЗГНАНЫ 💀</p>';
    } else {
        // Показываем только ЖИВЫХ игроков для выбора
        players.filter(p => p.is_alive).forEach(p => {
            const isSelected = myVote === p.user_id ? 'selected' : '';
            html += `<button class="vote-btn ${isSelected}" onclick="window.castVote('${p.user_id}')" ${myVote ? 'disabled' : ''}>${p.username}</button>`;
        });
    }
    
    if (voteOptionsContainer) voteOptionsContainer.innerHTML = html;

    // Статистика для хоста/зрителя
    if (isHost || isSpectator) {
        const endBtn = document.getElementById('end-vote-btn');
        if (isHost && endBtn) endBtn.style.display = 'block';
        
        const alivePlayers = players.filter(p => p.is_alive);
        const votesCount = players.filter(p => p.voted_for_id !== null).length;
        const statusEl = document.getElementById('vote-status');
        if (statusEl) statusEl.textContent = `Проголосовало: ${votesCount} из ${alivePlayers.length}`;
    }
}
