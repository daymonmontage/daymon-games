// Единое хранилище данных текущей сессии
export const state = {
    currentUser: null,
    currentRoomId: null,
    currentRoomCode: null,
    isHost: false,
    isSpectator: false,
    realtimeChannel: null,
    syncInterval: null,
    lobbyRoomsTimer: null,
    heartbeatInterval: null
};

// Функция для удобного обновления стейта из других модулей
export function setState(updates) {
    Object.assign(state, updates);
}
