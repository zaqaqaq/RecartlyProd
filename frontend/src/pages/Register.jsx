import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { register, login } from '../services/api';

function Register() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Город при регистрации не спрашиваем: цены авторские, город не обязателен
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await register(email, username, password);
        } catch (err) {
            console.error('Register error:', err);
            if (err.response && err.response.data && err.response.data.detail) {
                setError(err.response.data.detail);
            } else if (err.message) {
                setError(err.message);
            } else {
                setError('Ошибка регистрации. Попробуйте другой email');
            }
            setLoading(false);
            return;
        }

        try {
            // /auth/register не выдаёт токен — входим сразу после регистрации
            await login(email, password);
            window.dispatchEvent(new Event('authChange'));
            window.dispatchEvent(new Event('storage'));
            navigate('/', { replace: true });
        } catch (loginErr) {
            console.error('Auto-login after register failed:', loginErr);
            navigate('/login', { replace: true });
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
                        <h1 className="heading-2 mt-4">Создать аккаунт</h1>
                        <p className="text-ink-500 dark:text-ink-400 mt-1 text-sm sm:text-base">
                            Присоединяйтесь к Recartly
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
                            <label htmlFor="register-email" className="label">
                                Email
                            </label>
                            <input
                                id="register-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className={`input ${error ? 'input-error' : ''}`}
                                autoComplete="email"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="register-username" className="label">
                                Имя пользователя
                            </label>
                            <input
                                id="register-username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className={`input ${error ? 'input-error' : ''}`}
                                autoComplete="username"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="register-password" className="label">
                                Пароль
                            </label>
                            <input
                                id="register-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={`input ${error ? 'input-error' : ''}`}
                                autoComplete="new-password"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary btn-block"
                        >
                            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
                        </button>
                    </form>

                    <p className="text-center text-ink-600 dark:text-ink-400 mt-6 text-sm">
                        Уже есть аккаунт?{' '}
                        <Link
                            to="/login"
                            className="text-primary-600 dark:text-primary-400 hover:underline font-semibold"
                        >
                            Войдите
                        </Link>
                    </p>
                </div>

                <p className="text-center text-xs text-ink-400 dark:text-ink-500 mt-4 px-4">
                    Регистрация занимает меньше минуты — рецепты, наборы и акции в одном месте.
                </p>
            </div>
        </div>
    );
}

export default Register;
