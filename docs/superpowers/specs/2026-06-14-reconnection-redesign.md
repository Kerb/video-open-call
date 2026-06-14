# Reconnection Redesign: Полный редизайн переподключения

## 1. Проблема

Текущая реализация reconnection (2026-06-07-reconnection-design.md) имеет критические недостатки:

1. **Нет кнопки ручного переподключения** — Socket.IO auto-reconnect не всегда срабатывает, пользователь не может повторить попытку вручную
2. **`peer-reconnected` не перезапускает WebRTC** — creator, оставшийся в комнате, не создаёт offer после возврата собеседника
3. **`peer-reconnecting-indicator` не имеет кнопок** — нельзя выйти из комнаты, пока ждёшь собеседника
4. **Нет retry-механизма** — единственная попытка reconnect через Socket.IO `reconnect` event
5. **Полное пересоздание `RTCPeerConnection`** вместо ICE restart — медленнее и может терять медиа-состояние
6. **Нет мониторинга ping/pong** — Socket.IO может не детектировать обрыв своевременно

## 2. Архитектура

### 2.1. Диаграмма состояний (дополненная)

```
                    socket disconnect / peer-disconnected
IN_CALL ──────────────────────────────────────────────► DISCONNECTED
  ▲                                                            │
  │                                                     ┌──────┴──────┐
  │                                                     │             │
  ◄────── ICE restart, ICE candidates ────── CONNECTING ◄─┘   HOME ◄──┘
          (new PC if ICE restart fails)               ▲             │
                                                      │      (leave /
                                                 reconnect-success  timer expired)
                                                 peer-reconnected
                                                 manual retry
```

Новые переходы (дополнение к существующим):
- `DISCONNECTED → CONNECTING` — ручная кнопка "Повторить попытку"
- `DISCONNECTED → HOME` — из `peer-reconnecting-indicator` (было только из `reconnecting-overlay`)

### 2.2. Retry-механизм

```javascript
const RECONNECT_CONFIG = {
  maxAttempts: 5,
  baseDelay: 1000,
  maxDelay: 30000,
};

const retryState = {
  attempt: 0,
  timer: null,
};
```

При обрыве сокета:
1. Немедленная попытка (Socket.IO auto-reconnect продолжает работать)
2. Через 1с — retry #1
3. Через 2с — retry #2
4. Через 4с — retry #3
5. Через 8с — retry #4 (до maxAttempts=5)

Каждая retry-попытка: `socket.connect()` + `socket.emit('reconnect-room', ...)`.

Ручная кнопка сбрасывает `retryState.attempt = 0`.

### 2.3. Socket.IO — быстрая детекция обрыва

```javascript
state.socket = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
});
```

Socket.IO native ping/pong используется как есть (pingInterval: 25s, pingTimeout: 20s). Клиентский `disconnect` event ловится в штатном режиме — никакой кастомной ping-логики не требуется.

### 2.4. ICE restart вместо полного пересоздания PC

```javascript
async function restartIce() {
  const pc = state.peerConnection;
  if (!pc || pc.signalingState === 'closed') {
    createPeerConnection();
    if (state.localStream) addLocalTracksToPC();
    if (state.isRoomCreator) startWebRTC(true);
    return;
  }

  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    state.socket.emit('offer', { sdp: pc.localDescription });
  } catch (err) {
    console.error('ICE restart failed, fallback to full renegotiation:', err);
    closePeerConnection();
    createPeerConnection();
    if (state.localStream) addLocalTracksToPC();
    if (state.isRoomCreator) startWebRTC(true);
  }
}
```

## 3. Клиентская логика (public/app.js)

### 3.1. Новые переменные состояния

```javascript
const retryState = { attempt: 0, timer: null };
let pingTimeout = null;
```

### 3.2. Модифицированный `reconnect-success` handler

```javascript
state.socket.on('reconnect-success', ({ code, isCreator }) => {
  state.isReconnecting = false;
  retryState.attempt = 0;
  clearTimeout(retryState.timer);
  hideReconnectingOverlay();
  hideNotification();
  transition(STATE.CONNECTING);

  state.isRoomCreator = isCreator;
  restartIce();
});
```

### 3.3. Модифицированный `peer-reconnected` handler

```javascript
state.socket.on('peer-reconnected', ({ uuid }) => {
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  transition(STATE.CONNECTING);

  if (state.isRoomCreator) {
    restartIce();
  } else {
    closePeerConnection();
  }
});
```

### 3.4. Retry-функция

```javascript
function scheduleRetry() {
  if (retryState.attempt >= RECONNECT_CONFIG.maxAttempts) return;
  if (!state.isReconnecting) return;

  const delay = Math.min(
    RECONNECT_CONFIG.baseDelay * Math.pow(2, retryState.attempt),
    RECONNECT_CONFIG.maxDelay
  );
  retryState.attempt++;

  retryState.timer = setTimeout(() => {
    if (!state.isReconnecting) return;
    updateReconnectStatus(`Попытка ${retryState.attempt}/${RECONNECT_CONFIG.maxAttempts}...`);

    if (!state.socket.connected) {
      state.socket.connect();
    }
    if (state.socket.connected && state.roomCode && state.uuid) {
      state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
    } else {
      state.socket.once('connect', () => {
        state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
      });
    }
  }, delay);
}
```

### 3.5. Ручная кнопка "Повторить попытку"

```javascript
$('btn-retry-reconnect').addEventListener('click', () => {
  retryState.attempt = 0;
  clearTimeout(retryState.timer);
  updateReconnectStatus('Повторная попытка...');

  if (!state.socket.connected) {
    state.socket.connect();
  }

  const tryNow = () => {
    if (state.roomCode && state.uuid) {
      state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
    }
  };

  if (state.socket.connected) {
    tryNow();
  } else {
    state.socket.once('connect', tryNow);
  }
});
```

### 3.6. Модифицированный `disconnect` handler (клиент)

```javascript
state.socket.on('disconnect', () => {
  console.log('Socket disconnected');
  if (state.roomCode && [STATE.IN_CALL, STATE.CONNECTING, STATE.WAITING, STATE.DISCONNECTED].includes(state.appState)) {
    state.isReconnecting = true;
    transition(STATE.DISCONNECTED);
    showReconnectingOverlay();
    scheduleRetry();
  } else if (state.appState !== STATE.HOME) {
    showNotification('Потеря соединения с сервером', 'error');
  }
});
```

### 3.7. Обновление статуса

```javascript
function updateReconnectStatus(text) {
  const el = $('reconnect-status');
  if (el) el.textContent = text;
}
```

### 3.8. endCall — сброс retryState

```javascript
function endCall() {
  clearTimeout(retryState.timer);
  retryState.attempt = 0;
  // ... existing cleanup ...
}
```

## 4. UI (public/index.html)

### 4.1. Новый `reconnecting-overlay`

```html
<div id="reconnecting-overlay" style="display:none">
  <div class="reconnecting-content">
    <div class="spinner"></div>
    <p>Потеряно соединение</p>
    <p class="reconnecting-hint" id="reconnect-status">
      Попытка переподключения...
    </p>
    <div class="reconnect-buttons">
      <button id="btn-retry-reconnect" class="btn btn-secondary">
        Повторить попытку
      </button>
      <button id="btn-leave-reconnect" class="btn btn-secondary btn-danger">
        Выйти из комнаты
      </button>
    </div>
  </div>
</div>
```

### 4.2. Новый `peer-reconnecting-indicator`

```html
<div id="peer-reconnecting-indicator" style="display:none">
  <p>Собеседник временно отключился</p>
  <p class="hint">Ожидание переподключения...</p>
  <button id="btn-leave-peer-reconnect" class="btn btn-secondary btn-danger">
    Выйти из комнаты
  </button>
</div>
```

### 4.3. Обработчик для `btn-leave-peer-reconnect`

```javascript
$('btn-leave-peer-reconnect').addEventListener('click', () => {
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  handleHangup();
});
```

## 5. Серверная логика (src/room-manager.js)

### 5.1. Slot — добавить `disconnectedAt`

```javascript
const slot = {
  uuid,
  socket,
  isCreator: true,
  connected: true,
  reconnectTimer: null,
  disconnectedAt: null,
};
```

### 5.2. `handleDisconnect` — сохранять timestamp

```javascript
slot.disconnectedAt = Date.now();
```

### 5.3. `reconnectToRoom` — возвращать reconnectWindow

```javascript
const elapsed = Date.now() - slot.disconnectedAt;
const reconnectWindow = Math.max(0, RECONNECT_TIMEOUT - elapsed);

return {
  success: true,
  code: code.toUpperCase(),
  isCreator: slot.isCreator,
  reconnectWindow,
};
```

## 6. Стили (public/style.css)

```css
.reconnect-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
}

#btn-retry-reconnect {
  min-width: 200px;
}

.btn-danger {
  background: rgba(220, 50, 50, 0.2);
  color: #e05050;
  border: 1px solid rgba(220, 50, 50, 0.4);
}

.btn-danger:hover {
  background: rgba(220, 50, 50, 0.35);
}
```

## 7. Обработка граничных случаев

| Сценарий | Поведение |
|----------|-----------|
| Оба отключились — первый reconnect | `reconnect-success` → `restartIce()`. Когда второй вернётся — `peer-reconnected` → повторный `restartIce()` |
| Оба отключились — второй reconnect | `reconnect-success` + `peer-reconnected` первому → первый получает `peer-reconnected` и делает `restartIce()` |
| Ручная кнопка нажата во время auto-reconnect | Сброс retry-счётчика, новая попытка |
| Все 5 retry-попыток неудачны | Показывается кнопка "Повторить попытку" (ручная) |
| ICE restart не удался | Fallback: полное пересоздание PC |
| Пользователь выключил камеру/микрофон до обрыва | Состояние треков сохраняется в localStream |
| Окно reconnect истекло (30с) | Сервер удаляет слот → room-not-found → home |
| Peer нажал "Выйти" во время ожидания | Кнопка в peer-reconnecting-indicator → handleHangup() → leave-room |

## 8. Файлы для изменений

| Файл | Изменения |
|------|-----------|
| `public/app.js` | retry-таймер, `restartIce()`, кнопки retry/leave, `peer-reconnected` fix, обновление статуса |
| `public/index.html` | кнопки в overlays, `reconnect-status`, `btn-leave-peer-reconnect` |
| `public/style.css` | `.reconnect-buttons`, `.btn-danger` |
| `src/room-manager.js` | `disconnectedAt`, `reconnectWindow` |

## 9. Тестирование

- retry-таймер запускается при `disconnect` и делает попытку reconnect
- `restartIce()` корректно обрабатывает ошибки и падает на полное пересоздание
- Кнопка "Повторить попытку" сбрасывает retryState и эмитит `reconnect-room`
- `peer-reconnected` перезапускает WebRTC если `isRoomCreator`
- Все overlay имеют кнопки выхода
- Socket.IO ping/pong с настройками reconnectionDelay корректно восстанавливает соединение
