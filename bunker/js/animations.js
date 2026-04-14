
export function applyCard3D(e, card) {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    
    const dx = x - xc;
    const dy = y - yc;
    
    const tilt = 15; 
    
    card.style.transform = `perspective(1000px) rotateX(${-dy / yc * tilt}deg) rotateY(${dx / xc * tilt}deg) scale(1.05)`;
}

export function removeCard3D(card) {
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
}


export function spawnReaction(playerId, emoji, senderName = null) {
    
    const seat = document.querySelector(`.player-seat[onclick*="'${playerId}'"]`) || 
                 document.querySelector(`.player-seat[data-user-id="${playerId}"]`);
    
    if (!seat) return;

    const avatar = seat.querySelector('.player-avatar');
    if (!avatar) return;

    const rect = avatar.getBoundingClientRect();
    const overlay = document.getElementById('card-animation-overlay');
    if (!overlay) return;

    
    const reactionEl = document.createElement('div');
    reactionEl.className = 'floating-emoji-container';
    
    let senderHtml = '';
    if (senderName) {
        senderHtml = `<div class="reaction-sender-tag">${senderName}</div>`;
    }

    reactionEl.innerHTML = `
        <div class="floating-emoji">${emoji}</div>
        ${senderHtml}
    `;

    
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    reactionEl.style.left = `${x}px`;
    reactionEl.style.top = `${y}px`;

    overlay.appendChild(reactionEl);

    
    const driftX = (Math.random() - 0.5) * 60;
    
    const animation = reactionEl.animate([
        { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
        { transform: 'translate(-50%, -100%) scale(1.5)', opacity: 1, offset: 0.3 },
        { transform: `translate(calc(-50% + ${driftX}px), -250%) scale(1)`, opacity: 0 }
    ], {
        duration: 2500, 
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    });

    animation.onfinish = () => reactionEl.remove();
}


window.applyCard3D = applyCard3D;
window.removeCard3D = removeCard3D;
window.spawnReaction = spawnReaction;
