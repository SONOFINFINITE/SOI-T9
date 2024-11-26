class MistralPredictor {
    constructor(apiKey) {
        this.API_URL = 'https://api.mistral.ai/v1/chat/completions';
        this.apiKey = apiKey;
        this.messageHistory = [];
        this.cache = new Map();
        this.wordFrequency = new WordFrequencyCache();
        this.lastRequestTime = 0;
        this.MIN_REQUEST_INTERVAL = 10;
    }

    async initialize(messages) {
        this.messageHistory = messages.slice(-10);
    }

    addMessageToContext(message) {
        this.messageHistory.push(message);
        if (this.messageHistory.length > 10) {
            this.messageHistory.shift();
        }
    }

    getLastWord(text) {
        const words = text.split(/\s+/);
        return words[words.length - 1] || '';
    }

    getWordCase(word) {
        if (!word) return 'lower';
        
        // Проверяем, есть ли две заглавные буквы подряд
        for (let i = 0; i < word.length - 1; i++) {
            if (word[i] === word[i].toUpperCase() && 
                word[i + 1] === word[i + 1].toUpperCase() &&
                /[А-ЯЁ]/.test(word[i]) && /[А-ЯЁ]/.test(word[i + 1])) {
                console.log('SYNTX DEBUG: Найдены две заглавные буквы подряд');
                return 'upper';
            }
        }
        
        // Если первая буква заглавная (Пр -> Привет)
        if (word[0] === word[0].toUpperCase() && /[А-ЯЁ]/.test(word[0])) {
            console.log('SYNTX DEBUG: Слово с заглавной буквы');
            return 'title';
        }
        
        // В остальных случаях все строчные (пр -> привет)
        console.log('SYNTX DEBUG: Слово в нижнем регистре');
        return 'lower';
    }

    applyCase(text, caseType) {
        if (!text) return text;
        
        switch (caseType) {
            case 'upper':
                return text.toUpperCase();
            case 'title':
                return text[0].toUpperCase() + text.slice(1).toLowerCase();
            case 'lower':
            default:
                return text.toLowerCase();
        }
    }

    shouldCapitalize(text, lastWord) {
        console.log('SYNTX DEBUG: shouldCapitalize вход:', { text, lastWord });
        
        // Разбиваем текст на предложения по знакам препинания
        const sentences = text.split(/([.!?])\s*/).filter(Boolean);
        console.log('SYNTX DEBUG: Предложения:', sentences);

        // Если это первое слово в тексте или после знака препинания
        const lastSentence = sentences[sentences.length - 1];
        const lastPunctuation = text.match(/[.!?]\s*$/);

        // Если текст пустой или заканчивается знаком препинания - следующее слово с большой буквы
        if (!text.trim() || lastPunctuation) {
            console.log('SYNTX DEBUG: Начало нового предложения');
            return true;
        }

        console.log('SYNTX DEBUG: Обычное слово внутри предложения');
        return false;
    }

    cleanupJsonString(str) {
        // Заменяем все виды кавычек на двойные английские
        str = str.replace(/[«»„""]/g, '"');
        
        // Убираем пробелы между запятыми и следующим словом
        str = str.replace(/,\s+/g, ',');
        
        // Если строка не начинается с [, добавляем
        if (!str.startsWith('[')) str = '[' + str;
        
        // Если строка не заканчивается на ], добавляем
        if (!str.endsWith(']')) str += ']';
        
        return str;
    }

    async getPrediction(text) {
        try {
            const lastWord = this.getLastWord(text);
            if (!lastWord) return [];

            // Сначала проверяем кэш частых слов
            const cachedPredictions = this.wordFrequency.getPredictions(lastWord);
            if (cachedPredictions.length > 0) {
                console.log('SYNTX DEBUG: Найдены предсказания в кэше частот:', cachedPredictions);
                return cachedPredictions.map(word => this.applyCase(word, this.getWordCase(lastWord)));
            }

            // Получаем контекст предложения (всё до последнего слова)
            const context = text.slice(0, text.lastIndexOf(lastWord)).trim();
            console.log('SYNTX DEBUG: Контекст:', context, 'Последнее слово:', lastWord);

            // Определяем регистр по последнему слову
            const wordCase = this.getWordCase(lastWord);
            console.log('SYNTX DEBUG: Определён регистр:', wordCase, 'для слова:', lastWord);

            const prompt = `Ты - высокоточная система предиктивного ввода текста (T9), разработанная по принципам SwiftKey. Твоя задача - предугадывать и предлагать следующие слова на основе глубокого анализа контекста, грамматики и пользовательских паттернов.

ВХОДНЫЕ ДАННЫЕ:
Контекст предложения: "${context}"
Текущий ввод пользователя: "${lastWord}"

СИСТЕМНЫЕ ТРЕБОВАНИЯ:

1. КОНТЕКСТУАЛЬНЫЙ АНАЛИЗ:
   1.1. Тематический анализ:
       • Определение основной темы диалога
       • Выявление подтем и связанных концептов
       • Отслеживание смены темы в разговоре
       • Учёт эмоционального окраса беседы

   1.2. Анализ предыдущего контекста:
       • История последних 10-15 сообщений
       • Часто используемые пользователем фразы
       • Персональные языковые паттерны
       • Предпочитаемый стиль общения

   1.3. Ситуационный анализ:
       • Формальность контекста (деловой/личный)
       • Тип коммуникации (чат/email/документ)
       • Специфика предметной области
       • Социальный контекст общения

2. ЛИНГВИСТИЧЕСКИЙ АНАЛИЗ:

   2.1. Морфологический уровень:
       а) Существительные:
          • Падежная система (И, Р, Д, В, Т, П)
          • Категория числа (ед.ч. ↔ мн.ч.)
          • Категория рода (м, ж, ср)
          • Одушевлённость/неодушевлённость
          • Собственные/нарицательные

       б) Прилагательные:
          • Полные/краткие формы
          • Степени сравнения
          • Качественные/относительные/притяжательные
          • Согласование с существительными

       в) Глаголы:
          • Время (прошедшее, настоящее, будущее)
          • Вид (совершенный/несовершенный)
          • Наклонение (изъявительное, повелительное, условное)
          • Лицо и число
          • Переходность
          • Возвратность

       г) Местоимения:
          • Личные (я/ты/он/она/оно/мы/вы/они)
          • Притяжательные (мой/твой/его/её/их)
          • Указательные (этот/тот/такой)
          • Определительные (весь/сам/каждый)
          • Вопросительные (кто/что/какой)

       д) Числительные:
          • Количественные (один, два, пять)
          • Порядковые (первый, второй)
          • Собирательные (двое, трое)
          • Дробные (полтора, две третьих)

   2.2. Синтаксический уровень:
       а) Словосочетания:
          • Согласование (красивый дом)
          • Управление (думать о будущем)
          • Примыкание (быстро бежать)

       б) Предложения:
          • Типы по цели высказывания
          • Типы по эмоциональной окраске
          • Члены предложения
          • Порядок слов

   2.3. Семантический уровень:
       • Лексическое значение слов
       • Многозначность
       • Синонимы/антонимы
       • Омонимы
       • Паронимы

3. АЛГОРИТМ ПРЕДСКАЗАНИЯ:

   3.1. Приоритизация предсказаний:
       а) Высший приоритет:
          • Точные грамматические соответствия
          • Высокочастотные словосочетания
          • Устойчивые выражения
          • Персональные паттерны пользователя

       б) Средний приоритет:
          • Тематически связанные слова
          • Синонимичные выражения
          • Стилистически подходящие варианты

       в) Низший приоритет:
          • Общие слова без явной связи
          • Редко используемые выражения

   3.2. Контекстные триггеры:
       а) Предлоги:
          • "в" + П.п. или В.п. (в доме/в дом)
          • "с" + Р.п. или Т.п. (с полки/с другом)
          • "к" + Д.п. (к врачу)
          • "от" + Р.п. (от друга)
          • "по" + Д.п. или В.п. (по дороге/по одному)
          • "про" + В.п. (про фильм)
          • "при" + П.п. (при встрече)

       б) Союзы:
          • "и" → однородные члены
          • "но" → противопоставление
          • "или" → альтернатива
          • "потому что" → причина
          • "чтобы" → цель

       в) Частицы:
          • "не" → отрицание
          • "бы" → условное наклонение
          • "ли" → вопрос
          • "же" → усиление

   3.3. Специальные случаи:
       а) Устойчивые выражения:
          • Фразеологизмы
          • Пословицы
          • Поговорки
          • Речевые клише

       б) Профессиональная лексика:
          • Термины
          • Аббревиатуры
          • Специальные обозначения

       в) Имена собственные:
          • Имена людей
          • Географические названия
          • Названия организаций

4. ПРИМЕРЫ СЛОЖНЫХ СЛУЧАЕВ:

   4.1. Предложные конструкции:
       • "в течение п" → ["последних", "прошедших", "предыдущих"]
       • "несмотря на т" → ["трудности", "тревоги", "требования"]
       • "в связи с п" → ["переездом", "праздником", "проблемой"]

   4.2. Устойчивые выражения:
       • "бок о" → ["бок"]
       • "время от" → ["времени"]
       • "душа в" → ["душу"]

   4.3. Согласование времён:
       • "вчера я п" → ["пошёл", "приехал", "позвонил"]
       • "завтра мы п" → ["пойдём", "поедем", "позвоним"]
       • "сейчас он" → ["идёт", "едет", "звонит"]

   4.4. Сложные падежные формы:
       • После числительных:
         - "два ч" → ["часа", "человека", "чемодана"]
         - "пять ч" → ["часов", "человек", "чемоданов"]
       • После отрицания:
         - "нет в" → ["времени", "возможности", "вариантов"]
       • После количественных слов:
         - "много л" → ["людей", "лет", "листьев"]

5. ПРАВИЛА ВЫВОДА:

   5.1. Формат ответа:
       • Строго JSON-массив из трёх вариантов
       • Варианты отсортированы по релевантности
       • Все слова грамматически корректны
       • Учтён регистр исходного слова

   5.2. Критерии качества:
       • Грамматическая точность: 100%
       • Семантическая релевантность
       • Стилистическое соответствие
       • Контекстуальная уместность

ФОРМАТ ОТВЕТА:
Верни только JSON-массив из трёх наиболее вероятных слов, полностью соответствующих всем требованиям выше.
Пример: ["слово1","слово2","слово3"]`;

            const cacheKey = `${context}_${lastWord}_${wordCase}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'mistral-large-2411',
                    messages: [
                        { role: 'system', content: prompt }
                    ],
                    max_tokens: 150,
                    temperature: 0.7,  // Увеличиваем разнообразие
                    top_p: 0.9,        // Добавляем параметр для большего разнообразия
                    presence_penalty: 0.3  // Штраф за повторение токенов
                })
            });

            if (!response.ok) {
                if (response.status === 429) {
                    // Пробрасываем ошибку 429 наверх, чтобы content.js мог её обработать
                    // и получить актуальный текст перед повторной попыткой
                    const error = new Error(`HTTP error! status: ${response.status}`);
                    error.status = response.status;
                    error.retryAfter = parseInt(response.headers.get('Retry-After')) || 1;
                    throw error;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            console.log('SYNTX DEBUG: Получен ответ от модели:', content);
            
            try {
                // Пытаемся найти что-то похожее на JSON-массив
                let jsonStr = content;
                
                // Если есть квадратные скобки, извлекаем их содержимое
                const match = content.match(/\[(.*?)\]/);
                if (match) {
                    jsonStr = match[0];
                }
                
                // Очищаем и форматируем строку
                jsonStr = this.cleanupJsonString(jsonStr);
                console.log('SYNTX DEBUG: Очищенный JSON:', jsonStr);
                
                const suggestions = JSON.parse(jsonStr);
                
                if (Array.isArray(suggestions)) {
                    // Фильтруем пустые значения и создаем Set для уникальных предсказаний
                    const uniqueSuggestions = new Set(
                        suggestions.filter(s => s && typeof s === 'string' && s.trim() !== '')
                    );

                    // Если у нас меньше 3 уникальных предсказаний, добавляем похожие слова
                    if (uniqueSuggestions.size < 3) {
                        // Получаем последнее слово из контекста
                        const lastWord = this.getLastWord(text);
                        const wordCase = this.getWordCase(lastWord);

                        // Добавляем дополнительные предсказания на основе последнего слова
                        const additionalWords = [
                            lastWord + 'а',    // Добавляем окончание
                            lastWord + 'ы',    // Множественное число
                            lastWord + 'ом',   // Творительный падеж
                            lastWord + 'е',    // Предложный падеж
                            lastWord + 'у'     // Винительный падеж
                        ];

                        // Добавляем дополнительные слова в Set
                        for (const word of additionalWords) {
                            if (uniqueSuggestions.size < 3) {
                                uniqueSuggestions.add(this.applyCase(word, wordCase));
                            }
                        }
                    }

                    // Преобразуем Set обратно в массив и берем первые 3 элемента
                    const filteredSuggestions = Array.from(uniqueSuggestions).slice(0, 3);
                    
                    // Применяем регистр к каждому слову
                    const finalSuggestions = filteredSuggestions.map(word => 
                        this.applyCase(word, this.getWordCase(lastWord))
                    );

                    this.cache.set(cacheKey, finalSuggestions);
                    return finalSuggestions;
                }
                
                throw new Error('Не удалось получить валидные подсказки из ответа');
            } catch (e) {
                console.error('SYNTX DEBUG: Ошибка обработки ответа:', e, 'Ответ:', content);
            }

            return [];
        } catch (error) {
            console.error('SYNTX DEBUG: Ошибка получения предсказаний:', error);
            return [];
        }
    }
}

window.MistralPredictor = MistralPredictor;
