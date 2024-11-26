// Глобальные переменные
let mistralPredictor = null;
let currentSuggestions = [];
let selectedSuggestionIndex = 0;
let globalSuggestionBox = null;
let lastActiveField = null;
let isManualPrediction = false;  // Флаг для отслеживания источника подсказок
let suggestionRequestId = 0;     // ID для отслеживания источника подсказок
let ignoreNextInput = false;     // Флаг для игнорирования следующего события input
let wordCache = new Set(); // Кэш для сохранения выбранных слов
let wordFrequencyCache = null;
let retryTimer = null;  // Добавляем переменную для хранения таймера
let isEnabled = true; // Глобальная переменная для включения/выключения функционала

// Загружаем состояние при старте
chrome.storage.sync.get(['isEnabled'], function(result) {
    isEnabled = result.isEnabled !== undefined ? result.isEnabled : true;
    console.log('SYNTX DEBUG: Расширение ' + (isEnabled ? 'включено' : 'выключено'));
});

// Слушаем изменения состояния
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (changes.isEnabled) {
        isEnabled = changes.isEnabled.newValue;
        console.log('SYNTX DEBUG: Состояние изменено на: ' + (isEnabled ? 'включено' : 'выключено'));
        if (!isEnabled && globalSuggestionBox) {
            globalSuggestionBox.style.display = 'none';
            console.log('SYNTX DEBUG: Подсказки скрыты при выключении');
        }
    }
});

// Функция debounce
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Инициализация при загрузке
console.log('SYNTX DEBUG: Скрипт начал загрузку');

window.addEventListener('load', () => {
    console.log('SYNTX DEBUG: window.load событие');
    initializeExtension();
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('SYNTX DEBUG: DOMContentLoaded событие');
    initializeExtension();
});

console.log('SYNTX DEBUG: Первый вызов initializeExtension');
initializeExtension();

async function initializeExtension() {
    console.log('SYNTX DEBUG: Начало initializeExtension');
    console.log('SYNTX DEBUG: Состояние документа:', document.readyState);
    
    if (document.readyState === 'loading') {
        console.log('SYNTX DEBUG: Документ все еще загружается, выход');
        return;
    }

    try {
        // Инициализируем кэш слов
        wordFrequencyCache = new WordFrequencyCache();
        
        // Ждем загрузки MistralPredictor
        let attempts = 0;
        while (!window.MistralPredictor && attempts < 10) {
            console.log('SYNTX DEBUG: Ожидание MistralPredictor, попытка', attempts + 1);
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }

        if (!window.MistralPredictor) {
            console.error('SYNTX DEBUG: MistralPredictor не найден после', attempts, 'попыток');
            return;
        }

        console.log('SYNTX DEBUG: MistralPredictor найден после', attempts, 'попыток');

        console.log('SYNTX DEBUG: Проверка существования globalSuggestionBox');
        // Создаем глобальный контейнер для подсказок
        if (!globalSuggestionBox) {
            console.log('SYNTX DEBUG: Создание globalSuggestionBox');
            globalSuggestionBox = document.createElement('div');
            globalSuggestionBox.className = 't9-suggestions';
            globalSuggestionBox.style.cssText = `
                position: fixed;
                display: none;
                border-radius: 6px;
                z-index: 10000;
                padding: 6px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
                font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                font-size: 14px;
                white-space: nowrap;
            `;
            document.body.appendChild(globalSuggestionBox);
            // Применяем начальные стили в зависимости от темы
            updateThemeStyles();
            console.log('SYNTX DEBUG: globalSuggestionBox создан и добавлен в DOM');
        }

        console.log('SYNTX DEBUG: Создание экземпляра MistralPredictor');
        mistralPredictor = new window.MistralPredictor('6G4FL2W8n8Mjiybyj5sYBH4fw9bacgNT');
        console.log('SYNTX DEBUG: Вызов initialize для MistralPredictor');
        await mistralPredictor.initialize([]);
        console.log('SYNTX: Mistral инициализирован');

        // Инициализируем обработчики
        console.log('SYNTX DEBUG: Вызов initializeEventListeners');
        initializeEventListeners();

        // Добавляем наблюдатель за изменением атрибута scheme
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'scheme') {
                    updateThemeStyles();
                }
            });
        });
        
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['scheme']
        });
    } catch (error) {
        console.error('SYNTX DEBUG: Ошибка в initializeExtension:', error);
    }
}

function initializeEventListeners() {
    console.log('SYNTX DEBUG: Начало initializeEventListeners');
    
    // Немедленная первая проверка
    checkAndInitializeFields();
    
    // Создаем MutationObserver для отслеживания изменений в DOM
    const debouncedCheck = debounce(checkAndInitializeFields, 500);
    
    console.log('SYNTX DEBUG: Создание MutationObserver');
    const observer = new MutationObserver((mutations) => {
        // Проверяем, есть ли значимые изменения
        const hasRelevantChanges = mutations.some(mutation => {
            return Array.from(mutation.addedNodes).some(node => 
                node.nodeType === 1 && 
                (node.matches?.('.im-chat-input--text._im_text') || 
                 node.matches?.('.im_editable') ||
                 node.matches?.('[contenteditable="true"]') ||
                 node.querySelector?.('.im-chat-input--text._im_text, .im_editable, [contenteditable="true"]'))
            );
        });

        if (hasRelevantChanges) {
            console.log('SYNTX DEBUG: Обнаружены релевантные изменения в DOM');
            debouncedCheck();
        }
    });

    // Начинаем наблюдение за изменениями в DOM
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Добавляем обработчик кликов по документу
    document.addEventListener('click', (e) => {
        if (lastActiveField && 
            !lastActiveField.contains(e.target) && 
            (!globalSuggestionBox || !globalSuggestionBox.contains(e.target))) {
            console.log('SYNTX DEBUG: Клик вне поля ввода, скрываем подсказки');
            hideSuggestions();
        }
    });
    
    // Запускаем периодическую проверку новых полей
    setInterval(checkAndInitializeFields, 1000);
    console.log('SYNTX DEBUG: Установлен интервал проверки полей');
}

function checkAndInitializeFields() {
    console.log('SYNTX DEBUG: Проверка полей для инициализации');
    
    // Ищем все текстовые поля ввода
    const textInputs = document.querySelectorAll('input[type="text"], textarea, [contenteditable="true"], [role="textbox"]');
    
    textInputs.forEach(field => {
        // Проверяем, не инициализировано ли уже поле
        if (!field.hasAttribute('data-t9-initialized')) {
            initializeField(field);
        }
    });

    // Наблюдаем за изменениями в DOM
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Проверяем, является ли узел элементом
                    const inputs = node.querySelectorAll('input[type="text"], textarea, [contenteditable="true"], [role="textbox"]');
                    inputs.forEach(field => {
                        if (!field.hasAttribute('data-t9-initialized')) {
                            initializeField(field);
                        }
                    });
                }
            });
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function initializeField(field) {
    if (field.hasAttribute('data-t9-initialized')) return;
    console.log('SYNTX DEBUG: Инициализация поля:', field);

    // Добавляем обработчик ввода
    field.addEventListener('input', handleInput);

    // Добавляем обработчик клавиш с capture phase
    field.addEventListener('keydown', (event) => {
        if (globalSuggestionBox && globalSuggestionBox.style.display !== 'none') {
            if (event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                
                if (event.shiftKey) {
                    selectedSuggestionIndex = (selectedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
                } else {
                    selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
                }
                updateSuggestionHighlight();
            } else if (event.key === 'Alt') {
                event.preventDefault();
                event.stopPropagation();
                
                const suggestion = currentSuggestions[selectedSuggestionIndex];
                if (suggestion) {
                    acceptSuggestion(field, suggestion);
                }
            }
        }
    }, true); // true для capture phase

    // Добавляем обработчик клавиш для остальных команд
    field.addEventListener('keydown', handleKeyDown);

    // Добавляем обработчик фокуса
    field.addEventListener('focus', (e) => {
        console.log('SYNTX DEBUG: Фокус на поле ввода');
        lastActiveField = e.target;
    });

    // Добавляем обработчик blur
    field.addEventListener('blur', (e) => {
        setTimeout(() => {
            if (!e.target.contains(document.activeElement) && 
                (!globalSuggestionBox || !globalSuggestionBox.contains(document.activeElement))) {
                console.log('SYNTX DEBUG: Потеря фокуса, скрываем подсказки');
                hideSuggestions();
            }
        }, 100);
    });

    // Помечаем поле как инициализированное
    field.setAttribute('data-t9-initialized', 'true');
    console.log('SYNTX DEBUG: Поле инициализировано');
}

function getContextBeforeCursor(field) {
    let text = field.innerText || field.value || '';
    let cursorPos;
    
    if (field.isContentEditable) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return { context: '', cursorPos: 0 };
        
        const range = selection.getRangeAt(0);
        cursorPos = range.startOffset;
        
        // Если курсор в конце текста
        if (cursorPos >= text.length) {
            cursorPos = text.length;
        }
    } else {
        cursorPos = field.selectionStart;
    }

    // Получаем текст до курсора
    const textBeforeCursor = text.slice(0, cursorPos);
    
    return {
        context: textBeforeCursor,
        cursorPos: cursorPos
    };
}

function getWordAtCursor(field) {
    const { context, cursorPos } = getContextBeforeCursor(field);
    if (!context) return { word: '', start: 0, end: 0, contextBefore: '' };
    
    // Находим начало и конец слова
    let start = cursorPos;
    let end = cursorPos;
    
    // Идем назад до пробела или начала текста
    while (start > 0 && !/\s/.test(context[start - 1])) {
        start--;
    }
    
    // Получаем полный текст
    const text = field.innerText || field.value || '';
    
    // Идем вперед до пробела или конца текста
    while (end < text.length && !/\s/.test(text[end])) {
        end++;
    }
    
    // Получаем контекст до текущего слова
    const contextBefore = context.slice(0, start).trim();
    
    return {
        word: text.slice(start, end),
        start: start,
        end: end,
        contextBefore: contextBefore
    };
}

async function handleInput(event) {
    if (!isEnabled) return;

    console.log('SYNTX DEBUG: Начало handleInput');
    
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    if (ignoreNextInput) {
        console.log('SYNTX DEBUG: Игнорируем событие input после вставки подсказки');
        ignoreNextInput = false;
        return;
    }

    const element = event.target;
    const { word: currentWord, contextBefore } = getWordAtCursor(element);

    // Показываем подсказки после первой буквы
    if (!currentWord || currentWord.length < 1) {
        hideSuggestions();
        return;
    }

    // Получаем предсказания из кэша
    const cachedSuggestions = wordFrequencyCache.getPredictions(currentWord, 3);
    console.log('SYNTX DEBUG: Предсказания из кэша:', cachedSuggestions);

    let aiSuggestions = [];
    // Получаем предсказания от нейросети с учетом контекста
    try {
        aiSuggestions = await mistralPredictor.getPrediction(contextBefore + ' ' + currentWord);
        console.log('SYNTX DEBUG: Предсказания от ИИ:', aiSuggestions);
    } catch (error) {
        if (error.message.includes('status: 429')) {
            console.log('SYNTX DEBUG: Слишком много запросов, повторная попытка через 500мс');
            
            retryTimer = setTimeout(async () => {
                if (!retryTimer) {
                    console.log('SYNTX DEBUG: Повторный запрос был отменен');
                    return;
                }
                
                try {
                    const { word: retryWord, contextBefore: retryContext } = getWordAtCursor(element);
                    const currentCachedSuggestions = wordFrequencyCache.getPredictions(retryWord, 3);
                    console.log('SYNTX DEBUG: Текущее слово для повторной попытки:', retryWord);
                    
                    aiSuggestions = await mistralPredictor.getPrediction(retryContext + ' ' + retryWord);
                    console.log('SYNTX DEBUG: Предсказания от ИИ (повторная попытка):', aiSuggestions);
                    
                    const combinedSuggestions = combinePredictions(currentCachedSuggestions, aiSuggestions, retryWord);
                    
                    if (combinedSuggestions.length > 0) {
                        showSuggestions(element, combinedSuggestions);
                    }
                } catch (retryError) {
                    console.error('SYNTX DEBUG: Ошибка при повторной попытке:', retryError);
                } finally {
                    retryTimer = null;
                }
            }, 500);
        } else {
            console.error('SYNTX DEBUG: Ошибка получения предсказаний:', error);
        }
    }

    const combinedSuggestions = combinePredictions(cachedSuggestions, aiSuggestions, currentWord);

    if (combinedSuggestions.length > 0) {
        showSuggestions(element, combinedSuggestions);
    } else {
        hideSuggestions();
    }
}

function combinePredictions(cachedSuggestions, aiSuggestions, currentWord) {
    const combinedSuggestions = [];
    const allSuggestions = new Set();
    
    // Добавляем все предсказания в Set для удаления дубликатов
    cachedSuggestions.forEach(suggestion => {
        if (suggestion.startsWith(currentWord)) {
            allSuggestions.add(suggestion);
        }
    });
    
    aiSuggestions.forEach(suggestion => {
        if (suggestion.startsWith(currentWord)) {
            allSuggestions.add(suggestion);
        }
    });

    // Преобразуем Set обратно в массив
    const uniqueSuggestions = Array.from(allSuggestions);

    // Сначала добавляем предсказания из кэша
    for (const suggestion of cachedSuggestions) {
        if (combinedSuggestions.length < 3 && suggestion.startsWith(currentWord)) {
            combinedSuggestions.push(suggestion);
            const index = uniqueSuggestions.indexOf(suggestion);
            if (index > -1) {
                uniqueSuggestions.splice(index, 1);
            }
        }
    }

    // Добавляем оставшиеся уникальные предсказания до достижения трех
    for (const suggestion of uniqueSuggestions) {
        if (combinedSuggestions.length < 3) {
            combinedSuggestions.push(suggestion);
        }
    }

    return combinedSuggestions;
}

function handleKeyDown(event) {
    if (!isEnabled) return;

    console.log('SYNTX DEBUG: Нажатие клавиши:', event.key);
    
    if (!globalSuggestionBox || globalSuggestionBox.style.display === 'none') return;

    switch (event.key) {
        case 'Enter':
            if (currentSuggestions.length > 0) {
                event.preventDefault();
                acceptSuggestion(event.target, currentSuggestions[selectedSuggestionIndex]);
                hideSuggestions();
            }
            break;
        case 'Escape':
            hideSuggestions();
            break;
    }
}

function acceptSuggestion(field, suggestion) {
    if (!field || !suggestion) return;

    // Получаем информацию о текущем слове и его позиции
    const { word: currentWord, start, end } = getWordAtCursor(field);
    if (!currentWord) return;

    // Добавляем принятое слово в кэши
    mistralPredictor.wordFrequency.addWord(suggestion);
    wordCache.add(suggestion);

    // Получаем весь текст
    const text = field.innerText || field.value || '';
    
    // Формируем новый текст, заменяя текущее слово на подсказку
    const beforeWord = text.slice(0, start);
    const afterWord = text.slice(end);
    const newText = beforeWord + suggestion + afterWord;

    // Устанавливаем флаг игнорирования следующего события input
    ignoreNextInput = true;

    if (field.isContentEditable) {
        field.textContent = newText;
        
        // Устанавливаем курсор после вставленного слова
        const range = document.createRange();
        const selection = window.getSelection();
        
        if (field.firstChild) {
            const newPos = start + suggestion.length;
            range.setStart(field.firstChild, newPos);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            
            // Добавляем пробел, если его нет после слова
            if (!afterWord.startsWith(' ')) {
                document.execCommand('insertText', false, ' ');
            }
        } else {
            const textNode = document.createTextNode(newText + (!afterWord.startsWith(' ') ? ' ' : ''));
            field.appendChild(textNode);
            range.setStart(textNode, start + suggestion.length + 1);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    } else {
        // Для обычных input полей
        const needSpace = !afterWord.startsWith(' ');
        const finalText = newText + (needSpace ? ' ' : '');
        field.value = finalText;
        const newCursorPos = start + suggestion.length + (needSpace ? 1 : 0);
        field.selectionStart = field.selectionEnd = newCursorPos;
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    field.focus();
    hideSuggestions();
}

function showSuggestions(field, suggestions) {
    if (!isEnabled) return;

    console.log('SYNTX DEBUG: Начало showSuggestions');
    if (!field || !suggestions || !suggestions.length) return;

    const rect = field.getBoundingClientRect();
    console.log('SYNTX DEBUG: Координаты поля:', rect);

    const text = field.innerText || field.value || '';
    const { word: currentWord, start } = getWordAtCursor(field);
    
    // Создаем временный элемент для измерения
    const temp = document.createElement('span');
    temp.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: pre;
        font-family: ${window.getComputedStyle(field).fontFamily};
        font-size: ${window.getComputedStyle(field).fontSize};
    `;
    temp.textContent = text.substring(0, start);
    document.body.appendChild(temp);
    
    const offset = temp.getBoundingClientRect().width;
    temp.remove();
    
    console.log('SYNTX DEBUG: Смещение для подсказок:', offset);

    // Проверяем поле ввода на странице feed
    const isFeedPostField = window.location.href === 'https://vk.com/feed' && 
                          field.id === 'post_field' && 
                          field.classList.contains('submit_post_field');

    // Проверяем поле сообщений на странице друзей
    const isFriendsMessageField = window.location.href === 'https://vk.com/friends?section=all' && 
                                field.id === 'mail_box_editable';

    // Проверяем поле ввода на стене пользователя (любая страница кроме feed)
    const isUserWallPostField = window.location.href !== 'https://vk.com/feed' && 
                               field.id === 'post_field' && 
                               field.classList.contains('submit_post_field');

    // Определяем позицию подсказок
    const topPosition = (isFeedPostField || isFriendsMessageField || isUserWallPostField) ? 
                       `${rect.top + rect.height + 10}px` : 
                       `${rect.top - rect.height - 10}px`;

    globalSuggestionBox.style.cssText = `
        position: fixed;
        display: block;
        border-radius: 6px;
        z-index: 10000;
        padding: 6px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        white-space: nowrap;
        top: ${topPosition};
        left: ${rect.left}px;
    `;

    // Обновляем стили в зависимости от темы
    updateThemeStyles();

    // Очищаем и заполняем подсказки
    globalSuggestionBox.innerHTML = '';
    currentSuggestions = suggestions;
    selectedSuggestionIndex = 0;

    const container = document.createElement('div');
    container.style.cssText = `
        display: flex;
        gap: 8px;
        flex-wrap: nowrap;
        align-items: center;
    `;

    const theme = getCurrentTheme();
    const textColor = theme === 'light' ? '#222222' : '#efeff1';

    suggestions.forEach((suggestion, index) => {
        const div = document.createElement('div');
        div.className = 't9-suggestion';
        div.textContent = suggestion;
        
        if (index === selectedSuggestionIndex) {
            div.style.cssText = `
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 4px;
                background: #447bba;
                color: #ffffff;
            `;
        } else {
            div.style.cssText = `
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 4px;
                color: ${textColor};
            `;
        }

        div.addEventListener('mouseover', () => {
            selectedSuggestionIndex = index;
            updateSuggestionHighlight();
        });

        div.addEventListener('click', () => {
            acceptSuggestion(field, suggestion);
            hideSuggestions();
        });

        container.appendChild(div);
    });

    globalSuggestionBox.appendChild(container);

    // Добавляем стили для ховера
    const style = document.createElement('style');
    style.textContent = `
        .t9-suggestion:hover {
            background: #447bba !important;
            color: #ffffff !important;
        }
    `;
    globalSuggestionBox.appendChild(style);
    
    console.log('SYNTX DEBUG: Подсказки отображены');
}

function updateSuggestionHighlight() {
    const theme = getCurrentTheme();
    const textColor = theme === 'light' ? '#222222' : '#efeff1';
    const suggestions = document.querySelectorAll('.t9-suggestion');
    suggestions.forEach((suggestion, index) => {
        if (index === selectedSuggestionIndex) {
            suggestion.style.background = '#447bba';
            suggestion.style.color = '#ffffff';
        } else {
            suggestion.style.background = '';
            suggestion.style.color = textColor;
        }
    });
}

function hideSuggestions() {
    console.log('SYNTX DEBUG: Скрытие подсказок');
    if (globalSuggestionBox) {
        globalSuggestionBox.style.display = 'none';
        selectedSuggestionIndex = 0; // Сбрасываем индекс
        currentSuggestions = []; // Очищаем текущие подсказки
    }
}

// Функция для определения текущей темы
function getCurrentTheme() {
    const body = document.body;
    return body.getAttribute('scheme') === 'vkcom_light' ? 'light' : 'dark';
}

// Функция для обновления стилей в зависимости от темы
function updateThemeStyles() {
    const theme = getCurrentTheme();
    if (globalSuggestionBox) {
        if (theme === 'light') {
            globalSuggestionBox.style.background = '#ffffff';
            globalSuggestionBox.style.border = '1px solid #e7e8ec';
            globalSuggestionBox.style.color = '#222222';
        } else {
            globalSuggestionBox.style.background = '#18181B';
            globalSuggestionBox.style.border = '1px solid #303032';
            globalSuggestionBox.style.color = '#efeff1';
        }
    }
}
