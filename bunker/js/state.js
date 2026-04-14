
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


export function setState(updates) {
    Object.assign(state, updates);
}
