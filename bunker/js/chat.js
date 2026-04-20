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
        
        if (activeRoomId) chatToggleBtn.style.display = 'flex';
        if (playSFX) playSFX('click');
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textRaw = chatInput.value.trim();
        if (!textRaw) return;
        
        chatInput.value = '';
        
        const currentUser = window._chatCurrentUser;
        if (!currentUser || !activeRoomId) return;

        let finalText = textRaw;
        let whisperTo = null;

        
        const whisperMatch = textRaw.match(/^[\/|!][w|ш]\s+@?([a-zA-Z0-9_а-яА-Я]+)\s+(.+)$/i);
        if (whisperMatch) {
            let targetName = whisperMatch[1];
            const whisperText = whisperMatch[2];

            
            if (activeRoomId !== 'global' && window.bunkerPlayersCache && targetName.length >= 2) {
                const search = targetName.toLowerCase();
                const matches = window.bunkerPlayersCache.filter(p => 
                    p.username.toLowerCase().startsWith(search)
                );
                
                if (matches.length > 0) {
                    
                    const exact = matches.find(m => m.username.toLowerCase() === search);
                    targetName = exact ? exact.username : matches[0].username;
                }
            }

            whisperTo = targetName;
            finalText = `[WHISPER:${whisperTo}] ${whisperText}`;
        }

        try {
            if (activeRoomId === 'global') {
                await supabase.from('bunker_global_chat').insert({
                    user_id: currentUser.id,
                    username: currentUser.username || currentUser.email.split('@')[0] || "Guest",
                    avatar_url: currentUser.avatar_url,
                    text: finalText
                });
            } else {
                await supabase.from('bunker_chat').insert({
                    room_id: activeRoomId,
                    user_id: currentUser.id,
                    username: currentUser.username || currentUser.email.split('@')[0] || "Guest",
                    avatar_url: currentUser.avatar_url,
                    text: finalText
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
        
        let text = msg.text || "";
        let isWhisper = false;
        let whisperTarget = null;

        
        const whisperMatch = text.match(/^\[WHISPER:([^\]]+)\]\s+(.+)$/);
        if (whisperMatch) {
            isWhisper = true;
            whisperTarget = whisperMatch[1];
            text = whisperMatch[2];

            const myName = currentUser ? (currentUser.username || (currentUser.email ? currentUser.email.split('@')[0] : null)) : null;
            const amIRecipient = myName && whisperTarget.toLowerCase() === myName.toLowerCase();
            
            
            if (!isMine && !amIRecipient) return;
        }

        const msgEl = document.createElement('div');
        msgEl.className = `chat-msg ${isMine ? 'mine' : ''} ${isWhisper ? 'whisper' : ''}`;
        
        let headerPrefix = "";
        if (isWhisper) {
            headerPrefix = isMine ? `<span class="whisper-label">ШЕПОТ ДЛЯ @${whisperTarget}:</span>` : `<span class="whisper-label">ВАМ ШЕПЧУТ:</span>`;
        }

        msgEl.innerHTML = `
            <div class="chat-msg-header">
                <img src="${msg.avatar_url || 'https://via.placeholder.com/20'}" class="chat-msg-avatar">
                <span class="chat-msg-author">${msg.username}</span>
                ${headerPrefix}
            </div>
            <div class="chat-msg-text">${text}</div>
        `;

        chatMessagesEl.appendChild(msgEl);
        
        // --- НОВОЕ: ОГРАНИЧЕНИЕ ДО 10 СООБЩЕНИЙ ---
        const allMessages = chatMessagesEl.querySelectorAll('.chat-msg:not(.system)');
        if (allMessages.length > 10) {
            allMessages[0].remove(); // Удаляем самое старое (верхнее) сообщение
        }
        // -----------------------------------------

        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    window.setWhisper = function(username) {
        if (!isChatOpen) {
            chatToggleBtn.click();
        }
        chatInput.value = `/w @${username} `;
        chatInput.focus();
    }

    window.connectChat = async function(roomId, currentUserObj) {
        if (activeRoomId === roomId) return;
        
        activeRoomId = roomId;
        window._chatCurrentUser = currentUserObj; 
        
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
            .order('created_at', { ascending: false })
            .limit(10);
            
        
        if (activeRoomId !== roomId) return;
            
        chatMessagesEl.innerHTML = '';
        if (msgs && msgs.length > 0) {
            msgs.reverse().forEach(appendMessage);
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
                    if (playSFX) playSFX('click'); 
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

        
        const allChannels = supabase.getChannels();
        allChannels.forEach(c => {
            if (c.topic.startsWith('realtime:chat_')) {
                supabase.removeChannel(c);
            }
        });

        const { data: msgs } = await supabase
            .from('bunker_global_chat')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);
            
        
        if (activeRoomId !== 'global') return;
            
        chatMessagesEl.innerHTML = '';
        if (msgs && msgs.length > 0) {
            msgs.reverse().forEach(appendMessage);
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
