
export const screens = {
    lobby: document.getElementById('lobby-screen'),
    waiting: document.getElementById('waiting-screen'),
    game: document.getElementById('game-screen')
};

const errorEl = document.getElementById('lobby-error');


export function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
    
    
    const tutBtn = document.getElementById('tutorial-trigger-btn');
    if (tutBtn) {
        tutBtn.style.display = screenName === 'game' ? 'flex' : 'none';
    }
}


export function showError(msg, timeout = 3000) {
    errorEl.textContent = msg;
    setTimeout(() => errorEl.textContent = '', timeout);
}


export function showAlert(message, onCloseCallback = null) {
    const modal = document.getElementById('custom-alert-modal');
    const msgEl = document.getElementById('alert-msg');
    const btnOk = document.getElementById('alert-ok-btn');

    msgEl.textContent = message;
    modal.classList.add('active');

    btnOk.onclick = () => {
        modal.classList.remove('active');
        if (onCloseCallback) onCloseCallback();
    };
}


export function showConfirm(message, onConfirmCallback, dontShowKey = null) {
    if (dontShowKey && localStorage.getItem(dontShowKey) === 'true') {
        onConfirmCallback();
        return;
    }

    const modal = document.getElementById('custom-confirm-modal');
    const msgEl = document.getElementById('confirm-msg');
    const btnYes = document.getElementById('confirm-yes-btn');
    const btnNo = document.getElementById('confirm-no-btn');
    const dontShowWrap = document.getElementById('confirm-dont-show-wrap');
    const dontShowCb = document.getElementById('confirm-dont-show-cb');

    msgEl.textContent = message;
    
    if (dontShowKey && dontShowWrap) {
        dontShowWrap.style.display = 'flex';
        if (dontShowCb) dontShowCb.checked = false;
    } else if (dontShowWrap) {
        dontShowWrap.style.display = 'none';
        if (dontShowCb) dontShowCb.checked = false;
    }

    modal.classList.add('active');

    btnYes.onclick = () => {
        if (dontShowKey && dontShowCb && dontShowCb.checked) {
            localStorage.setItem(dontShowKey, 'true');
        }
        modal.classList.remove('active');
        onConfirmCallback();
    };

    btnNo.onclick = () => {
        modal.classList.remove('active');
    };
}


window.showAlert = showAlert;
window.showConfirm = showConfirm;
