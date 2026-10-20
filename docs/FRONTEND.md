# Фронтенд Recartly

Документ описывает React-приложение `frontend/src`: маршруты, страницы, компоненты, слой работы
с API, утилиты, дизайн-систему и PWA. Контракты эндпоинтов — в [`API.md`](API.md), бизнес-логика
расчётов — на бэкенде.

## Оглавление

1. [Структура и стек](#структура-и-стек)
2. [Маршруты и страницы](#маршруты-и-страницы)
3. [Компоненты](#компоненты)
4. [Сервисы](#сервисы)
5. [Утилиты](#утилиты)
6. [Дизайн-система «Смета»](#дизайн-система-смета)
7. [PWA](#pwa)
8. [Локальное состояние в браузере](#локальное-состояние-в-браузере)
9. [Как добавить новую страницу или компонент](#как-добавить-новую-страницу-или-компонент)
10. [Расхождения с описаниями в репозитории](#расхождения-с-описаниями-в-репозитории)

## Структура и стек

```
frontend/
├── public/
│   ├── manifest.json      манифест PWA
│   ├── sw.js              service worker (офлайн-оболочка)
│   ├── offline.html       офлайн-заглушка
│   ├── icons/             иконки 192/512/maskable/apple-touch
│   └── index.html         HTML-шаблон CRA
├── src/
│   ├── index.js           ReactDOM + регистрация SW + прокрутка лент
│   ├── App.js             BrowserRouter, маршруты, проверка авторизации
│   ├── pages/             24 страницы
│   ├── components/        25 компонентов
│   ├── services/          api.js, smeta.js
│   ├── utils/             media.js, promo.js, shopColors.js, hscroll.js, useSmartBack.js
│   ├── index.css          Tailwind + компонентные классы «Сметы»
│   └── serviceWorkerRegistration.js
├── tailwind.config.js     токены, шрифты, анимации, тени
├── nginx.conf             конфиг prod-раздачи
├── Dockerfile             dev-образ (npm start)
└── Dockerfile.prod        build CRA → nginx
```

Стек: React 18, React Router 6, Create React App 5, Tailwind CSS 3. Состояние — локальное
(`useState`/`useEffect`), глобального стора (Redux/Zustand/Context) нет. Запросы — `fetch` через
обёртку `request()` в `services/api.js`. TypeScript не используется, файлы — `.js`/`.jsx`.

## Маршруты и страницы

Все маршруты объявлены в `App.js` внутри `<BrowserRouter>`; общий каркас — `Navbar`, `Onboarding`,
`<main>`, `Footer`, `BottomNav` (только для авторизованных). Проверка авторизации — по наличию
`access_token` в `localStorage`; роль на клиенте не проверяется, админка дополнительно спрашивает
`GET /admin/whoami`.

| Путь | Компонент | Назначение | Доступ |
|---|---|---|---|
| `/` | `BudgetPage` | главная: гостю — `GuestsLanding`, вошедшему — подбор по бюджету (табы «Корзины»/«Блюда», фильтры бюджета и числа человек, сортировки, бюджет-рейка) | все |
| `/recipes` | `RecipesPage` | «Рецепты» — блюда без набора, с клиентским фильтром по `basket_id` | все |
| `/pp` | `PPPage` | правильное питание: блюда из наборов с фильтрами по калориям и белку, пресеты и ползунки | все |
| `/feed` | `Home` | лента сообщества: табы «Наборы» / «Блюда» / «Рецепты» | все |
| `/budget` | — | редирект на `/` | все |
| `/login` | `Login` | вход по email и паролю, сохраняет токен и данные профиля | гость |
| `/register` | `Register` | регистрация и автоматический вход | гость |
| `/search` | `SearchPage` | поиск рецептов по названию и цене, добавление в избранное | все |
| `/create` | `CreateRecipe` | создание рецепта: ингредиенты, шаги с фото, обложка | авторизованные |
| `/recipe/:id` | `RecipePage` | карточка блюда: ингредиенты, шаги, RatingWidget, набор (`RecipeCostBlock`), комментарии, жалоба, статус модерации для автора | все |
| `/profile` | `ProfilePage` | профиль: аватар (пресеты/загрузка), био, город, счётчики, свои рецепты и наборы | все (по факту — свой) |
| `/my-recipes` | `MyRecipes` | мои рецепты со статусами и удалением | все |
| `/favorites` | `Favorites` | избранные рецепты | все |
| `/settings` | `SettingsPage` | смена пароля | все |
| `/basket/shared/:token` | `BasketPage` | набор по ссылке-токену (семейная закупка), без авторизации | все |
| `/basket/:id` | `BasketPage` | карточка набора: состав, цены, свежесть, блюда из набора, обсуждение, действия автора | все |
| `/create-basket` | `CreateBasketPage` | создание набора: вручную или из рецепта (`?recipe_id=`), две фотографии, позиции с магазинами и ценами | авторизованные |
| `/my-baskets` | `MyBasketsPage` | мои наборы: открыть, поделиться, удалить | все |
| `/mealplan` | `MealPlanPage` | генерация меню под бюджет (дни, порции, диета, КБЖУ), предпросмотр и сохранение | все (сохранение — авторизованные) |
| `/pantry` | `PantryPage` | «собери из того, что есть»: остатки дома, подбор блюд, стоимость докупки | все |
| `/challenges` | `ChallengesPage` | челленджи бюджета, лидерборд, участие рецептом, ачивки и баллы | все |
| `/notifications` | `NotificationsPage` | уведомления: список, отметка прочитанного, «прочитать все», удаление | все |
| `/week` | `DashboardPage` | «Моя неделя»: план, наборы, траты, экономия, сравнение с доставкой | все |
| `/promos` | `PromosPage` | акции города: табы «горячие/свежие/скидка», «мои акции», создание | все |
| `/promos/:id` | `PromoDetailPage` | карточка акции: цена, скидка, срок, магазин, лайк, переход в магазин, удаление | все |
| `/admin` | `AdminPage` | модерация: `whoami`, метрики, очередь, жалобы, журнал; экран «нет доступа» для остальных | `moderator`/`admin` (проверка на сервере) |

### Что важно в ключевых экранах

- **`BudgetPage`** не вызывает `/catalog/budget`: данные берутся из `/baskets/feed` и
  `/baskets/dishes`. Бюджет сравнивается с ценой набора целиком; «на сколько человек» —
  мультивыбор (1/2/4/6). Гость видит презентацию (`GuestsLanding`) — это осознанное решение,
  чтобы не показывать ему ошибку загрузки и объяснить ценность входа.
- **`BasketPage`** — самый насыщенный экран: состав с чекбоксами, обновление цен через
  bottom-sheet (дата обязательна, старые цены уходят в `prev_price`), блюда из набора,
  комментарии с эмодзи-реакциями, шаринг и смена видимости. Автор определяется сравнением
  `basket.username` с `username` из `localStorage`; отдельного флага `is_owner` в ответе нет,
  поэтому сравнение по имени — хрупкое место (при смене username права в UI «потеряются»).
- **`CreateBasketPage`** умеет собирать набор из рецепта: `GET /baskets/preview` отдаёт состав
  до сохранения; при сохранении в режиме рецепта состав и цены пересобирает сервер, а присланные
  позиции нужны, чтобы перенести фото покупок. В ручном режиме позиции сохраняются как есть.
- **`PPPage`** работает только с блюдами, у которых есть набор: фильтры по калориям и белку
  применяются к `/baskets/dishes`.
- **`AdminPage`** проверяет доступ через `GET /admin/whoami` (localStorage можно подделать),
  показывает автофлаги с цветовой маркировкой, причины отклонения и журнал.

## Компоненты

| Компонент | Назначение | Где используется |
|---|---|---|
| `Navbar.jsx` | липкая шапка: назад, логотип, разделы, поиск, колокольчик, тема, меню профиля; отдельная проверка профиля через `/profile/me` | `App.js` |
| `BottomNav.jsx` | нижняя навигация (мобильные): Бюджет, Блюда, акцентная «+», ПП, Профиль + шторка «Что добавим?» | `App.js` (только авторизованным) |
| `Footer.jsx` | компактный подвал со ссылками и оговоркой о партнёрских ссылках | `App.js` |
| `Onboarding.jsx` | приветственный онбординг: бюджет, порции, карта разделов; флаг `recartly_onboarded`, значения в `recartly_budget`/`recartly_servings` | `App.js` |
| `BackButton.jsx` | кнопка «назад» в шапке с логикой истории | `Navbar` |
| `SearchBar.jsx` | строка поиска, объявлена на верхнем уровне модуля (иначе React пересоздаёт компонент) | `Navbar` |
| `ThemeToggle.jsx` | переключение светлой/тёмной темы, класс `dark` на `<html>`, ключ `theme` | `Navbar` |
| `NotificationBell.jsx` | колокольчик со счётчиком непрочитанных (`/notifications/unread-count`) | `Navbar` |
| `UserMenu.jsx` | выпадающее меню профиля (профиль, настройки, выход) | **не подключён**: `Navbar` рисует меню сам |
| `BasketCard.jsx` | карточка набора: фото, автор, цена, дата и свежесть цен, лайк; экспортирует общие помощники `formatMoney`, `formatCount`, `pluralRu`, `formatPricesDate`, `pricesFreshnessMeta` | `BudgetPage`, `Home`, `BasketPage`, `MyBasketsPage`, `DishCard`, `RecipeCostBlock`, `GuestsLanding`, `BasketCommentList` |
| `DishCard.jsx` | карточка блюда из набора: фото, RI, КБЖУ, цена набора, свежесть цен | `BudgetPage`, `Home`, `PPPage`, `GuestsLanding` |
| `RecipeCard.jsx` | карточка рецепта без набора (лента «Рецепты») | `Home`, `RecipesPage` |
| `BasketCommentList.jsx` | обсуждение набора: комментарии, ответы, эмодзи-реакции, удаление (форматтеры берёт из `BasketCard`) | `BasketPage` |
| `BudgetRail.jsx` | бюджет-рейка: потрачено/лимит, состояния «в бюджете / близко / перебор» | `BudgetPage`, `DashboardPage`, `MealPlanPage` |
| `RecipeCostBlock.jsx` | блок «Набор для этого блюда» на странице рецепта: цена, дата, ссылка на набор | `RecipePage` |
| `RatingWidget.jsx` | три оси оценок по 5 звёзд, отметка «я приготовил», агрегаты, RI | `RecipePage` |
| `RiBadge.jsx` | компактный бейдж Индекса Recartly (≥70 высокий, ≥45 средний, иначе низкий) | `DishCard`, `RatingWidget`, `RecipePage`, `SearchPage` |
| `TrustBadge.jsx` | бейджи доверия: проверено модерацией, подтверждённая цена, надёжный автор | `RecipePage` |
| `ReportButton.jsx` | «Пожаловаться» с выбором причины через bottom-sheet | `RecipePage`, `PromoDetailPage` |
| `PromoCard.jsx` | карточка акции: старая/новая цена, скидка, срок, лайк | `PromosPage`, `PromoFeed` |
| `PromoFeed.jsx` | компактная лента акций с формой создания | **не подключён** (используется только `PromoCard`/`PromoForm` напрямую) |
| `PromoForm.jsx` | bottom-sheet создания акции: магазин, продукт, цены, фото, город | `PromosPage` |
| `CityCombobox.jsx` | выбор города с поиском и добавлением нового | `PromoForm` |
| `GuestsLanding.jsx` | презентационный экран гостя: оффер, фичи, шаги, живые ленты наборов и блюд с автопрокруткой | `BudgetPage` |
| `SkeletonCard.jsx` | скелетон карточки ленты (варианты `recipe`/…); в актуальных страницах используются собственные скелетоны | **не подключён** |

Общие правила для компонентов: мобильный-first, тач-таргеты ≥ 44 px, тёмная тема обязательна,
никакой горизонтальной прокрутки страницы (для лент — класс `.hscroll`), длинные тексты
обрезаются `line-clamp-*`.

## Сервисы

### `services/api.js`

Единая обёртка:

```js
request(endpoint, method = 'GET', body = null, requiresAuth = false, isFormData = false)
```

- добавляет `Content-Type: application/json`, кроме `FormData`;
- при `requiresAuth` подставляет `Authorization: Bearer <access_token>` из `localStorage`;
- кидает `Error` с `detail` из ответа или `HTTP <статус>`;
- возвращает `null` для `204`, иначе JSON.

Группы функций:

| Домен | Функции |
|---|---|
| Авторизация | `register`, `login` (сохраняет токен, username, avatar_url, role), `getCurrentUser`, `getMyProfile`, `updateProfile`, `getUserProfile`, `uploadAvatar`, `updatePassword` |
| Рецепты | `getRecipes`, `searchRecipes`, `getRecipe`, `createRecipe`, `deleteRecipe`, `uploadPhoto`, `getMyRecipes` |
| Реакции и RI | `getRecipeReactions`, `rateRecipe`, `deleteRecipeReaction`, `uploadCookedPhoto` (ходят на `/recipes/{id}/reactions`) |
| Избранное | `addFavorite`, `removeFavorite`, `getFavorites` |
| Комментарии | `getComments`, `createComment`, `deleteComment`, `getLatestComments` |
| Достижения | `getMyAchievements` (`/profile/me/achievements`) |
| Админка | `getAdminWhoami`, `getAdminStats`, `getModerationQueue`, `approveModerationTask`, `rejectModerationTask`, `needsChangesModerationTask`, `getAdminReports`, `resolveAdminReport`, `createUserSanction`, `getAdminAudit` |

### `services/smeta.js`

Все функции «Сметы» сгруппированы по доменам; используется тот же `request`, поэтому логика
авторизации и ошибок единая. Параметры собираются хелпером `qs()`, который пропускает
`undefined/null/''` и разворачивает массивы в повторяющиеся ключи (`servings=2&servings=4`).

| Домен | Функции |
|---|---|
| Наборы и блюда | `getBasketFeed`, `getDishFeed`, `getBasket`, `getBasketRecipes`, `getBasketComments`, `addBasketComment`, `likeBasket`, `unlikeBasket`, `updateBasketPrices`, `createBasket`, `getMyBaskets`, `deleteBasket`, `shareBasket` |
| География | `getCities`, `searchCities`, `createCity`, `getShops`, `createCustomShop`, `deleteCustomShop` |
| Бюджетный подбор | `getBudgetSelection`, `getBudgetShelves`, `getRecipeCost`, `getSeasonalProducts`, `getPriceHistory` |
| Партнёрские ссылки | `getAffiliateLink`, `getShopRedirectUrl` |
| Набор: ссылки и отметки | `getSharedBasket`, `previewBasket`, `reactToComment`, `deleteBasketComment`, `setBasketVisibility`, `patchBasketItem`, `optimizeBasket` |
| План питания | `generateMealPlan(payload, save)`, `getMyMealPlans`, `getMealPlan`, `deleteMealPlan` |
| Остатки дома | `getPantry`, `addPantryItem`, `deletePantryItem`, `suggestByPantry` |
| Челленджи и награды | `getChallenges`, `getLeaderboard`, `joinChallenge`, `getMyAchievements`, `getAchievementsCatalog`, `checkAchievements` |
| Жалобы | `getReportReasons`, `createReport`, `getMyReports` |
| Уведомления | `getNotifications`, `getUnreadNotificationsCount`, `markNotificationRead`, `markAllNotificationsRead`, `deleteNotification` |
| Тренды цен | `getPriceTrends` |
| Цены от людей | `searchProducts`, `createPrice`, `uploadPricePhoto`, `getMyPrices`, `getRecentPrices`, `confirmPrice` |
| «Моя неделя» | `getWeekSummary` |
| Акции | `getPromos`, `getMyPromos`, `getPromo`, `createPromo`, `uploadPromoPhoto`, `likePromo`, `unlikePromo`, `deletePromo` |

Обёртки для эндпоинтов, которые текущий интерфейс не вызывает: `getBudgetSelection`,
`getBudgetShelves`, `getRecipeCost`, `getSeasonalProducts`, `getPriceHistory`, `getPriceTrends`,
`createPrice`, `getMyPrices`, `getRecentPrices`, `optimizeBasket`, `getShopRedirectUrl`,
`searchCities`, `getMyReports`. Они оставлены как готовый клиент для соответствующих API
(подбор по `price_quotes`, краудсорсинг цен, тренды); витрина сейчас работает на наборах.

## Утилиты

| Файл | Назначение |
|---|---|
| `utils/media.js` | `API_URL` (см. ниже) и `mediaUrl(path)` — абсолютный URL для `/uploads`-файлов; пропускает `http(s)`, `data:`, `blob:` и `emoji:` |
| `utils/promo.js` | форматирование акций: `promoMoney`, `promoPrice`, `promoDiscount`, `promoEndsLabel`, `promoAuthor`, `PROMO_STATUS` |
| `utils/shopColors.js` | эмодзи и Tailwind-классы для бейджей магазинов по названию (`getShopStyle`); использует стандартные `green/red/blue/...`, а не токены `shop-*` |
| `utils/hscroll.js` | прокрутка `.hscroll` мышью (drag) и колесом; обработчики делегированы на `document`, чтобы работать и в динамически появляющихся шторках |
| `utils/useSmartBack.js` | хук «умный возврат»: `navigate(-1)`, если в истории есть предыдущий экран, иначе `navigate(fallback)` |

### Как вычисляется `API_URL`

```js
const ENV_API_URL = process.env.REACT_APP_API_URL;
// если пусто или содержит localhost/127.0.0.1:
//   `${window.location.protocol}//${window.location.hostname}:8000`
// иначе — ENV_API_URL как есть
```

Практические следствия:

- при разработке (`npm start`) и `REACT_APP_API_URL=http://localhost:8000` запросы идут на
  `localhost:8000`;
- при открытии по IP (`http://192.168.1.10:3000`) запросы идут на `http://192.168.1.10:8000` —
  поэтому бэкенд должен быть доступен по этому адресу, а CORS его разрешает;
- переменная вшивается на этапе сборки CRA: менять её после `npm run build` бесполезно;
- в `smeta.js` функция `getShopRedirectUrl()` собирает адрес напрямую из
  `process.env.REACT_APP_API_URL`, а не из `API_URL`. В текущем UI она не используется, но при
  применении на телефоне по IP даст неверный адрес — это известное расхождение.

## Дизайн-система «Смета»

Токены — в `tailwind.config.js`, компонентные классы — в `src/index.css`. Метафора — чек и
бюджет: кремовый фон, графит, изумруд.

| Токен | Значение / назначение |
|---|---|
| `primary-500` | `#0fa968`, главный акцент, CTA, цена |
| `primary-600/700` | hover / pressed |
| `hot-500/600` | `#e5484d` / `#cc3b40` — ошибки, удаление, перебор бюджета |
| `secondary-400` | `#f2a93b` — предупреждение, средние оценки, сезонность |
| `cold-*` | информационные нейтральные акценты |
| `ink-50…950` | тёплые нейтральные: крем в светлой теме, «ночная кухня» в тёмной |
| `budget-ok/warn/over` | состояния бюджет-рейки и плашек |
| `shop-*` | фирменные цвета магазинов (в коде бейджи чаще используют `shopColors.js`) |

Типографика: заголовки — Manrope (`font-display`), текст — Inter; все числа — `.tabular`.
Радиусы: карточки `rounded-2xl`, крупные блоки `rounded-3xl`, чипы `rounded-full`.
Тени: `.card` → `shadow-card`, чек → `shadow-receipt`. Анимации: `animate-fade-in`,
`animate-slide-up`, `animate-sheet-up`, `animate-pop`, `animate-rail`.

Ключевые классы:

| Класс | Назначение |
|---|---|
| `.btn-primary/secondary/outline/danger/ghost`, `.btn-block` | кнопки с тач-таргетом ≥ 44 px |
| `.card`, `.card-hover`, `.card-feed` | карточки |
| `.receipt-card`, `.receipt-body`, `.receipt-tear`, `.receipt-notch`, `.receipt-row`, `.receipt-row-lead` | чек-карточка с «отрывной» линией и точками-выносками |
| `.budget-rail`, `.budget-rail-fill(-ok/-warn/-over)` | бюджет-рейка |
| `.budget-pill`, `.budget-ok/warn/over` | плашки состояний |
| `.shelf-head`, `.shelf-title`, `.shelf-range` | полки бюджета |
| `.metric`, `.metric-value`, `.metric-label` | метрики (₽/порция, ккал, белок) |
| `.ri-badge`, `.ri-high/mid/low`, `.ri-bar` | Индекс Recartly |
| `.check-row` | строка списка покупок |
| `.chip`, `.tab-pill`, `.tab-pill-active` | чипы фильтров и табы |
| `.input`, `.label` | поля форм |
| `.avatar`, `.skeleton`, `.press`, `.tabular` | аватары, скелетоны, нажатие, цифры |
| `.hscroll`, `.no-scrollbar` | горизонтальные ленты |
| `.safe-top/bottom/x`, `.pb-bottom-nav` | safe-area и отступ под нижнюю навигацию |
| `.bottom-nav*` | нижняя навигация |

Правила мобильной вёрстки (из `frontend/DESIGN.md`, соблюдаются в коде): mobile-first,
без горизонтальной прокрутки страницы, тач-таргеты ≥ 44×44, таблицы → карточки, модалки —
bottom-sheet, CTA — `sticky bottom-0`, тёмная тема для каждого нового элемента.

## PWA

- **`public/manifest.json`**: `name`/`short_name`, `start_url: "/"`, `scope: "/"`,
  `display: "standalone"`, `orientation: "portrait"`, `theme_color: "#0fa968"`,
  `background_color: "#faf8f3"`, иконки 192/512 + maskable + apple-touch, три shortcut
  («Подобрать по бюджету», «Создать рецепт», «Поиск»).
- **`public/sw.js`**: две стратегии и одно правило.
  - навигация — network-first с фолбэком на кэшированный `index.html` и `/offline.html`;
  - статика — stale-while-revalidate (обновление в фоне);
  - запросы к API (`localhost:8000`, `127.0.0.1:8000`, `/api/`) и `/uploads/` — **только сеть**,
    кэш не используется.
- **`src/serviceWorkerRegistration.js`**: регистрация только в `production`; в development SW
  не ставится, чтобы не мешать hot-reload. Есть `unregisterServiceWorker()`.
- **`public/offline.html`** — офлайн-заглушка.
- **nginx** (`frontend/nginx.conf`): SPA-fallback, `no-cache` для `sw.js`, `manifest.json`,
  `index.html`; долгий кэш для `/static/`; `application/manifest+json` для манифеста.
- **Проверка PWA локально:** `npm run build && npm run serve:build` (порт 5055) или
  `docker compose -f docker-compose.prod.yml up --build` (порт 3000).
  Для установки на телефон нужен HTTPS или localhost; по локальному IP удобно поднять туннель.

## Локальное состояние в браузере

| Ключ | Кто пишет | Зачем |
|---|---|---|
| `access_token` | `api.js` (login) | авторизация, проверка в `App.js` |
| `username`, `avatar_url`, `role` | `api.js`, `Navbar` | шапка, меню, пункт «Модерация» |
| `theme` | `ThemeToggle` | светлая/тёмная тема |
| `recartly_onboarded` | `Onboarding` | показывать онбординг один раз |
| `recartly_budget`, `recartly_servings` | `Onboarding` | стартовые значения бюджета и порций |
| `recartly_city_id` | `PromosPage` | выбранный город для ленты акций |

События `authChange` (после входа/регистрации) и `storage` (другая вкладка) синхронизируют
состояние `Navbar` и `App` без глобального стора.

## Как добавить новую страницу или компонент

### Новая страница

1. Создайте файл в `src/pages/`, например `PromoArchivePage.jsx`. Возьмите за образец
   существующую страницу: заголовок `heading-1`, контейнер `max-w-5xl mx-auto animate-fade-in`,
   при необходимости `pb-bottom-nav`, скелетоны и обработку ошибок.
2. Добавьте функцию API в подходящий сервис: «смета» — в `services/smeta.js`, остальное — в
   `services/api.js`. Не вызывайте `fetch` напрямую, чтобы сохранить авторизацию и обработку
   ошибок.
3. Импортируйте страницу в `App.js` и добавьте `<Route path="/promo-archive" element={...} />`.
   Если страница требует входа — оберните как `/create`: `isAuthenticated ? <Page /> : <Navigate to="/login" />`.
4. Добавьте пункт навигации: в `Navbar.jsx` (`TOP_LINKS`) и/или `BottomNav.jsx` (`navItems`),
   с учётом мобильного вида. Проверьте тёмную тему, 360 px и тач-таргеты.

### Новый компонент

1. Создайте `src/components/MyBlock.jsx` с именованным `function` и `export default`.
2. Используйте только токены и компонентные классы (`card`, `btn-primary`, `chip`, `metric`,
   `budget-pill`…), не «сырые» `green-*`/`orange-*`; добавьте `dark:`-варианты.
3. Все изображения с бэкенда пропускайте через `mediaUrl()`, деньги форматируйте через
   `formatMoney`/`promoPrice`, склонения — через `pluralRu`.
4. Если блок нужен на нескольких экранах — вынесите форматтеры рядом с компонентом (как сделано
   в `BasketCard.jsx`) и импортируйте их, чтобы подписи не расходились.

## Расхождения с описаниями в репозитории

- `frontend/README.md` частично устарел: упоминает компоненты `ReceiptCard`, `SplitBasket`,
  `PriceTrends`, `BudgetFilters`, которых в `src/components` нет; онбординг описан с шагом
  «город» (в коде города нет), тема названа оранжевой (сейчас изумрудная), а количество городов
  указано 1085 (в `backend/data/russian_cities.json` — 1105 записей). Источник правды — код.
- `frontend/DESIGN.md` описывает дизайн-систему и правила вёрстки; перечисленные там классы
  `receipt-*`, `split-option`, `metric`, `check-row`, `ri-badge` в `index.css` есть, но
  компонентов `ReceiptCard`/`SplitBasket` нет — эти блоки свёрстаны внутри страниц.
- `UserMenu`, `SkeletonCard`, `PromoFeed` существуют, но не подключены к актуальным экранам.
- Комментарий в `services/api.js` говорит, что эндпоинты `/reviews` отключены; фактически
  `reviews_router` зарегистрирован в `main.py`, просто UI его не вызывает.
