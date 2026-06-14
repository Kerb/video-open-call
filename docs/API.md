# Vibe OpenCall API Documentation

## Server API

### WebSocket Events

#### Client → Server

**create-room**
```javascript
socket.emit('create-room', { uuid: string })
```
Creates a new room with the user as creator.

**Parameters:**
- `uuid`: Valid UUID v4 string

**Responses:**
- `room-created`: `{ code: string }` - Room created successfully
- `room-error`: `{ message: string }` - Error occurred

**Example:**
```javascript
socket.emit('create-room', { uuid: '550e8400-e29b-41d4-a716-446655440000' });
socket.on('room-created', ({ code }) => {
  console.log('Room code:', code);
});
```

**join-room**
```javascript
socket.emit('join-room', { code: string, uuid: string })
```
Joins an existing room.

**Parameters:**
- `code`: 6-character room code
- `uuid`: Valid UUID v4 string

**Responses:**
- `room-joined`: `{ code: string, peerUuid: string }` - Successfully joined
- `room-not-found` - Room does not exist
- `room-full` - Room has 2 participants
- `room-error`: `{ message: string }` - Other errors

**Example:**
```javascript
socket.emit('join-room', { code: 'ABC123', uuid: '550e8400-e29b-41d4-a716-446655440000' });
```

**leave-room**
```javascript
socket.emit('leave-room')
```
Leaves the current room.

**Responses:**
- `room-left` - Successfully left

**reconnect-room**
```javascript
socket.emit('reconnect-room', { code: string, uuid: string })
```
Reconnects to a room after disconnect.

**Parameters:**
- `code`: Room code
- `uuid`: User's UUID

**Responses:**
- `reconnect-success`: `{ code: string, peerUuid: string|null, reconnectWindow: number }` - Successfully reconnected
- `room-not-found` - Room no longer exists
- `room-error`: `{ message: string }` - Reconnection failed

**offer**
```javascript
socket.emit('offer', { sdp: RTCSessionDescription })
```
Sends WebRTC offer to peer.

**answer**
```javascript
socket.emit('answer', { sdp: RTCSessionDescription })
```
Sends WebRTC answer to peer.

**ice-candidate**
```javascript
socket.emit('ice-candidate', { candidate: RTCIceCandidate })
```
Sends ICE candidate to peer.

**send-message**
```javascript
socket.emit('send-message', { text: string })
```
Sends chat message to peer.

**Parameters:**
- `text`: Message text (max 1000 characters)

**audio-state-change**
```javascript
socket.emit('audio-state-change', { muted: boolean })
```
Broadcasts audio mute state to peer.

**screen-share-state-change**
```javascript
socket.emit('screen-share-state-change', { active: boolean })
```
Broadcasts screen sharing state to peer.

#### Server → Client

**user-joined**
```javascript
socket.on('user-joined', { uuid: string, userId: string })
```
Another user joined the room.

**peer-disconnected**
```javascript
socket.on('peer-disconnected', { canReconnect: boolean })
```
Peer disconnected. If `canReconnect` is true, peer can reconnect within 30 seconds.

**peer-reconnected**
```javascript
socket.on('peer-reconnected', { uuid: string })
```
Peer successfully reconnected.

**chat-message**
```javascript
socket.on('chat-message', { text: string, sender: string })
```
Received chat message from peer.

**audio-state-change**
```javascript
socket.on('audio-state-change', { muted: boolean })
```
Peer's audio mute state changed.

**screen-share-state-change**
```javascript
socket.on('screen-share-state-change', { active: boolean })
```
Peer's screen sharing state changed.

## Rate Limiting

- Room creation: 5 requests per minute per socket
- Room join: 10 requests per minute per socket

## Room Lifecycle

1. **Created**: Room exists, waiting for second participant
2. **Full**: 2 participants connected
3. **Grace Period**: All participants left, room kept for 15 minutes
4. **Cleanup**: Room deleted after grace period

## Reconnection

- Disconnected peer has 30 seconds to reconnect
- Slot is preserved during reconnect window
- After timeout, slot is removed and peer cannot reconnect

## Security

- All UUIDs are validated and sanitized
- Room codes are 6 characters, using unambiguous character set
- Messages are length-limited (1000 chars)
- Rate limiting prevents abuse