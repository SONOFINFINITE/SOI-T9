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

            const prompt = `Ты - система автодополнения слов для русского языка. Твоя задача - предлагать продолжения слов с точным соблюдением грамматики русского языка.

КОНТЕКСТ ПРЕДЛОЖЕНИЯ: "${context}"
ТЕКУЩИЙ ВВОД: "${lastWord}"

АЛГОРИТМ АНАЛИЗА:
1. Определение грамматической структуры:
   а) Найди главное слово (сказуемое) в контексте
   б) Определи его грамматические характеристики (время, вид, наклонение)
   в) Найди связанные слова и их роли (подлежащее, дополнение, определение)

2. Анализ управления:
   а) Если есть глагол:
      - "читать (что?) книгу" -> винительный падеж
      - "гордиться (чем?) успехами" -> творительный падеж
      - "мечтать (о чем?) о путешествии" -> предложный падеж
   
   б) Если есть предлог:
      - "в" + вин. падеж ("в школу") или предл. падеж ("в школе")
      - "с" + род. падеж ("с крыши") или твор. падеж ("с другом")
      - "к" + дат. падеж ("к другу")
      - "от" + род. падеж ("от друга")

3. Согласование по числу:
   а) Если подлежащее в единственном числе:
      - "он пишет письмо"
      - "книга лежит на столе"
   
   б) Если подлежащее во множественном числе:
      - "они пишут письма"
      - "книги лежат на столе"

4. Согласование времени:
   а) Если действие в прошедшем времени:
      - "читал книгу" -> "начал", "закончил", "увидел"
   
   б) Если действие в настоящем времени:
      - "читаю книгу" -> "понимаю", "вижу", "замечаю"

ПРИМЕРЫ ТОЧНОГО СОГЛАСОВАНИЯ:
1. "я пишу в т" -> ["тетради", "текстовом", "телефоне"] (предл. падеж)
2. "они говорили о п" -> ["проекте", "планах", "поездке"] (предл. падеж, мн. число)
3. "мы встретились с д" -> ["другом", "директором", "деканом"] (твор. падеж)
4. "она смотрела на к" -> ["картину", "книгу", "карту"] (вин. падеж, ж. род)
5. "дети играли в п" -> ["прятки", "песочнице", "парке"] (вин. или предл. падеж)
6. "пилили д" -> ["доску", "дерево", "древесину"] (вин. падеж, прош. время)

ФОРМАТ ОТВЕТА:
Верни только JSON-массив из трёх слов, точно соответствующих грамматике контекста.
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
