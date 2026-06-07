# Reconnection Design: Переподключение к комнате при разрыве соединения

## 1. Проблема

При технических ошибках (потеря соединения) участник не может вернуться в существующую комнату. Сейчас disconnect немедленно завершает звонок и выбрасывает на главный экран. Нужна возможность переподключиться в течение 30 секунд.

## 2. Архитектура

### 2.1. Серверная модель данных

Room переходит от `Map<socketId, Socket>` к слотам, идентифицированным UUID клиента:

```javascript
// Было
room.sockets = Map<socketId, Socket>

// Стало
room.slots = Map<uuid, {
  uuid: string,          // клиентский UUID (генерируется один раз, хранится в localStorage)
  socket: Socket|null,   // null когда отключён
  isCreator: boolean,    // производная от порядка подключения (первый слот = creator)
  connected: boolean,    // false во время reconnect-окна
  reconnectTimer: Timer|null,
}>

room.socketToUuid = Map<socketId, uuid>  // быстрый lookup при событиях
```

### 2.2. Состояния приложения (state machine)

Добавляется состояние `DISCONNECTED`:

```
IN_CALL ──► DISCONNECTED ──► CONNECTING ──► IN_CALL
                │
                └──► HOME (отмена / таймаут reconnect)
```

Новые валидные переходы:
- `IN_CALL → DISCONNECTED` — socket disconnect / получен `peer-disconnected { canReconnect: true }`
- `DISCONNECTED → CONNECTING` — успешное `reconnect-success` / `peer-reconnected`
- `DISCONNECTED → HOME` — пользователь нажал "Выйти" / истёк reconnectTimer / получен `peer-disconnected { canReconnect: false }`

### 2.3. Поток reconnect (отключившийся участник)

```
[Клиент A]                      [Сервер]                    [Клиент B]
    │                              │                            │
    ├── socket disconnect ────────►│                            │
    │                              ├── помечает слот A          │
    │                              │   как disconnected         │
    │                              ├── запускает reconnectTimer │
    │                              │   (30 сек)                 │
    │                              ├── peer-disconnected ───────►
    │                              │   { canReconnect: true }    │
    │                              │                            ├── show "ожидание"
    │  [показ reconnecting UI]     │                            │
    │                              │                            │
    ├── socket reconnect ─────────►│                            │
    │  (Socket.IO built-in)        │                            │
    │                              │                            │
    ├── reconnect-room ───────────►│                            │
    │   { code, uuid }             ├── находит слот по uuid     │
    │                              ├── отменяет reconnectTimer  │
    │                              ├── привязывает новый socket │
    │                              │                            │
    │◄── reconnect-success ────────┤                            │
    │    { isCreator }             ├── peer-reconnected ────────►│
    │                              │   { uuid }                  │
    │                              │                            │
    ├── closePeerConnection()      ├── closePeerConnection()     │
    ├── createPeerConnection()     │                            │
    ├── createOffer() ────────────►│                            │
    │    (если isCreator)          ├── offer ───────────────────►│
    │                              │                            ├── handleOffer()
    │                              │                            ├── createAnswer()
    │◄─────────────────────────────┤◄── answer ─────────────────┤
    │                              │                            │
    ├── ICE exchange ─────────────►├── ICE exchange ───────────►│
    │                              │                            │
    └── IN_CALL ◄──────────────────┴────────────────────────────┘
```

### 2.4. Клиент — генерация UUID

При первом заходе на страницу генерируется UUID и сохраняется в `localStorage('call-uuid')`. Используется во всех `create-room` и `join-room` запросах, а также для `reconnect-room`.

```javascript
function getOrCreateUUID() {
  let uuid = localStorage.getItem('call-uuid');
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem('call-uuid', uuid);
  }
  return uuid;
}
```

### 2.5. Сервер — обработчики

**disconnect** (модифицирован):
```javascript
socket.on('disconnect', () => {
  const code = socket.currentRoom;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const uuid = room.socketToUuid.get(socket.id);
  if (!uuid) return;
  const slot = room.slots.get(uuid);
  if (!slot) return;

  slot.socket = null;
  slot.connected = false;
  room.socketToUuid.delete(socket.id);
  socket.currentRoom = null;

  // Уведомить второго участника
  const other = getOtherSlot(room, uuid);
  if (other?.socket) {
    other.socket.emit('peer-disconnected', { canReconnect: true });
  }

  // Таймер переподключения
  slot.reconnectTimer = setTimeout(() => {
    room.slots.delete(uuid);
    const other = getOtherSlot(room, uuid);
    if (other?.socket) {
      other.socket.emit('peer-disconnected', { canReconnect: false });
    }
    if (room.slots.size === 0) {
      room.graceTimer = setTimeout(() => cleanUpRoom(code), GRACE_PERIOD);
    }
  }, 30000); // 30 секунд
});
```

**reconnect-room** (новый):
```javascript
socket.on('reconnect-room', ({ code, uuid }) => {
  const room = rooms.get(code);
  if (!room) { socket.emit('room-not-found'); return; }
  const slot = room.slots.get(uuid);
  if (!slot) { socket.emit('room-error', { message: 'Слот не найден' }); return; }

  clearTimeout(slot.reconnectTimer);
  slot.reconnectTimer = null;
  slot.socket = socket;
  slot.connected = true;
  room.socketToUuid.set(socket.id, uuid);
  socket.currentRoom = code;
  socket.join(code);

  socket.emit('reconnect-success', { code, isCreator: slot.isCreator });

  const other = getOtherSlot(room, uuid);
  if (other?.socket) {
    other.socket.emit('peer-reconnected', { uuid });
  }
});
```

**leave-room** (модифицирован) — немедленное удаление слота, без reconnect-окна:
```javascript
function leaveRoom(socket) {
  const code = socket.currentRoom;
  if (!code) return;

  const room = rooms.get(code);
  if (room) {
    const uuid = room.socketToUuid.get(socket.id);
    if (uuid) {
      const slot = room.slots.get(uuid);
      if (slot?.reconnectTimer) {
        clearTimeout(slot.reconnectTimer);
      }
      room.slots.delete(uuid);
      room.socketToUuid.delete(socket.id);
    }

    socket.to(code).emit('peer-disconnected', { canReconnect: false });
    socket.leave(code);

    if (room.slots.size === 0) {
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => cleanUpRoom(code), GRACE_PERIOD);
    }
  }
  socket.currentRoom = null;
}
```

**create-room / join-room** — добавляется параметр `uuid` во входящих событиях:
```javascript
socket.on('create-room', ({ uuid }) => {
  // ...
  room.slots.set(uuid, { uuid, socket, isCreator: true, connected: true, reconnectTimer: null });
  room.socketToUuid.set(socket.id, uuid);
});

socket.on('join-room', ({ code, uuid }) => {
  // ...
  room.slots.set(uuid, { uuid, socket, isCreator: false, connected: true, reconnectTimer: null });
  room.socketToUuid.set(socket.id, uuid);
});
```

### 2.6. Клиент — обработчики

**Socket reconnect** — после автоматического переподключения Socket.IO:
```javascript
state.socket.on('reconnect', () => {
  if (state.isReconnecting && state.roomCode && state.uuid) {
    state.socket.emit('reconnect-room', {
      code: state.roomCode,
      uuid: state.uuid,
    });
  }
});
```

**reconnect-success**:
```javascript
state.socket.on('reconnect-success', ({ isCreator }) => {
  state.isReconnecting = false;
  hideReconnectingOverlay();
  hideNotification();
  transition(STATE.CONNECTING);
  closePeerConnection();
  if (isCreator) {
    startWebRTC(true);
  }
});
```

**peer-disconnected** (для второго участника):
```javascript
state.socket.on('peer-disconnected', ({ canReconnect }) => {
  if (canReconnect) {
    state.waitingForPeerReconnect = true;
    transition(STATE.DISCONNECTED);
    showPeerWaitingOverlay();
  } else {
    showNotification('Собеседник отключился', 'info');
    endCall();
    screens.home();
  }
});
```

**peer-reconnected**:
```javascript
state.socket.on('peer-reconnected', () => {
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  transition(STATE.CONNECTING);
  closePeerConnection();
  // creator пришлёт offer
});
```

**socket.on('disconnect')** (клиентский) — модифицирован:
```javascript
state.socket.on('disconnect', () => {
  console.log('Socket disconnected');
  if (state.roomCode && [STATE.IN_CALL, STATE.CONNECTING, STATE.WAITING, STATE.DISCONNECTED].includes(state.appState)) {
    state.isReconnecting = true;
    transition(STATE.DISCONNECTED);
    showReconnectingOverlay();
  }
});
```

### 2.7. WebRTC — изменения

Два новых флага в `state`:
- `isReconnecting` — true, когда мой сокет отключился
- `waitingForPeerReconnect` — true, когда я жду переподключения собеседника

В `onconnectionstatechange` не завершать звонок при `failed`/`disconnected`, если активен reconnect:

```javascript
pc.onconnectionstatechange = () => {
  if (pc.connectionState === 'connected') {
    transition(STATE.IN_CALL);
  }
  if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
    if (state.isReconnecting || state.waitingForPeerReconnect) return;
    showNotification('Соединение потеряно', 'error');
    endCall();
    screens.home();
  }
};
```

**Порядок событий (connected peer):**
1. `peer-disconnected { canReconnect: true }` → `waitingForPeerReconnect = true`
2. WebRTC `connectionstatechange → failed` → guard срабатывает, звонок не завершается
3. `peer-reconnected` → `waitingForPeerReconnect = false`, переход в CONNECTING

Close peer connection helper:
```javascript
function closePeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
}
```

### 2.8. UI — оверлей переподключения (для отключившегося)

Добавить в `room-screen`:
```html
<div id="reconnecting-overlay" style="display:none">
  <div class="reconnecting-content">
    <div class="spinner"></div>
    <p>Потеряно соединение</p>
    <p class="reconnecting-hint">Попытка переподключения...</p>
    <button id="btn-leave-reconnect" class="btn btn-secondary">Выйти из комнаты</button>
  </div>
</div>
```

### 2.9. UI — индикатор ожидания (для второго участника)

Добавить в `remote-container`:
```html
<div id="peer-reconnecting-indicator" style="display:none">
  <p>Собеседник временно отключился</p>
  <p class="hint">Ожидание переподключения...</p>
</div>
```

### 2.10. CSS для оверлея reconnecting

```css
#reconnecting-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: fadeIn 0.3s ease;
}

.reconnecting-content {
  text-align: center;
  color: #e8e8e8;
}

.reconnecting-content p {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}

.reconnecting-hint {
  font-size: 14px;
  color: #a0a0b0;
  margin-bottom: 24px;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 3px solid rgba(255,255,255,0.2);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

#peer-reconnecting-indicator {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  z-index: 10;
  color: #e8e8e8;
  text-align: center;
  padding: 24px;
}

#peer-reconnecting-indicator p {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}

#peer-reconnecting-indicator .hint {
  font-size: 13px;
  color: #a0a0b0;
}
```

## 3. Grace period и очистка комнат

- **reconnectTimer**: 30 секунд с момента disconnect. Если не переподключился — слот удаляется.
- После удаления последнего слота — стартует существующий gracePeriod (5 мин), потом комната удаляется.
- Если комната была создана, но никто не подключился — существующий cleanupTimer (30 мин) без изменений.

## 4. Обработка граничных случаев

| Сценарий | Поведение |
|----------|-----------|
| Оба участника отключились одновременно | Оба получают reconnectTimer 30 сек. Первый, кто переподключился — ждёт второго. Если оба не вернулись — комната удаляется через gracePeriod |
| Участник отключился, нажал "Выйти" во время reconnect | Очищаем slot немедленно, уведомляем второго `peer-disconnected { canReconnect: false }` |
| Сервер упал | Текущая архитектура (in-memory) не может восстановить комнаты — вне scope этого изменения |
| Переподключение с другого устройства/браузера | Не работает — UUID хранится в localStorage этого браузера. Для кроссплатформенного reconnect потребуется токен восстановления (Approach 2) |
| Попытка reconnect после истечения reconnectTimer | Сервер ответит `room-error { message: 'Слот не найден' }` → клиент завершает звонок |
| Переподключение во время WebRTC handshake | Обрабатывается так же — socket disconnect → reconnect → полная переустановка WebRTC |
| Медиа-треки потеряны при отключении | `getUserMedia` треки не зависят от сокета и остаются активными. Если по какой-то причине треки потеряны — `getLocalMedia()` вызывается заново при renegotiation |

## 5. Файлы для изменений

| Файл | Изменения |
|------|-----------|
| `server.js` | Слоты вместо `socket` Map, новые обработчики `reconnect-room`, модифицированные `disconnect`/`create-room`/`join-room` |
| `src/state-machine.js` | Новое состояние `DISCONNECTED`, новые переходы |
| `public/app.js` | UUID, reconnect handler, новые обработчики, модифицированные disconnect/connectionstate |
| `public/index.html` | Reconnecting overlay, peer-reconnecting indicator |
| `public/style.css` | Стили для reconnecting overlay и индикатора |
| `tests/room.test.js` | Тесты для reconnection сценариев |
| `tests/state-machine.test.js` | Тесты для нового состояния DISCONNECTED |
