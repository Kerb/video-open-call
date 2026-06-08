# Vibe OpenCall

P2P видео/аудиозвонок через браузер с текстовым чатом и демонстрацией экрана.

Два пользователя создают комнату по 6-символьному коду и общаются напрямую (peer-to-peer) через WebRTC. Сервер нужен только для сигнализации (обмен SDP/ICE).

---

## Возможности

- **Создание комнаты** — генерация уникального 6-символьного кода
- **Подключение по коду** — ввод или вставка кода, авто-uppercase
- **Видео/аудиосвязь P2P** — через WebRTC с STUN-серверами Google
- **Текстовый чат** — в реальном времени, с уведомлениями
- **Демонстрация экрана** — замена видео с камеры на экран
- **Состояние участников** — индикация mute, camera off, screen share
- **Тёмная тема** — Mobile First, адаптация от 320px до 1920px
- **Копирование кода** —一键 копирование в буфер обмена
- **Авто-очистка комнат** — 30 мин ожидания, 5 мин grace period
- **Авто-переподключение** — 30 сек окно на восстановление при обрыве
- **Уникальный UUID** — идентификация в localStorage для reconnect

---

## Технологии

| Компонент | Технология |
|-----------|-----------|
| Сервер сигнализации | Node.js + Express + Socket.IO |
| Клиент | Vanilla JS (без фреймворков) |
| Связь | WebRTC (`RTCPeerConnection`) |
| STUN | `stun:stun.l.google.com:19302` |
| Адаптивность | CSS Custom Properties + Media Queries |
| Тесты | Vitest |

---

## Установка и запуск

```bash
# Установка зависимостей
npm install

# Запуск сервера
npm start

# Режим разработки (с авто-перезапуском)
npm run dev
```

Сервер запускается на `http://localhost:3000`.

Открой две вкладки браузера: в первой создай комнату, во второй подключись по полученному коду.

---

## Архитектура

```
┌─────────────────────┐      WebSocket (Socket.IO)      ┌─────────────────────┐
│   Client A          │ ◄─────────────────────────────► │   Signaling Server  │
│   (браузер)         │                                  │   (Node.js)         │
│                     │                                  │                     │
│   PeerConnection ◄──┼──────── WebRTC (SRTP/SCTP) ──────┼──► PeerConnection   │
│   Client B          │                                  │                     │
└─────────────────────┘                                  └─────────────────────┘
                                                                    │
                                                          ICE / STUN / TURN
                                                                    │
                                                      ┌─────────────┐
                                                      │  STUN/TURN  │
                                                      │   сервер    │
                                                      └─────────────┘
```

### Как это работает

1. Клиент A создаёт комнату → сервер генерирует код
2. Клиент B подключается по коду → сервер уведомляет A
3. A создаёт `RTCPeerConnection`, формирует SDP offer → сервер → B
4. B отвечает SDP answer → сервер → A
5. A/B обмениваются ICE candidates → прямое P2P-соединение
6. Видео/аудио идут напрямую между браузерами (сервер не участвует)

---

## API: Socket.IO события

### Клиент → Сервер

| Событие | Данные | Описание |
|---------|--------|----------|
| `create-room` | `{ uuid }` | Создать комнату |
| `join-room` | `{ code, uuid }` | Подключиться к комнате |
| `offer` | `{ sdp }` | Передать SDP offer |
| `answer` | `{ sdp }` | Передать SDP answer |
| `ice-candidate` | `{ candidate }` | Передать ICE candidate |
| `send-message` | `{ text }` | Отправить сообщение чата |
| `audio-state-change` | `{ muted }` | Состояние микрофона |
| `screen-share-state-change` | `{ active }` | Состояние демонстрации экрана |
| `leave-room` | — | Покинуть комнату |
| `reconnect-room` | `{ code, uuid }` | Переподключиться к комнате после обрыва |

### Сервер → Клиент

| Событие | Данные | Описание |
|---------|--------|----------|
| `room-created` | `{ code }` | Комната создана |
| `room-joined` | `{ code }` | Подключение выполнено |
| `user-joined` | `{ userId }` | Собеседник подключился |
| `offer` | `{ sdp }` | Получен SDP offer |
| `answer` | `{ sdp }` | Получен SDP answer |
| `ice-candidate` | `{ candidate }` | Получен ICE candidate |
| `chat-message` | `{ text, sender }` | Сообщение чата |
| `audio-state-change` | `{ muted }` | Собеседник изменил микрофон |
| `screen-share-state-change` | `{ active }` | Собеседник начал/закончил демонстрацию |
| `room-not-found` | — | Комната не существует |
| `room-full` | — | Комната переполнена |
| `room-error` | `{ message }` | Общая ошибка |
| `peer-disconnected` | `{ canReconnect }` | Собеседник отключился (canReconnect — можно ли переподключиться) |
| `reconnect-success` | `{ code, isCreator }` | Переподключение выполнено успешно |
| `peer-reconnected` | `{ uuid }` | Собеседник переподключился |

---

## Структура проекта

```
├── package.json              # Зависимости и скрипты
├── server.js                 # Signaling server (Express + Socket.IO)
├── vitest.config.js          # Конфигурация Vitest
├── src/
│   ├── code.js               # Генерация и валидация кода комнаты
│   └── state-machine.js      # Конечный автомат (Node.js, для тестов)
├── tests/
│   ├── code.test.js          # Тесты генерации кода
│   ├── room.test.js          # Тесты управления комнатами
│   └── state-machine.test.js # Тесты конечного автомата
├── public/
│   ├── index.html            # SPA-клиент
│   ├── style.css             # Стили (Mobile First, тёмная тема)
│   └── app.js                # Вся клиентская логика
└── docs/
    └── superpowers/
        ├── specs/            # Дизайн-спецификации
        └── plans/            # Планы реализации
```

---

## Тестирование

```bash
# Запуск всех тестов
npm test

# Режим watch
npm run test:watch
```

Тесты написаны на Vitest. Покрытие критических модулей (генерация кода, state machine) — 90%+.

---

## Деплой

Рекомендуемая платформа: **Railway** (поддерживает WebSocket, бесплатно 500 ч/мес).

```bash
# Установка Railway CLI
brew install railway

# Деплой
railway login
railway init
railway up
```

Подробные инструкции для Railway, Fly.io, Render — в [deploy.md](deploy.md).

---

## Security Considerations

- UUIDs are validated on server to prevent injection attacks
- Rate limiting prevents abuse of room creation/joining
- Room codes use unambiguous character set (no I, 1, O, 0)
- Messages are sanitized and length-limited
- Graceful shutdown prevents resource leaks

## Development

Run tests:
```bash
npm test
```

Run in development:
```bash
npm run dev
```

Build for production:
```bash
npm start
```

---

##Лицензия

MIT
