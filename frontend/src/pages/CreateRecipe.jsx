import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createRecipe, uploadPhoto } from '../services/api';
import { mediaUrl } from '../utils/media';

/* Ингредиент: название, количество, цена и необязательное фото продукта. */
const emptyIngredient = () => ({ name: '', quantity: '', price: '', photo_url: '' });

/* Шаг приготовления: текст и необязательное фото.
   `id` нужен, чтобы очередь загрузки и превью не «переезжали» на другой шаг
   при удалении или перемещении блоков. */
const emptyStep = () => ({ id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: '', photo_url: '' });

function CreateRecipe() {
    const navigate = useNavigate();
    const location = useLocation();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [photoPreview, setPhotoPreview] = useState('');
    const [photoUrl, setPhotoUrl] = useState('');
    /* Точечные загрузки (фото ингредиента или шага): ключ -> {loading, preview}.
       Ключ — «поле-индекс», у шагов — «поле-id», тогда он переживает перемещение. */
    const [uploads, setUploads] = useState({});
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        ingredients: [emptyIngredient()],
        steps: [emptyStep()]
    });

    const uploadTimers = useRef({});

    useEffect(() => {
        return () => Object.values(uploadTimers.current).forEach((t) => window.clearTimeout(t));
    }, []);

    // Рецепт можно создать на основе чужой корзины: ингредиенты и стоимость
    // подставляются из сметы, автор дописывает шаги.
    useEffect(() => {
        const source = location.state?.fromCart;
        if (!source) return;

        const items = source.items || [];
        setFormData({
            title: source.title || '',
            description: source.description || '',
            ingredients: items.length
                ? items.map((item) => ({
                      ...emptyIngredient(),
                      name: item.name || '',
                      quantity: item.quantity != null ? `${item.quantity} ${item.unit || ''}`.trim() : '',
                      price: item.price != null ? String(item.price) : '',
                  }))
                : [emptyIngredient()],
            steps: [emptyStep()],
        });
    }, [location.state]);

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    /* ---------- Ингредиенты ---------- */

    const handleIngredientChange = (index, field, value) => {
        const newIngredients = [...formData.ingredients];
        newIngredients[index] = { ...newIngredients[index], [field]: value };
        setFormData({ ...formData, ingredients: newIngredients });
    };

    const addIngredient = () => {
        setFormData({
            ...formData,
            ingredients: [...formData.ingredients, emptyIngredient()]
        });
    };

    const removeIngredient = (index) => {
        if (formData.ingredients.length > 1) {
            const newIngredients = formData.ingredients.filter((_, i) => i !== index);
            setFormData({ ...formData, ingredients: newIngredients });
            // Ключи загрузок привязаны к позиции: после сдвига чистим, чтобы
            // временное превью удалённой строки не «переехало» на соседнюю.
            setUploads((prev) => {
                const next = { ...prev };
                Object.keys(next).forEach((key) => {
                    if (/^ingredient-\d+$/.test(key)) delete next[key];
                });
                return next;
            });
        }
    };

    /* ---------- Шаги ---------- */

    const handleStepTextChange = (index, value) => {
        const newSteps = [...formData.steps];
        newSteps[index] = { ...newSteps[index], text: value };
        setFormData({ ...formData, steps: newSteps });
    };

    const addStep = () => {
        setFormData({ ...formData, steps: [...formData.steps, emptyStep()] });
    };

    const removeStep = (index) => {
        if (formData.steps.length === 1) return;
        setFormData({ ...formData, steps: formData.steps.filter((_, i) => i !== index) });
    };

    /* Перемещение шага вверх/вниз: нумерация пересчитывается сама по порядку массива. */
    const moveStep = (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= formData.steps.length) return;
        const newSteps = [...formData.steps];
        const [moved] = newSteps.splice(index, 1);
        newSteps.splice(target, 0, moved);
        setFormData({ ...formData, steps: newSteps });
    };

    /* ---------- Фото ---------- */

    /* Общий загрузчик: фото рецепта, ингредиента и шага идут через один
       эндпоинт uploadPhoto() — отдельного аплоада для шагов и ингредиентов нет. */
    const uploadStepPhoto = async (file, field, index, id) => {
        const key = `${field}-${id}`;
        const localPreview = URL.createObjectURL(file);
        setUploads((prev) => ({ ...prev, [key]: { loading: true, preview: localPreview } }));

        const formDataPhoto = new FormData();
        formDataPhoto.append('file', file);

        try {
            const response = await uploadPhoto(formDataPhoto);
            setFormData((prev) => {
                if (field === 'ingredient') {
                    const ingredients = [...prev.ingredients];
                    if (!ingredients[index]) return prev;
                    ingredients[index] = { ...ingredients[index], photo_url: response.photo_url };
                    return { ...prev, ingredients };
                }
                const steps = prev.steps.map((step) =>
                    step.id === id ? { ...step, photo_url: response.photo_url } : step
                );
                return { ...prev, steps };
            });
        } catch (err) {
            console.error('Ошибка загрузки фото:', err);
            setError(field === 'ingredient' ? 'Не удалось загрузить фото продукта' : 'Не удалось загрузить фото шага');
            URL.revokeObjectURL(localPreview);
            setUploads((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
            return;
        }

        // Локальное превью показываем, пока сервер не отдал файл по своему URL.
        uploadTimers.current[key] = window.setTimeout(() => {
            setUploads((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
            URL.revokeObjectURL(localPreview);
            delete uploadTimers.current[key];
        }, 700);
    };

    const clearFieldPhoto = (field, index, id) => {
        const key = `${field}-${id}`;
        setFormData((prev) => {
            if (field === 'ingredient') {
                const ingredients = [...prev.ingredients];
                if (!ingredients[index]) return prev;
                ingredients[index] = { ...ingredients[index], photo_url: '' };
                return { ...prev, ingredients };
            }
            return {
                ...prev,
                steps: prev.steps.map((step) => (step.id === id ? { ...step, photo_url: '' } : step)),
            };
        });
        setUploads((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            if (next[key].preview) URL.revokeObjectURL(next[key].preview);
            delete next[key];
            return next;
        });
    };

    /* Фото блюда — как и раньше, одно большое превью. */
    const handlePhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Превью
        const previewUrl = URL.createObjectURL(file);
        setPhotoPreview(previewUrl);

        // Загрузка на сервер
        const formDataPhoto = new FormData();
        formDataPhoto.append('file', file);

        setUploadingPhoto(true);
        try {
            const response = await uploadPhoto(formDataPhoto);
            setPhotoUrl(response.photo_url);
        } catch (err) {
            console.error('Ошибка загрузки фото:', err);
            setError('Не удалось загрузить фото');
            setPhotoPreview('');
        } finally {
            setUploadingPhoto(false);
        }
    };

    /* ---------- Отправка ---------- */

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        // Пустые блоки шагов молча не теряем: просим заполнить или удалить.
        const steps = formData.steps
            .map((step) => ({ text: (step.text || '').trim(), photo_url: step.photo_url || null }))
            .filter((step) => step.text);

        if (steps.length === 0) {
            setError('Добавьте хотя бы один шаг приготовления');
            setLoading(false);
            return;
        }

        if (steps.length !== formData.steps.length) {
            setError('Заполните текст у каждого шага или удалите пустой шаг');
            setLoading(false);
            return;
        }

        // Backend ждёт обязательное текстовое поле instructions (NOT NULL).
        // Собираем его из шагов, чтобы не дублировать ввод в форме.
        const instructions = steps.map((step, i) => `${i + 1}. ${step.text}`).join('\n');

        const recipeData = {
            title: formData.title,
            description: formData.description,
            instructions,
            photo_url: photoUrl || null,
            ingredients: formData.ingredients
                .filter(ing => ing.name && ing.quantity)
                .map(ing => ({
                    name: ing.name,
                    quantity: ing.quantity,
                    price: ing.price ? parseFloat(ing.price) : null,
                    photo_url: ing.photo_url || null
                })),
            steps
        };

        if (recipeData.ingredients.length === 0) {
            setError('Добавьте хотя бы один ингредиент');
            setLoading(false);
            return;
        }

        try {
            const created = await createRecipe(recipeData);
            // Ведём автора на страницу рецепта: если контент ушёл на модерацию,
            // он увидит свой рецепт и баннер «на проверке», а не пустую ленту.
            if (created && created.id) {
                navigate(`/recipe/${created.id}`, { state: { justCreated: true } });
            } else {
                navigate('/my-recipes');
            }
        } catch (err) {
            setError(err.response?.data?.detail || 'Ошибка создания рецепта');
        } finally {
            setLoading(false);
        }
    };

    /* Приблизительная сумма по ингредиентам — только презентация, в запрос не попадает */
    const ingredientsTotal = formData.ingredients.reduce(
        (sum, ing) => sum + (parseFloat(ing.price) || 0),
        0
    );

    return (
        <div className="max-w-3xl mx-auto animate-fade-in">
            {/* Заголовок */}
            <header className="mb-5 sm:mb-6">
                <h1 className="heading-1 border-l-4 border-primary-500 pl-3 sm:pl-4">
                    Новый рецепт
                </h1>
                <p className="text-ink-500 dark:text-ink-400 mt-2 pl-3 sm:pl-4">Поделитесь своим кулинарным шедевром</p>
            </header>

            <form id="create-recipe-form" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                {error && (
                    <div className="rounded-2xl border border-hot-200 dark:border-hot-600/40 bg-hot-50 dark:bg-hot-600/15 text-hot-600 dark:text-hot-400 px-4 py-3 text-sm font-semibold">
                        ⚠️ {error}
                    </div>
                )}

                {/* Фото */}
                <section className="card p-3.5 sm:p-5">
                    <h2 className="section-title mb-3">📷 Фото блюда</h2>
                    <div className="flex flex-col xs:flex-row xs:items-center gap-3">
                        {photoPreview ? (
                            <img
                                src={mediaUrl(photoPreview)}
                                alt="Preview"
                                className="w-full h-40 xs:w-24 xs:h-24 object-cover rounded-2xl flex-shrink-0"
                            />
                        ) : (
                            <div className="w-full h-28 xs:w-24 xs:h-24 rounded-2xl border-2 border-dashed border-ink-300 dark:border-ink-700 bg-ink-50 dark:bg-ink-850 flex items-center justify-center text-2xl text-ink-300 dark:text-ink-600">
                                🍲
                            </div>
                        )}
                        <label className="btn-secondary btn-block xs:w-auto cursor-pointer">
                            {uploadingPhoto ? 'Загрузка...' : 'Выбрать фото'}
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handlePhotoUpload}
                                disabled={uploadingPhoto}
                                className="hidden"
                            />
                        </label>
                    </div>
                    <p className="text-xs text-ink-400 dark:text-ink-500 mt-1.5">Можно загрузить фото блюда</p>
                </section>

                {/* Основное */}
                <section className="card p-3.5 sm:p-5 space-y-4">
                    <div>
                        <label htmlFor="recipe-title" className="label">
                            Название рецепта <span className="text-hot-500">*</span>
                        </label>
                        <input
                            id="recipe-title"
                            type="text"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            placeholder="Например: Домашние сырники с вареньем"
                            className="input"
                            required
                        />
                    </div>

                    <div>
                        <label htmlFor="recipe-description" className="label">
                            Описание
                        </label>
                        <textarea
                            id="recipe-description"
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            rows="4"
                            placeholder="Почему этот рецепт хорош, на что обратить внимание, для кого подходит"
                            className="input resize-y"
                        />
                        <p className="text-xs text-ink-400 dark:text-ink-500 mt-1.5">
                            Расскажите о блюде: вкус, нюансы готовки, на сколько порций хватит
                        </p>
                    </div>
                </section>

                {/* Ингредиенты */}
                <section className="card p-3.5 sm:p-5">
                    <div className="flex items-center justify-between gap-2 mb-3">
                        <h2 className="section-title">🧺 Ингредиенты <span className="text-hot-500">*</span></h2>
                        {ingredientsTotal > 0 && (
                            <span className="price text-base sm:text-lg whitespace-nowrap">
                                ≈ {ingredientsTotal.toFixed(2)}
                                <span className="text-sm"> ₽</span>
                            </span>
                        )}
                    </div>

                    <p className="text-xs text-ink-400 dark:text-ink-500 mb-3">Фото продукта — необязательно</p>

                    <div className="space-y-3">
                        {formData.ingredients.map((ingredient, index) => {
                            const key = `ingredient-${index}`;
                            const upload = uploads[key];
                            // Локальное превью важнее уже загруженного: показываем
                            // именно то, что выбрал пользователь последним.
                            const preview = upload?.preview || ingredient.photo_url;

                            return (
                                <div
                                    key={index}
                                    className="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-850 p-2.5 sm:p-3"
                                >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                        {/* Фото продукта: миниатюра 40×40 либо кнопка «📷» ≥44 px */}
                                        {preview ? (
                                            <div className="relative flex-shrink-0 self-center sm:self-auto">
                                                <a
                                                    href={mediaUrl(preview)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Открыть фото в новой вкладке"
                                                    className="block"
                                                >
                                                    <img
                                                        src={mediaUrl(preview)}
                                                        alt={ingredient.name ? `Фото: ${ingredient.name}` : 'Фото продукта'}
                                                        className="w-10 h-10 rounded-xl object-cover border border-ink-200 dark:border-ink-700"
                                                    />
                                                </a>
                                                <button
                                                    type="button"
                                                    onClick={() => clearFieldPhoto('ingredient', index, index)}
                                                    aria-label={`Убрать фото продукта ${index + 1}`}
                                                    title="Убрать фото"
                                                    className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-hot-600 hover:bg-hot-700 text-white text-xs leading-none shadow-sm transition-colors"
                                                >
                                                    ×
                                                </button>
                                                {upload?.loading && (
                                                    <span className="absolute inset-0 rounded-xl bg-ink-950/50 text-white text-[10px] font-semibold flex items-center justify-center">
                                                        ...
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <label
                                                className="inline-flex items-center justify-center w-11 h-11 self-center sm:self-auto rounded-xl border-2 border-dashed border-ink-300 dark:border-ink-700 bg-white/60 dark:bg-ink-900/40 text-lg text-ink-500 dark:text-ink-400 cursor-pointer hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex-shrink-0"
                                                title="Приложить фото продукта"
                                            >
                                                {upload?.loading ? '⏳' : '📷'}
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    aria-label={`Фото продукта ${index + 1}`}
                                                    disabled={!!upload?.loading}
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) uploadStepPhoto(file, 'ingredient', index, index);
                                                        e.target.value = '';
                                                    }}
                                                />
                                            </label>
                                        )}
                                        <input
                                            type="text"
                                            placeholder="Название"
                                            value={ingredient.name}
                                            onChange={(e) => handleIngredientChange(index, 'name', e.target.value)}
                                            className="input sm:flex-1 sm:min-w-[120px]"
                                            required
                                        />
                                        <input
                                            type="text"
                                            placeholder="Количество"
                                            value={ingredient.quantity}
                                            onChange={(e) => handleIngredientChange(index, 'quantity', e.target.value)}
                                            className="input sm:w-32"
                                            required
                                        />
                                        <input
                                            type="number"
                                            placeholder="Цена, ₽"
                                            value={ingredient.price}
                                            onChange={(e) => handleIngredientChange(index, 'price', e.target.value)}
                                            className="input sm:w-28"
                                            step="0.01"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeIngredient(index)}
                                            aria-label={`Удалить ингредиент ${index + 1}`}
                                            title="Удалить"
                                            className="inline-flex items-center justify-center w-11 h-11 self-end sm:self-auto rounded-xl bg-hot-600 hover:bg-hot-700 text-white text-lg leading-none transition-colors flex-shrink-0"
                                        >
                                            ×
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        onClick={addIngredient}
                        className="btn-outline btn-block sm:w-auto mt-3"
                    >
                        <span className="text-lg leading-none">+</span> Добавить ингредиент
                    </button>
                </section>

                {/* Шаги приготовления */}
                <section className="card p-3.5 sm:p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                        <h2 className="section-title">👨‍🍳 Шаги приготовления <span className="text-hot-500">*</span></h2>
                        <span className="text-xs text-ink-400 dark:text-ink-500 tabular-nums">
                            {formData.steps.length} {formData.steps.length === 1 ? 'шаг' : 'шагов'}
                        </span>
                    </div>
                    <p className="text-xs text-ink-400 dark:text-ink-500 mb-3">
                        Опишите каждый шаг и при желании приложите фото — так понятнее, что должно получиться
                    </p>

                    <div className="space-y-3">
                        {formData.steps.map((step, index) => {
                            const key = `step-${step.id}`;
                            const upload = uploads[key];
                            const preview = upload?.preview || step.photo_url;
                            const isFirst = index === 0;
                            const isLast = index === formData.steps.length - 1;

                            return (
                                <div
                                    key={step.id}
                                    className="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-850 p-2.5 sm:p-3"
                                >
                                    <div className="flex items-start gap-2.5">
                                        <span className="w-7 h-7 mt-1 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-extrabold flex items-center justify-center flex-shrink-0 tabular-nums">
                                            {index + 1}
                                        </span>
                                        <textarea
                                            value={step.text}
                                            onChange={(e) => handleStepTextChange(index, e.target.value)}
                                            rows="2"
                                            placeholder={`Шаг ${index + 1}: например, творог размять с яйцом`}
                                            aria-label={`Текст шага ${index + 1}`}
                                            className="input resize-y flex-1 min-w-0"
                                        />
                                    </div>

                                    <div className="mt-2.5 pl-0 sm:pl-[38px] flex flex-wrap items-center gap-2">
                                        {preview ? (
                                            <div className="relative">
                                                <a
                                                    href={mediaUrl(preview)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Открыть фото в новой вкладке"
                                                    className="block"
                                                >
                                                    <img
                                                        src={mediaUrl(preview)}
                                                        alt={`Фото шага ${index + 1}`}
                                                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border border-ink-200 dark:border-ink-700"
                                                    />
                                                </a>
                                                {upload?.loading && (
                                                    <span className="absolute inset-0 rounded-xl bg-ink-950/50 text-white text-[10px] font-semibold flex items-center justify-center">
                                                        ...
                                                    </span>
                                                )}
                                            </div>
                                        ) : null}

                                        <label className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-2xl text-sm font-semibold cursor-pointer transition-colors
                                            bg-white dark:bg-ink-900 text-ink-700 dark:text-ink-200 border border-ink-200 dark:border-ink-700 hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400">
                                            <span aria-hidden="true">📷</span>
                                            {upload?.loading ? 'Загрузка...' : (preview ? 'Заменить фото' : 'Приложить фото')}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                disabled={!!upload?.loading}
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) uploadStepPhoto(file, 'step', index, step.id);
                                                    e.target.value = '';
                                                }}
                                            />
                                        </label>

                                        {preview && (
                                            <button
                                                type="button"
                                                onClick={() => clearFieldPhoto('step', index, step.id)}
                                                className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-2xl text-sm font-semibold transition-colors
                                                    text-hot-600 dark:text-hot-400 bg-hot-50 dark:bg-hot-600/15 hover:bg-hot-100 dark:hover:bg-hot-600/25"
                                            >
                                                Убрать
                                            </button>
                                        )}

                                        <div className="flex items-center gap-2 ml-auto">
                                            <button
                                                type="button"
                                                onClick={() => moveStep(index, -1)}
                                                disabled={isFirst}
                                                aria-label={`Переместить шаг ${index + 1} выше`}
                                                title="Выше"
                                                className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200 text-lg leading-none transition-colors hover:border-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveStep(index, 1)}
                                                disabled={isLast}
                                                aria-label={`Переместить шаг ${index + 1} ниже`}
                                                title="Ниже"
                                                className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200 text-lg leading-none transition-colors hover:border-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                ↓
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeStep(index)}
                                                disabled={formData.steps.length === 1}
                                                aria-label={`Удалить шаг ${index + 1}`}
                                                title="Удалить шаг"
                                                className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-hot-600 hover:bg-hot-700 text-white text-lg leading-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        onClick={addStep}
                        className="btn-outline btn-block sm:w-auto mt-3"
                    >
                        <span className="text-lg leading-none">＋</span> Добавить шаг
                    </button>
                </section>
            </form>

            {/* Липкая панель действий — CTA под большим пальцем на мобильных */}
            <div
                className="sticky z-30 safe-bottom -mx-3 sm:mx-0 px-3 sm:px-0 py-3
                bg-ink-50/95 dark:bg-ink-950/95 backdrop-blur-xl
                border-t border-ink-200 dark:border-ink-800 sm:border-0
                sm:bg-transparent sm:backdrop-blur-none dark:sm:bg-transparent
                rounded-t-3xl sm:rounded-none
                lg:bottom-0"
                style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }}
            >
                <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-4">
                    <button
                        type="submit"
                        form="create-recipe-form"
                        disabled={loading || uploadingPhoto}
                        className="btn-primary btn-block sm:flex-1 order-1"
                    >
                        {loading ? 'Публикация...' : 'Опубликовать рецепт'}
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="btn-secondary btn-block sm:flex-1 order-2"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
}

export default CreateRecipe;
