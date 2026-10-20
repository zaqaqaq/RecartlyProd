import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import Footer from './components/Footer';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import CreateRecipe from './pages/CreateRecipe';
import RecipePage from './pages/RecipePage';
import SearchPage from './pages/SearchPage';
import ProfilePage from './pages/ProfilePage';
import MyRecipes from './pages/MyRecipes';
import Favorites from './pages/Favorites';
import SettingsPage from './pages/SettingsPage';
// «Смета»: бюджетный подбор, блюда, наборы, меню, остатки, челленджи
import BudgetPage from './pages/BudgetPage';
import RecipesPage from './pages/RecipesPage';
import PPPage from './pages/PPPage';
import BasketPage from './pages/BasketPage';
import CreateBasketPage from './pages/CreateBasketPage';
import MyBasketsPage from './pages/MyBasketsPage';
import MealPlanPage from './pages/MealPlanPage';
import PantryPage from './pages/PantryPage';
import ChallengesPage from './pages/ChallengesPage';
import NotificationsPage from './pages/NotificationsPage';
import Onboarding from './components/Onboarding';
import DashboardPage from './pages/DashboardPage';
import PromosPage from './pages/PromosPage';
import PromoDetailPage from './pages/PromoDetailPage';
import AdminPage from './pages/AdminPage';

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    // Проверяем авторизацию при загрузке
    useEffect(() => {
        const checkAuth = () => {
            const token = localStorage.getItem('access_token');
            setIsAuthenticated(!!token);
            setLoading(false);
        };

        checkAuth();

        // Слушаем изменения в localStorage (из других вкладок)
        const handleStorageChange = () => {
            const token = localStorage.getItem('access_token');
            setIsAuthenticated(!!token);
        };

        // Слушаем кастомное событие (из Login.jsx)
        const handleAuthChange = () => {
            const token = localStorage.getItem('access_token');
            setIsAuthenticated(!!token);
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('authChange', handleAuthChange);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('authChange', handleAuthChange);
        };
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-ink-50 dark:bg-ink-950 flex flex-col items-center justify-center gap-4">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary-400 to-primary-700 text-white text-3xl font-extrabold flex items-center justify-center shadow-brand-lg animate-pop">
                    R
                </div>
                <p className="text-ink-500 dark:text-ink-400 text-sm font-medium">Загружаем Recartly…</p>
            </div>
        );
    }

    return (
        <Router>
            <div className="min-h-screen bg-ink-50 dark:bg-ink-950 flex flex-col overflow-x-hidden">
                <Navbar />
                {/* Приветственный онбординг: показывается один раз, сам решает, нужен ли */}
                <Onboarding />
                <main className="flex-1 w-full px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
                    <Routes>
                        {/* Витрина подбора — главный экран, лента сообщества — на /feed */}
                        <Route path="/" element={<BudgetPage />} />
                        <Route path="/recipes" element={<RecipesPage />} />
                        <Route path="/pp" element={<PPPage />} />
                        <Route path="/feed" element={<Home />} />
                        <Route path="/budget" element={<Navigate to="/" replace />} />
                        <Route path="/login" element={<Login />} />
                        <Route path="/register" element={<Register />} />
                        <Route path="/search" element={<SearchPage />} />
                        <Route
                            path="/create"
                            element={isAuthenticated ? <CreateRecipe /> : <Navigate to="/login" />}
                        />
                        <Route path="/recipe/:id" element={<RecipePage />} />
                        <Route path="/profile" element={<ProfilePage />} />
                        <Route path="/my-recipes" element={<MyRecipes />} />
                        <Route path="/favorites" element={<Favorites />} />
                        <Route path="/settings" element={<SettingsPage />} />

                        {/* «Смета»: наборы, меню, остатки, челленджи */}
                        <Route path="/basket/shared/:token" element={<BasketPage />} />
                        <Route path="/basket/:id" element={<BasketPage />} />
                        <Route
                            path="/create-basket"
                            element={isAuthenticated ? <CreateBasketPage /> : <Navigate to="/login" />}
                        />
                        <Route path="/my-baskets" element={<MyBasketsPage />} />
                        <Route path="/mealplan" element={<MealPlanPage />} />
                        <Route path="/pantry" element={<PantryPage />} />
                        <Route path="/challenges" element={<ChallengesPage />} />
                        <Route path="/notifications" element={<NotificationsPage />} />
                        <Route path="/week" element={<DashboardPage />} />
                        <Route path="/promos" element={<PromosPage />} />
                        <Route path="/promos/:id" element={<PromoDetailPage />} />
                        <Route path="/admin" element={<AdminPage />} />
                    </Routes>
                </main>
                <Footer />
                {/* Нижняя навигация и кнопка «+» — только для вошедших:
                    гостю они не нужны, он ещё не пользуется сервисом */}
                {isAuthenticated && <BottomNav />}
            </div>
        </Router>
    );
}

export default App;
