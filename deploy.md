# Деплой приложения видеозвонка

## Важное замечание

Наше приложение — **stateful WebSocket-сервер**:

- Комнаты хранятся в памяти (`Map<string, Room>`)
- WebRTC сигнализация работает через Socket.IO (WebSocket)
- Оба участника должны попасть в один экземпляр сервера

Это накладывает ограничения на платформы, где приложение будет работать корректно.

---

## Платформы, которые работают (рекомендуемые)

| Платформа | WebSocket | Stateful | Бесплатно | Сложность |
|-----------|-----------|----------|-----------|-----------|
| **Railway** | ✅ | ✅ | ✅ (500 ч/мес) | ★☆☆ |
| **Fly.io** | ✅ | ✅ | ✅ (3 shared VM) | ★★☆ |
| **Render** | ✅ | ✅ | ❌ ($7/мес WebSocket) | ★☆☆ |
| **Koyeb** | ✅ | ✅ | ✅ | ★★☆ |
| **Vercel** | ❌ | ❌ | ✅ | ★★★ |

Выбирай **Railway** — самый простой способ.

---

## Способ 1: Railway (рекомендуемый)

Railway поддерживает WebSocket «из коробки» и долгоживущие процессы.

### Шаги

1. **Создай аккаунт** на [railway.app](https://railway.app) (GitHub OAuth)

2. **Установи Railway CLI** (опционально):
   ```bash
   brew install railway
   ```

3. **Запушь проект на GitHub**:
   ```bash
   git init
   git add .
   git commit -m "init"
   gh repo create vibe-opencall --public --push
   ```

4. **В дашборде Railway:**
   - Нажми **New Project** → **Deploy from GitHub repo**
   - Выбери репозиторий `vibe-opencall`
   - Railway сам определит Node.js и выполнит `npm start`

5. **Настройки** (если не определились автоматически):
   - **Start Command**: `npm start`
   - **Port**: `3000` (Railway выставляет `PORT` автоматически)

6. **Готово**: Railway выдаст URL вида `https://vibe-opencall.up.railway.app`

> **Совет**: Приложение использует HTTP, не HTTPS в коде — Railway сам проксирует HTTPS.

---

## Способ 2: Fly.io

### Шаги

1. **Установи CLI**:
   ```bash
   brew install flyctl
   ```

2. **Создай `fly.toml`** в корне проекта:
   ```toml
   app = "vibe-opencall"
   primary_region = "ams"

   [env]
   PORT = "3000"

   [[services]]
     internal_port = 3000
     protocol = "tcp"

     [[services.ports]]
       handlers = ["http"]
       port = 80
       force_https = true

     [[services.ports]]
       handlers = ["tls"]
       port = 443
   ```

3. **Задеплояй**:
   ```bash
   flyctl launch
   flyctl deploy
   ```

---

## Способ 3: Render

1. Создай аккаунт на [render.com](https://render.com)
2. **New + Web Service** → подключи GitHub-репозиторий
3. Настройки:
   - **Name**: `vibe-opencall`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: **Starter** ($7/мес, нужен для WebSocket)
4. Нажми **Create Web Service**

> ❌ Бесплатный план Render не поддерживает WebSocket.

---

## Способ 4: Vercel (с ограничениями)

Vercel **не поддерживает WebSocket** на бесплатном плане, а serverless-функции
не гарантируют, что оба пользователя попадут в один экземпляр.

### Что нужно изменить в коде

1. **Удалить `app.listen()`** и экспортировать app:

   Создай `api/index.js` (заменит server.js на Vercel):
   ```javascript
   const express = require('express');
   const { Server } = require('socket.io');
   const http = require('http');

   const app = express();
   const server = http.createServer(app);
   const io = new Server(server, { transports: ['polling'] }); // только polling

   app.use(express.static('public'));

   // --- весь код из server.js сюда, включая комнаты, события ---

   module.exports = app;
   ```

2. **Создай `vercel.json`**:
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "api/index.js",
         "use": "@vercel/node"
       }
     ],
     "routes": [
       { "src": "/(.*)", "dest": "api/index.js" }
     ]
   }
   ```

3. **Замени в `public/index.html`** путь к socket.io:
   ```html
   <script defer src="/api/index.js/socket.io/socket.io.js"></script>
   ```

### Почему это плохая идея

- **Polling** вместо WebSocket — задержка сигнализации растёт
- **Состояние комнат не сохраняется** — Vercel может запустить несколько
  экземпляров функции, и пользователи окажутся в разных экземплярах
- Решение — добавлять внешнее хранилище (Upstash Redis), что усложняет проект

> **Вывод**: Vercel не подходит для этого приложения. Используй Railway.

---

## Что деплоить не нужно

- `node_modules/` — игнорируется (`npm install` выполняется на платформе)
- `.git/` — игнорируется
- `progress.md`, `videocall-spec.md`, `deploy.md` — можно не пушить,
  но они не влияют на работу

---

## После деплоя

Независимо от платформы:

1. Открой URL приложения в двух вкладках браузера
2. В первой нажми **Создать комнату**
3. Скопируй 6-символьный код
4. Во второй нажми **Подключиться к комнате**, введи код
5. Разреши доступ к камере и микрофону в обеих вкладках
6. Готово — видео и аудио передаются P2P
