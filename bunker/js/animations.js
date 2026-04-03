// === 3D ЭФФЕКТ НАВЕДЕНИЯ НА КАРТЫ ===
export function applyCard3D(e, card) {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    
    const dx = x - xc;
    const dy = y - yc;
    
    const tilt = 15; // Сила наклона
    
    card.style.transform = `perspective(1000px) rotateX(${-dy / yc * tilt}deg) rotateY(${dx / xc * tilt}deg) scale(1.05)`;
}

export function removeCard3D(card) {
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
}

// Делаем доступными глобально для HTML атрибутов onmousemove / onmouseleave
window.applyCard3D = applyCard3D;
window.removeCard3D = removeCard3D;
