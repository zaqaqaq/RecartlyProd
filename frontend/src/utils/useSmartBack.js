import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * «Умный возврат»: возвращает на предыдущий экран, откуда пришёл пользователь,
 * а не на жёстко заданный раздел.
 *
 * Почему так: раньше из карточки корзины кнопка «назад» всегда вела на список корзин —
 * даже если человек пришёл туда из поиска или с витрины подбора. С history(-1) возврат
 * совпадает с ожиданием, а `fallback` нужен для прямого захода по ссылке, когда истории нет
 * (иначе «назад» выкинуло бы с сайта).
 */
export function useSmartBack(fallback = '/') {
    const navigate = useNavigate();
    const location = useLocation();

    return useCallback(() => {
        const canGoBack = Boolean(location.key) && location.key !== 'default';
        if (canGoBack) {
            navigate(-1);
        } else {
            navigate(fallback);
        }
    }, [navigate, location.key, fallback]);
}

export default useSmartBack;
