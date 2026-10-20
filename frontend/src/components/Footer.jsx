import React from 'react';
import { Link } from 'react-router-dom';

function Footer() {
    const isAuthenticated = !!localStorage.getItem('access_token');

    const linkClass =
        'text-sm text-ink-400 hover:text-primary-400 transition-colors inline-flex items-center gap-1.5 py-1';

    return (
        <footer className="bg-ink-900 dark:bg-ink-950 text-ink-400 mt-10 border-t border-ink-800 pb-24 lg:pb-0 safe-bottom">
            <div className="max-w-7xl mx-auto px-4 lg:px-6 pt-8 pb-6 lg:pb-8">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
                    {/* О проекте */}
                    <div className="col-span-2 lg:col-span-1">
                        <h3 className="text-white text-lg font-extrabold mb-3 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center text-white font-extrabold">
                                R
                            </span>
                            Recartly
                        </h3>
                        <p className="text-sm leading-relaxed">
                            Сообщество рецептов: ингредиенты, шаги, список покупок, магазины и цены.
                            Готовьте с умом, экономьте с нами.
                        </p>
                        <div className="flex gap-2 mt-4">
                            {['📱', '📘', '▶️', '💬'].map((icon, i) => (
                                <a
                                    key={i}
                                    href="#"
                                    aria-label="Соцсеть"
                                    className="w-10 h-10 bg-ink-800 rounded-2xl flex items-center justify-center
                                    hover:bg-primary-500 hover:text-white transition-colors"
                                >
                                    <span className="text-sm">{icon}</span>
                                </a>
                            ))}
                        </div>
                    </div>

                    {/* Навигация */}
                    <div>
                        <h3 className="text-white font-bold mb-2 text-sm uppercase tracking-wide">Разделы</h3>
                        <ul className="space-y-0.5">
                            <li><Link to="/" className={linkClass}>🧾 Подбор по бюджету</Link></li>
                            <li><Link to="/recipes" className={linkClass}>📖 Рецепты</Link></li>
                            <li><Link to="/pp" className={linkClass}>🥗 Правильное питание</Link></li>
                            <li><Link to="/feed" className={linkClass}>📣 Лента</Link></li>
                            <li><Link to="/search" className={linkClass}>🔍 Поиск</Link></li>
                        </ul>
                    </div>

                    {/* Аккаунт */}
                    <div>
                        <h3 className="text-white font-bold mb-2 text-sm uppercase tracking-wide">Аккаунт</h3>
                        {isAuthenticated ? (
                            <ul className="space-y-0.5">
                                <li><Link to="/profile" className={linkClass}>👤 Профиль</Link></li>
                                <li><Link to="/my-recipes" className={linkClass}>📝 Мои рецепты</Link></li>
                                <li><Link to="/my-baskets" className={linkClass}>🧺 Мои наборы</Link></li>
                                <li><Link to="/favorites" className={linkClass}>⭐ Избранное</Link></li>
                                <li><Link to="/settings" className={linkClass}>⚙️ Настройки</Link></li>
                            </ul>
                        ) : (
                            <ul className="space-y-0.5">
                                <li><Link to="/login" className={linkClass}>Войти</Link></li>
                                <li><Link to="/register" className={linkClass}>Регистрация</Link></li>
                            </ul>
                        )}
                    </div>

                    {/* Помощь */}
                    <div>
                        <h3 className="text-white font-bold mb-2 text-sm uppercase tracking-wide">Помощь</h3>
                        <ul className="space-y-0.5">
                            <li><a href="mailto:support@recartly.ru" className={linkClass}>📧 support@recartly.ru</a></li>
                            <li><Link to="/create" className={linkClass}>➕ Добавить рецепт</Link></li>
                            <li><Link to="/create-basket" className={linkClass}>➕ Создать набор</Link></li>
                        </ul>
                        <p className="text-xs text-ink-500 mt-3 leading-relaxed">
                            Мы можем получать комиссию, когда вы переходите по ссылкам на магазины.
                            Это не влияет на подборку рецептов.
                        </p>
                    </div>
                </div>

                <div className="border-t border-ink-800 mt-6 pt-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-ink-500">
                    <span>© 2026 Recartly. Все права защищены.</span>
                    <span>Сделано для тех, кто готовит с умом 🍲</span>
                </div>
            </div>
        </footer>
    );
}

export default Footer;
