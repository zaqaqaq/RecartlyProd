import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from '../services/api';

function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await login(email, password);
            if (response && response.access_token) {
                localStorage.setItem('access_token', response.access_token);
                // Диспатчим событие для обновления App.js
                window.dispatchEvent(new Event('authChange'));
                window.dispatchEvent(new Event('storage'));
                navigate('/');
            } else {
                setError('Неверный ответ от сервера');
                setLoading(false);
            }
        } catch (err) {
            console.error('Login error:', err);
            if (err.response && err.response.data && err.response.data.detail) {
                setError(err.response.data.detail);
            } else {
                setError('Ошибка входа. Проверьте email и пароль');
            }
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center py-6 sm:py-12 animate-fade-in">
            <div className="w-full max-w-md">
                <div className="card p-5 sm:p-8">
                    {/* Логотип Recartly */}
                    <div className="text-center mb-6 sm:mb-8">
                        <Link
                            to="/"
                            aria-label="Recartly — на главную"
                            className="inline-flex items-center gap-2 press"
                        >
                            <span className="w-14 h-14 sm:w-16 sm:h-16 rounded-3xl bg-gradient-to-br from-primary-400 to-primary-700 text-white text-2xl sm:text-3xl font-extrabold flex items-center justify-center shadow-brand">
                                R
                            </span>
                        </Link>
                        <h1 className="heading-2 mt-4">Добро пожаловать!</h1>
                        <p className="text-ink-500 dark:text-ink-400 mt-1 text-sm sm:text-base">
                            Войдите в свой аккаунт Recartly
                        </p>
                    </div>

                    {error && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 bg-hot-50 dark:bg-hot-600/15 border border-hot-500/30 dark:border-hot-600/40 text-hot-600 dark:text-hot-400 px-4 py-3 rounded-2xl mb-4 text-sm animate-fade-in"
                        >
                            <span aria-hidden="true">⚠️</span>
                            <span>{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="login-email" className="label">
                                Email
                            </label>
                            <input
                                id="login-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className={`input ${error ? 'input-error' : ''}`}
                                autoComplete="email"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="login-password" className="label">
                                Пароль
                            </label>
                            <input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={`input ${error ? 'input-error' : ''}`}
                                autoComplete="current-password"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary btn-block"
                        >
                            {loading ? 'Вход...' : 'Войти'}
                        </button>
                    </form>

                    <p className="text-center text-ink-600 dark:text-ink-400 mt-6 text-sm">
                        Нет аккаунта?{' '}
                        <Link
                            to="/register"
                            className="text-primary-600 dark:text-primary-400 hover:underline font-semibold"
                        >
                            Зарегистрируйтесь
                        </Link>
                    </p>
                </div>

                <p className="text-center text-xs text-ink-400 dark:text-ink-500 mt-4 px-4">
                    Публикуйте рецепты, корзины и отзывы — делитесь опытом с сообществом.
                </p>
            </div>
        </div>
    );
}

export default Login;
