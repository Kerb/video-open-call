# Добавление версии в footer главного экрана

## Описание

При каждом запуске сервера в footer главного экрана (home-screen) отображается версия
приложения формата `YYYY.MM.DD.NNNN`, где:
- `YYYY.MM.DD` — дата запуска (день сборки)
- `NNNN` — порядковый номер билда (общее количество коммитов в git)

## Архитектура

```
scripts/generate-version.js      # Скрипт генерации версии (prestart/predev)
         │
         ▼
public/version.json              # Статический JSON с версией
         │
         ▼ (fetch /version.json)
app.js                           # Клиентская логика — вставка в footer
         │
         ▼
index.html                       # <footer id="app-version"> в home-screen
```

## Компоненты

### 1. `scripts/generate-version.js`
- Node.js скрипт, запускается перед стартом сервера
- Выполняет `git rev-list --count HEAD` через `execSync`
- Берёт текущую дату (локальное время)
- Формирует строку версии и записывает `public/version.json`
- При ошибке выполнения git — номер билда = 1 (fallback)

### 2. `package.json` — скрипты
- `prestart`: `node scripts/generate-version.js`
- `predev`: `node scripts/generate-version.js`

### 3. `index.html` — footer
- Элемент `<footer class="app-footer" id="app-version"></footer>`
- Расположение: внутри `#home-screen`, после `.home-content`, перед закрывающим `</div>`

### 4. `app.js` — загрузка версии
- При старте (в начале `DOMContentLoaded` или после инициализации):
  - `fetch('/version.json')` → парсинг → `document.getElementById('app-version').textContent = data.version`

### 5. `style.css` — стилизация footer
- Маленький текст, полупрозрачный, центрированный
- `position: absolute; bottom: 8px; width: 100%; text-align: center;`
- `font-size: 11px; color: rgba(255,255,255,0.35);`

## Обработка ошибок

- Если `version.json` не загрузился — footer остаётся пустым (не ломает страницу)
- Если git недоступен — номер билда = 1, дата текущая
- Нет зависимости версии от состояния сети или серверных данных

## Тестирование

- Ручная проверка: `npm start` → открыть http://localhost:3000 → видна версия в footer
- `version.json` создаётся в `public/` после запуска скрипта
