export function startTutorial() {
    // Если уже пройдено и не принудительно, выходим
    if (localStorage.getItem('bunker_tutorial_passed') === 'true' && !window._forceTutorial) {
        return;
    }
    
    window._forceTutorial = false; // сбрасываем флаг

    const steps = [
        {
            title: "СЕКРЕТНЫЙ БУНКЕР",
            text: "Добро пожаловать в игру. В центре находится голографический радар, а вокруг рассаживаются игроки.",
            target: ".bunker-table-container",
            position: "bottom"
        },
        {
            title: "ВАШИ ХАРАКТЕРИСТИКИ",
            text: "Вокруг вашей аватарки вращаются карточки. По клику на любую из них вы можете «Раскрыть её всем» или использовать Спецуху.",
            target: ".game-players-list .player-seat.my-seat",
            position: "bottom"
        },
        {
            title: "РАЦИЯ (ЧАТ)",
            text: "Здесь находится зашифрованный канал связи. Договаривайтесь, плетите интриги и объединяйтесь в союзы.",
            target: "#chat-toggle-btn",
            position: "top"
        },
        {
            title: "ЛИДЕР И ГОЛОСОВАНИЕ",
            text: "Лидер бункера может запускать и останавливать голосование с помощью этих элементов управления. Будьте осторожны с властью.",
            target: ".game-actions",
            position: "top"
        },
        {
            title: "РЕЗНЯ",
            text: "Во время стадии голосования, кликайте ПРЯМО НА АВАТАРКУ другого игрока на радаре, чтобы отдать голос за его изгнание.",
            target: ".bunker-table-container",
            position: "bottom"
        }
    ];

    let currentStep = 0;
    
    // Создаем элементы туториала
    let overlay = document.getElementById('tutorial-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'tutorial-overlay';
        overlay.innerHTML = `
            <div id="tutorial-hole"></div>
            <div id="tutorial-dialog">
                <h3 id="tutorial-title"></h3>
                <p id="tutorial-text"></p>
                <div class="tutorial-actions">
                    <button id="tutorial-prev" class="neon-btn"><i class="fas fa-chevron-left"></i></button>
                    <button id="tutorial-next" class="neon-btn">ДАЛЕЕ <i class="fas fa-chevron-right"></i></button>
                    <button id="tutorial-skip" class="neon-btn skip-btn">ПРОПУСТИТЬ</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        document.getElementById('tutorial-prev').addEventListener('click', () => {
            if (currentStep > 0) { currentStep--; renderStep(); }
        });
        
        document.getElementById('tutorial-next').addEventListener('click', () => {
            if (currentStep < steps.length - 1) { 
                currentStep++; 
                renderStep(); 
            } else {
                endTutorial();
            }
        });
        
        document.getElementById('tutorial-skip').addEventListener('click', endTutorial);
    }

    overlay.classList.add('active');
    currentStep = 0;
    
    // Дождемся отрисовки
    setTimeout(() => {
        renderStep();
    }, 500);

    function renderStep() {
        const step = steps[currentStep];
        if(!step) return;

        document.getElementById('tutorial-title').textContent = step.title;
        document.getElementById('tutorial-text').textContent = step.text;
        
        const nextBtn = document.getElementById('tutorial-next');
        const prevBtn = document.getElementById('tutorial-prev');
        
        if (currentStep === steps.length - 1) {
            nextBtn.innerHTML = 'ПОНЯТНО <i class="fas fa-check"></i>';
            nextBtn.style.borderColor = '#10b981';
            nextBtn.style.color = '#10b981';
        } else {
            nextBtn.innerHTML = 'ДАЛЕЕ <i class="fas fa-chevron-right"></i>';
            nextBtn.style.borderColor = '#3b82f6';
            nextBtn.style.color = '#3b82f6';
        }
        
        prevBtn.style.opacity = currentStep === 0 ? "0.5" : "1";
        prevBtn.style.pointerEvents = currentStep === 0 ? "none" : "all";

        // Позиционируем hole
        const hole = document.getElementById('tutorial-hole');
        const dialog = document.getElementById('tutorial-dialog');
        
        // Пытаемся найти таргет
        const targetEl = document.querySelector(step.target);
        if (targetEl && (targetEl.offsetWidth > 0 || targetEl.offsetHeight > 0)) {
            const rect = targetEl.getBoundingClientRect();
            // Делаем небольшие отступы
            const padding = 15;
            
            hole.style.width = `${rect.width + padding*2}px`;
            hole.style.height = `${rect.height + padding*2}px`;
            hole.style.left = `${rect.left - padding}px`;
            hole.style.top = `${rect.top - padding}px`;
            hole.style.borderRadius = "10px";
            hole.style.opacity = "1";
            
            // Заставляем таргет быть поверх дырки
            targetEl.style.zIndex = "10002";
            targetEl.dataset.tutorialZ = "true";

            // Вычисляем позицию диалога
            // Центрируем относительно таргета
            let dialogLeft = rect.left + rect.width/2 - dialog.offsetWidth/2;
            
            // Ограничиваем, чтобы не улетело за левый или правый край экрана
            const maxLeft = window.innerWidth - dialog.offsetWidth - 20;
            dialogLeft = Math.max(20, Math.min(maxLeft, dialogLeft));
            
            dialog.style.left = `${dialogLeft}px`;

            if (step.position === 'top') {
                dialog.style.top = `${Math.max(20, rect.top - dialog.offsetHeight - 40)}px`;
            } else {
                dialog.style.top = `${Math.min(window.innerHeight - dialog.offsetHeight - 20, rect.bottom + 40)}px`;
            }
        } else {
            // Фолбэк, если элемента вдруг нет на экране или он дисплей нон
            hole.style.opacity = "0";
            dialog.style.left = `${window.innerWidth/2 - dialog.offsetWidth/2}px`;
            dialog.style.top = `${window.innerHeight/2 - dialog.offsetHeight/2}px`;
        }
        
        if(window.playBunkerSFX) window.playBunkerSFX('click');
    }

    function endTutorial() {
        localStorage.setItem('bunker_tutorial_passed', 'true');
        overlay.classList.remove('active');
        
        // Чистим z-index
        document.querySelectorAll('[data-tutorial-z="true"]').forEach(el => {
            el.style.zIndex = "";
            el.removeAttribute('data-tutorial-z');
        });
        
        setTimeout(() => {
            if(window.playBunkerSFX) window.playBunkerSFX('click');
        }, 300);
    }
}
