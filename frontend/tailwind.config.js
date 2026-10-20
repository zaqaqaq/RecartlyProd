/** @type {import('tailwindcss').Config} */
/* ============================================================
   Recartly — дизайн-система «Смета»
   Метафора: чек и бюджет, а не скидочная охота.
   Крем + графит + изумруд; бюджетные сигналы — изумруд/янтарь/коралл.
   ============================================================ */
module.exports = {
    content: [
        "./src/**/*.{js,jsx,ts,tsx}",
        "./public/index.html",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
                /* Заголовки «Сметы» — Manrope (поддерживает кириллицу) */
                display: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
            },
            screens: {
                xs: '420px',
            },
            colors: {
                /* Основной акцент — изумруд (деньги «в рамках бюджета»).
                   Имя primary сохранено, чтобы существующий код перекрасился сам. */
                primary: {
                    50: '#e9fbf1',
                    100: '#cdf5e0',
                    200: '#9fe9c6',
                    300: '#66d8a6',
                    400: '#2fc188',
                    500: '#0fa968',
                    600: '#0b8c56',
                    700: '#0a7046',
                    800: '#0a5838',
                    900: '#08472e',
                },
                /* Коралл — ошибки, удаление, перебор бюджета */
                hot: {
                    50: '#fdecec',
                    100: '#fbdada',
                    400: '#ef6f72',
                    500: '#e5484d',
                    600: '#cc3b40',
                    700: '#a92f34',
                },
                /* Холодный — информационные акценты и «нейтральные» метрики */
                cold: {
                    50: '#eef6fb',
                    100: '#d9ecf7',
                    400: '#5aa9d6',
                    500: '#2f88bd',
                    600: '#1f6d9c',
                },
                /* Янтарь — предупреждение, средние оценки, сезонность */
                secondary: {
                    50: '#fef6e9',
                    100: '#fdeac9',
                    200: '#fad79b',
                    300: '#f7c36c',
                    400: '#f2a93b',
                    500: '#dd9425',
                    600: '#b8771b',
                },
                /* Тёплые нейтральные: крем в светлой теме, «ночная кухня» в тёмной */
                ink: {
                    50: '#faf8f3',
                    100: '#f1ede5',
                    200: '#e3ded3',
                    300: '#c9c2b4',
                    400: '#9a9386',
                    500: '#6e685e',
                    600: '#4f4a43',
                    700: '#3a3630',
                    800: '#232320',
                    850: '#191917',
                    900: '#121211',
                    950: '#0c0c0b',
                },
                /* Семантика бюджета — используется бюджет-рейкой и чеками */
                budget: {
                    ok: '#0fa968',
                    'ok-soft': '#e9fbf1',
                    warn: '#f2a93b',
                    'warn-soft': '#fef6e9',
                    over: '#e5484d',
                    'over-soft': '#fdecec',
                },
                /* Фирменные цвета магазинов (бейджи) */
                shop: {
                    pyaterochka: '#00a13a',
                    magnit: '#e4002b',
                    lenta: '#004b93',
                    perekrestok: '#009a49',
                    ozon: '#005bff',
                    wb: '#cb11ab',
                    yandex: '#fc3f1d',
                    vkusvill: '#1c8a4b',
                },
            },
            animation: {
                'fade-in-up': 'fadeInUp 0.4s ease-out',
                'fade-in': 'fadeIn 0.3s ease-out',
                'slide-up': 'slideUp 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
                'sheet-up': 'sheetUp 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                'pop': 'pop 0.22s ease-out',
                'rail': 'rail 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
                'shimmer': 'shimmer 1.4s linear infinite',
                'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'bounce-slow': 'bounce 1.5s infinite',
            },
            keyframes: {
                fadeInUp: {
                    '0%': { opacity: '0', transform: 'translateY(12px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                sheetUp: {
                    '0%': { transform: 'translateY(100%)' },
                    '100%': { transform: 'translateY(0)' },
                },
                pop: {
                    '0%': { transform: 'scale(0.94)' },
                    '60%': { transform: 'scale(1.03)' },
                    '100%': { transform: 'scale(1)' },
                },
                /* Заполнение бюджет-рейки */
                rail: {
                    '0%': { transform: 'scaleX(0)' },
                    '100%': { transform: 'scaleX(1)' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-500px 0' },
                    '100%': { backgroundPosition: '500px 0' },
                },
            },
            boxShadow: {
                'card': '0 1px 2px rgba(18,18,17,0.04), 0 4px 14px rgba(18,18,17,0.05)',
                'card-hover': '0 8px 24px rgba(18,18,17,0.10), 0 2px 6px rgba(18,18,17,0.06)',
                'card-dark': '0 1px 2px rgba(0,0,0,0.5), 0 4px 14px rgba(0,0,0,0.35)',
                'card-hover-dark': '0 10px 28px rgba(0,0,0,0.55)',
                'nav': '0 -2px 16px rgba(18,18,17,0.08)',
                'brand': '0 6px 18px rgba(15,169,104,0.28)',
                'brand-lg': '0 10px 30px rgba(15,169,104,0.34)',
                /* Тень «чека» — мягкая, будто бумага лежит на столе */
                'receipt': '0 1px 0 rgba(18,18,17,0.04), 0 12px 28px -12px rgba(18,18,17,0.18)',
            },
            borderRadius: {
                'xl': '12px',
                '2xl': '16px',
                '3xl': '22px',
                '4xl': '28px',
            },
            transitionTimingFunction: {
                'pepper': 'cubic-bezier(0.22, 1, 0.36, 1)',
                'smeta': 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
        },
    },
    plugins: [],
}
