export const CONFIG = {
    CHANNEL_NAME: 'daymonmontage',
    TILT_FORCE: 3,
    ACHIEVEMENT_MAX_STACK: 3,
    ACHIEVEMENT_TIME: 4000,
    REDIRECT_DELAY: 1500,
    
    // Эти данные должны быть идентичны в обоих проектах
    SUPABASE_URL: 'https://zddnfjnvplxutzjbpkwe.supabase.co', 
    SUPABASE_KEY: 'sb_publishable_bBE_oWza0XdFBY-uIS6MAw_abtrIZRG',

    // Пути к репозиториям
    MAIN_SITE_URL: 'https://daymonmontage.github.io/daymon-site/',
    GAMES_SITE_URL: 'https://daymonmontage.github.io/daymon-games/' 
};

export const ALLOWED_HOSTS = [
    "daymonmontage.github.io",
    "localhost",
    "127.0.0.1"
];

export const ACHIEVEMENT_DATA = {
    'twitch':     { title: "Ты че, стример чтоли?",     desc: "Канал открыт" },
    'telegram':   { title: "Шифрованный канал",         desc: "Telegram" },
    'youtube':    { title: "Ценитель бэкграунда",       desc: "YouTube VODs" },
    'tiktok':     { title: "В поисках ЛонлиЛонли",      desc: "Деградация успешно" },
    'vk':         { title: "Раньше было лучше",         desc: "Дуров, верни стену" },
    'discord':    { title: "Жажда мурчать",             desc: "Зашел на сервер" },
    'steam':      { title: "Где сосут чемпионы",        desc: "Проверка инвентаря" },
    'soundcloud': { title: "Бетховен оценил бы",        desc: "Музыкальный вкус: Имба" },
    'insta':      { title: "Запрещенная сеть",          desc: "Смотри, но не трогай" },
    'da':         { title: "Сделай мне приятно",        desc: "DonationAlerts" },
    'card-bb':    { title: "На картошку",               desc: "Беларусбанк: Скопировано" },
    'card-prior': { title: "Буржуйские деньги",         desc: "Priorbank: Скопировано" },
    'stream-preview': { title: "В эфире",               desc: "Подключение к базе..." },
    'autoclicker': { title: "Автокликер",               desc: "А по жопе?" },
    'click-67':   { title: "СИХС СЭВАААН!",             desc: "67 кликов" },
    'click-100':  { title: "Правда, может хватит?",     desc: "100 кликов" },
    'click-228':  { title: "Удел АФК стримера",         desc: "228 кликов" },
    'click-666':  { title: "Ох чорт о боже о чорт",     desc: "666 кликов" },
    'click-777':  { title: "Нужен додеп?",              desc: "777 кликов" },
    'click-1000': { title: "может найдешь хобби?",      desc: "1000 кликов" },
    'click-1337': { title: "Взлом жёпы",                desc: "1337 кликов" },
    'click-1488': { title: "Глупое сочетание цифр",     desc: "1488 кликов" }
};