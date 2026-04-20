
export function renderPlayersList(players, hostId, status, currentUserId, isHost, votingActive = false, presenceIds = new Set()) {
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
        
        let tableWidth = 320;
        if (gamePlayersListEl && gamePlayersListEl.offsetWidth > 0) {
            tableWidth = gamePlayersListEl.offsetWidth;
        } else {
            
            tableWidth = Math.min(window.innerWidth * 0.9, window.innerWidth >= 1024 ? 550 : 400);
        }
        
        const isMobile = window.innerWidth < 480;
        const isTablet = window.innerWidth < 1024;
        
        const avatarSize = isMobile ? 35 : (isTablet ? 45 : 90);
        const radiusAdjustment = isMobile ? 10 : (isTablet ? 15 : 20);
        const radius = Math.max(60, (tableWidth / 2) - radiusAdjustment);
        
        const angleStep = 360 / total;

        let centerProps = 'table-center-prop';
        let centerInner = '<i class="fas fa-biohazard" style="font-size: 2rem; opacity: 0.5;"></i>';
        if (votingActive) {
            centerProps += ' voting';
            const aliveCount = players.filter(p => p.is_alive).length;
            const votedCount = players.filter(p => p.voted_for_id !== null).length;
            
            
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
            const types = { 'Профессия': 'profession', 'Биология': 'biology', 'Телосложение': 'body', 'Характер': 'character', 'Привычка': 'habit', 'Здоровье': 'health', 'Хобби': 'trait', 'Фобия': 'trait', 'Багаж': 'equipment', 'Факт': 'trait', 'Спецуха': 'special' };
            return types[label] || 'default';
        };

        const meObj = players.find(pl => pl.user_id === currentUserId);
        const amIAlive = meObj ? meObj.is_alive : false;
        const myVote = meObj ? meObj.voted_for_id : null;

        html += players.map((p, i) => {
            const isMe = p.user_id === currentUserId;
            const isRoomHost = p.user_id === hostId;
            const isAlive = p.is_alive;
            const isOnline = presenceIds.has(p.user_id);
            
            let deadClass = isAlive ? '' : 'dead';
            if (!isOnline && status === 'playing') deadClass += ' away'; 

            const hasVoted = p.voted_for_id !== null;
            
            
            const canBeVoted = votingActive && amIAlive && !myVote && isAlive;
            const isTargeting = window.pendingSpecialAction != null && amIAlive; 
            
            
            const canBeTargeted = isTargeting && window.pendingSpecialAction.targetRequired; 
            
            if (canBeVoted) deadClass += ' votable';
            if (canBeTargeted) deadClass += ' targetable'; 
            
            // 1. Логика клика по игроку
            let onclickAttr = `onclick="window.openDossier('${p.user_id}')"`; // По умолчанию открываем досье
            if (canBeVoted) {
                onclickAttr = `onclick="window.castVote('${p.user_id}')"`; // Если идет голосование
            } else if (canBeTargeted) {
                onclickAttr = `onclick="window.executeSpecialAction('${p.user_id}')"`; // Если применяем спецуху
            }
            
            const angle = angleStep * i; 
            const transformStyle = `transform: translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px) rotate(-${angle}deg);`;

            // 2. Генерация цветных точек вместо огромных карт
            let revealedHtml = '';
            if (p.revealed_cards && p.revealed_cards.length > 0) {
                revealedHtml = '<div class="seat-revealed-dots">' + 
                    p.revealed_cards.map(c => {
                        const type = getCardType(c.key);
                        return `<div class="dot-indicator dot-${type}" title="${c.key}"></div>`;
                    }).join('') + 
                '</div>';
            }

            let badges = '';
            if (isRoomHost) badges += '<i class="fas fa-crown" style="color:#fbbf24; font-size:0.7rem;"></i>';
            if (p.has_immunity) badges += '<i class="fas fa-shield-alt" style="color:#3b82f6; font-size:0.7rem;" title="ИММУНИТЕТ"></i>';
            if (!isAlive) badges += '<i class="fas fa-skull" style="color:#ef4444; font-size:0.7rem;"></i>';
            if (votingActive && hasVoted) badges += '<i class="fas fa-check-circle" style="color:#10b981; font-size:0.7rem;" title="Проголосовал"></i>';

            let avatarBorder = isMe ? 'border-color:#10b981;' : '';
            if (hasVoted) avatarBorder += 'border-color:#10b981;';

            return `
                <div class="player-seat ${deadClass}" data-user-id="${p.user_id}" style="${transformStyle}" ${onclickAttr}>
                    <div class="seat-avatar-wrap">
                        <img src="${p.avatar_url}" class="player-avatar" style="${avatarBorder}">
                        ${!isOnline && status === 'playing' ? '<i class="fas fa-door-open left-icon" title="Игрок покинул бункер"></i>' : ''}
                        ${badges ? `<div class="seat-badges">${badges}</div>` : ''}
                        
                        <!-- ПАНЕЛЬ СОЦИАЛЬНОГО ВЗАИМОДЕЙСТВИЯ -->
                        <div class="seat-social-actions">
                            <button class="social-btn dossier-btn" onclick="event.stopPropagation(); window.openDossier('${p.user_id}')" title="Открыть досье">
                                <i class="fas fa-id-badge"></i>
                            </button>
                            <button class="social-btn whisper-btn" onclick="event.stopPropagation(); window.setWhisper('${p.username}')" title="Шепнуть">
                                <i class="fas fa-comment-dots"></i>
                            </button>
                            <button class="social-btn reaction-btn" onclick="event.stopPropagation(); window.toggleReactionPicker('${p.user_id}', this)" title="Реакция">
                                <i class="fas fa-smile"></i>
                            </button>
                        </div>
                    </div>
                    <span class="player-name" style="${isMe ? 'color:#10b981;' : ''}">${p.username}</span>
                    ${revealedHtml}
                </div>
            `;
        }).join('');

        if (gamePlayersListEl && gamePlayersListEl.innerHTML !== html) gamePlayersListEl.innerHTML = html;

        // --- ГЕНЕРАЦИЯ СВОДНОЙ ТАБЛИЦЫ ДАННЫХ ---
        const dataTableEl = document.getElementById('game-data-table');
        if (dataTableEl) {
            const columns = ['Профессия', 'Биология', 'Телосложение', 'Характер', 'Привычка', 'Здоровье', 'Хобби', 'Фобия', 'Багаж', 'Факт', 'Спецуха'];
            
            let tableHtml = '<table class="bunker-data-table"><thead><tr><th>ИГРОК</th>';
            columns.forEach(col => tableHtml += `<th>${col}</th>`);
            tableHtml += '</tr></thead><tbody>';
            
            players.forEach(p => {
                const isAlive = p.is_alive;
                const deadClass = isAlive ? '' : 'dead';
                const isMe = p.user_id === currentUserId;
                const nameColor = isMe ? '#10b981' : '#fff';
                
                // Шапка строки (Игрок)
                tableHtml += `<tr class="${deadClass}">
                    <td style="position: sticky; left: 0; background: ${isAlive ? '#13131a' : '#1a1010'}; z-index: 5; border-right: 1px solid rgba(255,255,255,0.1);">
                        <div class="td-player">
                            <img src="${p.avatar_url}" style="${isMe ? 'border-color: #10b981;' : ''}">
                            <span style="color: ${nameColor}">${p.username}</span>
                            ${!isAlive ? '<i class="fas fa-skull" style="color:#ef4444; font-size:0.8rem;"></i>' : ''}
                            ${p.has_immunity ? '<i class="fas fa-shield-alt" style="color:#3b82f6; font-size:0.8rem;"></i>' : ''}
                        </div>
                    </td>`;
                
                // Собираем вскрытые карты в удобный объект
                const revealedMap = {};
                if (p.revealed_cards) {
                    p.revealed_cards.forEach(c => revealedMap[c.key] = c.value);
                }
                
                // Заполняем ячейки
                columns.forEach(col => {
                    if (revealedMap[col]) {
                        // Если карта вскрыта — показываем текст
                        tableHtml += `<td>${revealedMap[col]}</td>`;
                    } else {
                        // Если скрыта — показываем ???
                        tableHtml += `<td class="td-hidden">???</td>`;
                    }
                });
                
                tableHtml += '</tr>';
            });
            
            tableHtml += '</tbody></table>';
            
            if (dataTableEl.innerHTML !== tableHtml) {
                dataTableEl.innerHTML = tableHtml;
            }
        }
    }
}


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
        { key: 'body', label: 'Телосложение', type: 'body', icon: 'fa-child' },
        { key: 'character', label: 'Характер', type: 'character', icon: 'fa-masks-theater' },
        { key: 'habit', label: 'Привычка', type: 'habit', icon: 'fa-smoking' },
        { key: 'health', label: 'Здоровье', type: 'health', icon: 'fa-heartbeat' },
        { key: 'hobby', label: 'Хобби', type: 'trait', icon: 'fa-gamepad' },
        { key: 'phobia', label: 'Фобия', type: 'trait', icon: 'fa-ghost' },
        { key: 'baggage', label: 'Багаж', type: 'equipment', icon: 'fa-briefcase' },
        { key: 'fact', label: 'Факт', type: 'trait', icon: 'fa-info-circle' },
        { key: 'special1', label: 'Спецуха', type: 'special', icon: 'fa-star' }
    ];

    let html = cardConfig.map(cfg => {
        const rawValue = c[cfg.key];
        const isSpecial = (cfg.type === 'special');
        
        
        const displayValue = isSpecial ? (rawValue?.text || "НЕТ ДАННЫХ") : rawValue;
        const specialId = isSpecial ? (rawValue?.id || "UNKNOWN") : null;
        
        const isRevealed = revealed.some(r => r.key === cfg.label);
        
        const isUsedLocally = isSpecial && window.usedSpecials && window.usedSpecials.has(cfg.key);
        const isBlocked = isRevealed || isUsedLocally;

        
        let onclickHandler = '';
        if (!isBlocked && isAlive) {
            if (isSpecial) {
                onclickHandler = `window.activateSpecial('${cfg.key}', '${specialId}')`;
            } else {
                onclickHandler = `window.animateAndReveal('${cfg.label}', '${displayValue.replace(/'/g, "\\'")}', this)`;
            }
        }

        
        const usedBadge = (isSpecial && isBlocked) ? '<div class="card-used-badge">ИСПОЛЬЗОВАНО ✓</div>' : '';
        const actionHint = (!isBlocked && isAlive) ? '<div class="card-action-hint">ОТКРЫТЬ <i class="fas fa-eye"></i></div>' : '';

        return `
            <div class="bunker-card type-${cfg.type} ${isBlocked ? 'revealed' : ''} ${!isAlive ? 'disabled' : ''}" 
                 onclick="${onclickHandler}"
                 onmousemove="window.applyCard3D(event, this)"
                 onmouseleave="window.removeCard3D(this)">
                
                <div class="card-key"><i class="fas ${cfg.icon}"></i> ${cfg.label}</div>
                <div class="card-value" style="${isSpecial ? 'font-size: 0.7rem; padding: 5px;' : ''}">${displayValue}</div>
                ${usedBadge}${actionHint}
            </div>
        `;
    }).join('');

    if (!isAlive) {
        html = `<div style="color: #ef4444; font-family: var(--font-pixel); font-size: 0.8rem; margin-bottom: 15px; border: 1px solid #ef4444; padding: 10px; background: rgba(239, 68, 68, 0.1);">ВЫ ИЗГНАНЫ ИЗ БУНКЕРА 💀</div>` + html;
    }

    if (myCardsContainer) {
        
        myCardsContainer.innerHTML = html;
        
        
        if (window.markUsedSpecialsInDOM) window.markUsedSpecialsInDOM();
    }
}


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
        
        players.filter(p => p.is_alive).forEach(p => {
            const isSelected = myVote === p.user_id ? 'selected' : '';
            html += `<button class="vote-btn ${isSelected}" onclick="window.castVote('${p.user_id}')" ${myVote ? 'disabled' : ''}>${p.username}</button>`;
        });
    }
    
    if (voteOptionsContainer) voteOptionsContainer.innerHTML = html;

    
    if (isHost || isSpectator) {
        const endBtn = document.getElementById('end-vote-btn');
        if (isHost && endBtn) endBtn.style.display = 'block';
        
        const alivePlayers = players.filter(p => p.is_alive);
        const votesCount = players.filter(p => p.voted_for_id !== null).length;
        const statusEl = document.getElementById('vote-status');
        if (statusEl) statusEl.textContent = `Проголосовало: ${votesCount} из ${alivePlayers.length}`;
    }
}
