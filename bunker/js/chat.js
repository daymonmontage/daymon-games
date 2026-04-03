export function initChat(supabase, playSFX) {
    const chatToggleBtn = document.getElementById('chat-toggle-btn');
    const chatDrawer = document.getElementById('chat-drawer');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessagesEl = document.getElementById('chat-messages');
    const chatBadge = document.getElementById('chat-unread-badge');

    let unreadCount = 0;
    let isChatOpen = false;
    let chatChannel = null;
    let activeRoomId = null;

    // Скрываем иконку чата изначально (пока не зайдешь в лобби)
    chatToggleBtn.style.display = 'none';

    chatToggleBtn.addEventListener('click', () => {
        isChatOpen = true;
        chatDrawer.classList.add('open');
        chatToggleBtn.style.display = 'none';
        unreadCount = 0;
        updateBadge();
        setTimeout(() => chatInput.focus(), 100);
        if (playSFX) playSFX('click');
    });

    closeChatBtn.addEventListener('click', () => {
        isChatOpen = false;
        chatDrawer.classList.remove('open');
        // Возвращаем кнопку только если мы в комнате
        if (activeRoomId) chatToggleBtn.style.display = 'flex';
        if (playSFX) playSFX('click');
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        
        chatInput.value = '';
        
        const currentUser = window._chatCurrentUser;
        if (!currentUser || !activeRoomId) return;

        try {
            if (activeRoomId === 'global') {
                await supabase.from('bunker_global_chat').insert({
                    user_id: currentUser.id,
                    username: currentUser.username || currentUser.email.split('@')[0] || "Guest",
                    avatar_url: currentUser.avatar_url,
                    text: text
                });
            } else {
                await supabase.from('bunker_chat').insert({
                    room_id: activeRoomId,
                    user_id: currentUser.id,
                    username: currentUser.username || currentUser.email.split('@')[0] || "Guest",
                    avatar_url: currentUser.avatar_url,
                    text: text
                });
            }
        } catch(err) {
            console.error("Ошибка отправки сообщения:", err);
        }
    });

    function updateBadge() {
        if (unreadCount > 0) {
            chatBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            chatBadge.style.display = 'flex';
        } else {
            chatBadge.style.display = 'none';
        }
    }

    function appendMessage(msg) {
        const currentUser = window._chatCurrentUser;
        const isMine = currentUser && msg.user_id === currentUser.id;

        const msgEl = document.createElement('div');
        msgEl.className = `chat-msg ${isMine ? 'mine' : ''}`;
        
        msgEl.innerHTML = `
            <div class="chat-msg-header">
                <img src="${msg.avatar_url || 'https://via.placeholder.com/20'}" class="chat-msg-avatar">
                <span class="chat-msg-author">${msg.username}</span>
            </div>
            <div class="chat-msg-text">${msg.text}</div>
        `;

        chatMessagesEl.appendChild(msgEl);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    window.connectChat = async function(roomId, currentUserObj) {
        if (activeRoomId === roomId) return;
        
        activeRoomId = roomId;
        window._chatCurrentUser = currentUserObj; // Save for local access
        
        if (!isChatOpen) {
            chatToggleBtn.style.display = 'flex';
        }

        chatMessagesEl.innerHTML = `
            <div class="chat-msg system">
                <div class="chat-msg-text">ПОДКЛЮЧЕНИЕ К ЗАЩИЩЕННОМУ КАНАЛУ...</div>
            </div>
        `;

        if (chatChannel) {
            supabase.removeChannel(chatChannel);
            chatChannel = null;
        }

        // ЖЕСТКАЯ ОЧИСТКА: Найдём и убедимся, что нет зависших каналов
        const allChannels = supabase.getChannels();
        allChannels.forEach(c => {
            if (c.topic.startsWith('realtime:chat_')) {
                supabase.removeChannel(c);
            }
        });

        const { data: msgs } = await supabase
            .from('bunker_chat')
            .select('*')
            .eq('room_id', roomId)
            .order('created_at', { ascending: true })
            .limit(50);
            
        // ЗАЩИТА ОТ ГОНКИ: Если игрок успел выйти из комнаты пока грузилась история
        if (activeRoomId !== roomId) return;
            
        chatMessagesEl.innerHTML = '';
        if (msgs && msgs.length > 0) {
            msgs.forEach(appendMessage);
        } else {
             chatMessagesEl.innerHTML = `
                <div class="chat-msg system">
                    <div class="chat-msg-text">КАНАЛ СВЯЗИ УСТАНОВЛЕН. ИСТОРИЯ ПУСТА.</div>
                </div>
            `;
        }

        chatChannel = supabase.channel(`chat_${roomId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bunker_chat', filter: `room_id=eq.${roomId}` }, payload => {
                const newMsg = payload.new;
                
                const sysMsg = chatMessagesEl.querySelector('.system');
                if (sysMsg) sysMsg.remove();

                appendMessage(newMsg);
                
                if (!isChatOpen) {
                    unreadCount++;
                    updateBadge();
                    if (playSFX) playSFX('click'); // notify sound
                }
            })
            .subscribe();
    }
    
    window.connectGlobalChat = async function(currentUserObj) {
        if (activeRoomId === 'global') return;
        
        activeRoomId = 'global';
        window._chatCurrentUser = currentUserObj; 
        
        chatToggleBtn.style.display = 'flex';
        
        chatMessagesEl.innerHTML = `
            <div class="chat-msg system">
                <div class="chat-msg-text">ПОДКЛЮЧЕНИЕ К ГЛОБАЛЬНОМУ КАНАЛУ ЛОББИ...</div>
            </div>
        `;

        if (chatChannel) {
            supabase.removeChannel(chatChannel);
            chatChannel = null;
        }

        // ЖЕСТКАЯ ОЧИСТКА: Найдём и убедимся, что нет зависших каналов чата
        const allChannels = supabase.getChannels();
        allChannels.forEach(c => {
            if (c.topic.startsWith('realtime:chat_')) {
                supabase.removeChannel(c);
            }
        });

        const { data: msgs } = await supabase
            .from('bunker_global_chat')
            .select('*')
            .order('created_at', { ascending: true })
            .limit(50);
            
        // ЗАЩИТА ОТ ГОНКИ
        if (activeRoomId !== 'global') return;
            
        chatMessagesEl.innerHTML = '';
        if (msgs && msgs.length > 0) {
            msgs.forEach(appendMessage);
        } else {
             chatMessagesEl.innerHTML = `
                <div class="chat-msg system">
                    <div class="chat-msg-text">ОБЩИЙ КАНАЛ СВЯЗИ. ИСТОРИЯ ПУСТА.</div>
                </div>
            `;
        }

        chatChannel = supabase.channel(`chat_global`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bunker_global_chat' }, payload => {
                const newMsg = payload.new;
                const sysMsg = chatMessagesEl.querySelector('.system');
                if (sysMsg) sysMsg.remove();
                appendMessage(newMsg);
                
                if (!isChatOpen) {
                    unreadCount++;
                    updateBadge();
                    if (playSFX) playSFX('click');
                }
            })
            .subscribe();
    }

    window.disconnectChat = function() {
        activeRoomId = null;
        chatMessagesEl.innerHTML = '';
        if (chatChannel) {
            supabase.removeChannel(chatChannel);
            chatChannel = null;
        }
        
        // Жестко добиваем все остаточные слушатели чата
        const allChannels = supabase.getChannels();
        allChannels.forEach(c => {
            if (c.topic.startsWith('realtime:chat_')) {
                supabase.removeChannel(c);
            }
        });
        
        isChatOpen = false;
        chatDrawer.classList.remove('open');
        chatToggleBtn.style.display = 'none';
        unreadCount = 0;
        updateBadge();
    }
}
