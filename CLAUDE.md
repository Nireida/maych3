# maych3

Match-3 игра на React 19 + PixiJS 8 (через `@pixi/react` v8).

## Стек

- **React 19** + **TypeScript 4.9** (strict)
- **PixiJS 8** + **@pixi/react 8** для рендера игрового поля
- **Create React App** (react-scripts 5) с **react-app-rewired** для кастомизации webpack
- **Testing Library** (jest-dom, react, user-event) для тестов

## Скрипты

- `npm start` — дев-сервер на http://localhost:3000
- `npm run build` — продакшн-сборка
- `npm test` — Jest в watch-режиме

Все скрипты запускаются через `react-app-rewired`, а не напрямую через `react-scripts`.

## Структура

- `src/` — исходники приложения (`App.tsx` — корневой компонент)
- `public/` — статика CRA
- `config-overrides.js` — патч webpack: отключает `fullySpecified` для `.mjs`,
  чтобы импорты из ESM-сборок `@pixi/react` v8 (например `react-reconciler/constants`
  без расширения) корректно резолвились webpack 5.
- `tsconfig.json` — `target: es5`, `strict: true`, `jsx: react-jsx`

## Нюансы

- При добавлении новых ESM-зависимостей с импортами без расширений может
  понадобиться расширить правило в `config-overrides.js`.
- TS `strict` включён — не игнорируйте типы, не используйте `any` без причины.
- Используется React 19 — учитывайте новые правила (например, `use`, ref как prop).
