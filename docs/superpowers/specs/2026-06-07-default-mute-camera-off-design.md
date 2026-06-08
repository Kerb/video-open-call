# Дизайн: Микрофон muted и камера off при входе в комнату

## Мотивация

При входе в комнату видеозвонка пользователь по умолчанию не хочет, чтобы его микрофон и камера были активны. Это обеспечивает приватность и предотвращает случайную трансляцию аудио/видео до того, как пользователь сам решит включиться.

## Решение

Медиапоток (`getUserMedia`) запрашивается как обычно — он необходим для WebRTC. Но сразу после получения стрима аудио- и видеотреки выключаются (disabled). Пользователь сам включает их кнопками.

## Изменения

### 1. `getLocalMedia()` — отключение треков после получения

Файл: `public/app.js`, функция `getLocalMedia` (строка ~272)

После успешного вызова `getUserMedia` и настройки `srcObject`:

- `audioTracks[0].enabled = false`
- `videoTracks[0].enabled = false`
- `btn-mute dataset.active = 'false'`
- `btn-camera dataset.active = 'false'`
- `local-placeholder display = 'flex'`
- `localVideo display = 'none'`

### 2. Эмит initial audio state при `user-joined`

Файл: `public/app.js`, обработчик `user-joined` (строка ~167)

Когда второй участник подключается — отправляем `audio-state-change { muted: true }`, чтобы на стороне собеседника отобразился индикатор muted.

### 3. HTML defaults

Файл: `public/index.html`

- `btn-mute`: `data-active` = `"true"` → `"false"`
- `btn-camera`: `data-active` = `"true"` → `"false"`
- `local-placeholder`: `style="display:none"` → `style="display:flex"`
- `localVideo`: без изменений (display не задан инлайн)

## Edge cases

| Сценарий | Поведение |
|----------|-----------|
| Permission denied | Уже обработано, показывается placeholder |
| Screen share при camera off | `replaceTrack` работает — заменяет disabled трек на трек экрана |
| После screen share → restore | Восстанавливается disabled видеотрек |
| Reconnect | После переподключения треки остаются disabled |
| Второй участник | Видит mute indicator с самого начала |

## Что не меняется

- Логика `toggleMute()` / `toggleCamera()` — работает корректно с disabled треками
- `camera-state-change` событие не добавляется (YAGNI)
- Серверная логика (`server.js`) не меняется
- Тесты не меняются (нет изменений в API или поведении state machine)

## Файлы для изменения

- `public/app.js` — ~10 строк в `getLocalMedia`, ~6 строк в `user-joined` handler
- `public/index.html` — 4 атрибута
