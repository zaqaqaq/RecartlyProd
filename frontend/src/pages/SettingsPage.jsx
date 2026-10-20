import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMyProfile, updatePassword } from '../services/api';

function SettingsPage() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState(null);

    // Смена пароля
    const [passwordData, setPasswordData] = useState({
        old_password: '',
        new_password: '',
        confirm_password: ''
    });
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);

    useEffect(() => {
        loadProfile();
    }, []);

    const loadProfile = async () => {
        try {
            const data = await getMyProfile();
            setProfile(data);
        } catch (err) {
            console.error('Ошибка загрузки профиля:', err);
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = (e) => {
        setPasswordData({
            ...passwordData,
            [e.target.name]: e.target.value
        });
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        setPasswordError('');
        setPasswordSuccess('');

        if (passwordData.new_password !== passwordData.confirm_password) {
            setPasswordError('Пароли не совпадают');
            return;
        }

        if (passwordData.new_password.length < 6) {
            setPasswordError('Новый пароль должен содержать минимум 6 символов');
            return;
        }

        setPasswordLoading(true);

        try {
            await updatePassword({
                old_password: passwordData.old_password,
                new_password: passwordData.new_password
            });
            setPasswordSuccess('Пароль успешно изменён!');
            setPasswordData({
                old_password: '',
                new_password: '',
                confirm_password: ''
            });
            setTimeout(() => setPasswordSuccess(''), 3000);
        } catch (err) {
            setPasswordError(err.response?.data?.detail || 'Ошибка смены пароля');
        } finally {
            setPasswordLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-2xl mx-auto">
                <div className="card p-8 text-center">
                    <p className="text-ink-500 dark:text-ink-400">Загрузка...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto pb-bottom-nav animate-fade-in">
            <div className="mb-4 sm:mb-6">
                <h1 className="heading-2 border-l-4 border-primary-500 pl-3 sm:pl-4">
                    ⚙️ Настройки
                </h1>
                <p className="text-ink-500 dark:text-ink-400 mt-2 ml-3 sm:ml-4 text-sm sm:text-base">Управление аккаунтом и безопасностью</p>
            </div>

            {/* Смена пароля */}
            <section className="card p-4 sm:p-6 mb-4 sm:mb-6">
                <h2 className="heading-3 mb-4">🔑 Смена пароля</h2>

                {passwordError && (
                    <div className="bg-hot-50 dark:bg-hot-600/15 border border-hot-100 dark:border-hot-600/30 text-hot-600 dark:text-hot-400 px-4 py-3 rounded-2xl text-sm mb-4">
                        {passwordError}
                    </div>
                )}
                {passwordSuccess && (
                    <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-900/40 text-primary-700 dark:text-primary-300 px-4 py-3 rounded-2xl text-sm mb-4">
                        {passwordSuccess}
                    </div>
                )}

                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                    <div>
                        <label className="label">
                            Текущий пароль
                        </label>
                        <input
                            type="password"
                            name="old_password"
                            value={passwordData.old_password}
                            onChange={handlePasswordChange}
                            className="input"
                            autoComplete="current-password"
                            required
                        />
                    </div>
                    <div>
                        <label className="label">
                            Новый пароль
                        </label>
                        <input
                            type="password"
                            name="new_password"
                            value={passwordData.new_password}
                            onChange={handlePasswordChange}
                            className="input"
                            autoComplete="new-password"
                            required
                            minLength="6"
                        />
                    </div>
                    <div>
                        <label className="label">
                            Подтверждение нового пароля
                        </label>
                        <input
                            type="password"
                            name="confirm_password"
                            value={passwordData.confirm_password}
                            onChange={handlePasswordChange}
                            className="input"
                            autoComplete="new-password"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={passwordLoading}
                        className="btn-primary btn-block sm:w-auto"
                    >
                        {passwordLoading ? 'Сохранение...' : 'Сменить пароль'}
                    </button>
                </form>
            </section>

            {/* Уведомления (заглушка) */}
            <section className="card p-4 sm:p-6 mb-4 sm:mb-6">
                <h2 className="heading-3 mb-4">🔔 Уведомления</h2>
                <div className="bg-ink-50 dark:bg-ink-850 rounded-2xl p-4 text-center text-ink-500 dark:text-ink-400">
                    <p className="text-sm">🚧 Раздел в разработке</p>
                    <p className="text-xs mt-1">Скоро здесь будут настройки уведомлений</p>
                </div>
            </section>

            {/* О сайте */}
            <section className="card p-4 sm:p-6">
                <h2 className="heading-3 mb-4">ℹ️ О сайте</h2>
                <div className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
                    <p><span className="font-semibold text-ink-900 dark:text-white">Название:</span> Recartly</p>
                    <p><span className="font-semibold text-ink-900 dark:text-white">Версия:</span> 1.0.0</p>
                    <p><span className="font-semibold text-ink-900 dark:text-white">Описание:</span> Платформа для обмена рецептами, наборами продуктов и акциями</p>
                    <p className="break-all"><span className="font-semibold text-ink-900 dark:text-white">Контакты:</span> support@recartly.ru</p>
                    <p className="text-xs text-ink-400 dark:text-ink-500 mt-2">
                        © 2026 Recartly. Все права защищены.
                    </p>
                </div>
            </section>

            {/* Назад */}
            <div className="mt-4 sm:mt-6 pb-2">
                <button
                    onClick={() => navigate('/profile')}
                    className="btn-secondary btn-block sm:w-auto"
                >
                    ← Назад в профиль
                </button>
            </div>
        </div>
    );
}

export default SettingsPage;
