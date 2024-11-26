class WordFrequencyCache {
    constructor() {
        this.frequencies = {};
        this.prefixCache = {};
        this.maxEntries = 3000; // Максимальное количество слов в кэше
        this.minFrequency = 15;  // Минимальная частота для кэширования
        this.loadFromStorage();
    }

    // Загрузка кэша из storage
    async loadFromStorage() {
        try {
            const data = await chrome.storage.local.get(['wordFrequencies']);
            if (data.wordFrequencies) {
                this.frequencies = JSON.parse(data.wordFrequencies);
                this.updatePrefixCache();
            }
            console.log('SYNTX DEBUG: Загружен кэш частот слов:', Object.keys(this.frequencies).length, 'слов');
        } catch (error) {
            console.error('SYNTX DEBUG: Ошибка загрузки кэша:', error);
        }
    }

    // Сохранение кэша в storage
    async saveToStorage() {
        try {
            await chrome.storage.local.set({
                wordFrequencies: JSON.stringify(this.frequencies)
            });
            console.log('SYNTX DEBUG: Кэш частот слов сохранен');
        } catch (error) {
            console.error('SYNTX DEBUG: Ошибка сохранения кэша:', error);
        }
    }

    // Обновление префиксного кэша
    updatePrefixCache() {
        this.prefixCache = {};
        for (const [word, freq] of Object.entries(this.frequencies)) {
            if (freq >= this.minFrequency) {
                for (let i = 1; i <= word.length; i++) {
                    const prefix = word.slice(0, i);
                    if (!this.prefixCache[prefix]) {
                        this.prefixCache[prefix] = [];
                    }
                    this.prefixCache[prefix].push([word, freq]);
                }
            }
        }

        // Сортируем списки слов по частоте
        for (const prefix in this.prefixCache) {
            this.prefixCache[prefix].sort((a, b) => b[1] - a[1]);
        }
    }

    // Добавление слова в кэш
    addWord(word) {
        if (!word || word.length < 2) return;
        
        word = word.toLowerCase();
        this.frequencies[word] = (this.frequencies[word] || 0) + 1;

        // Если кэш переполнен, удаляем редко используемые слова
        if (Object.keys(this.frequencies).length > this.maxEntries) {
            this.cleanup();
        }

        // Обновляем префиксный кэш только если частота достигла порога
        if (this.frequencies[word] === this.minFrequency) {
            this.updatePrefixCache();
            this.saveToStorage();
        }
    }

    // Очистка редко используемых слов
    cleanup() {
        const entries = Object.entries(this.frequencies);
        entries.sort((a, b) => b[1] - a[1]);
        
        // Оставляем только top maxEntries/2 слов
        this.frequencies = {};
        entries.slice(0, this.maxEntries/2).forEach(([word, freq]) => {
            this.frequencies[word] = freq;
        });
        
        this.updatePrefixCache();
        this.saveToStorage();
    }

    // Получение предсказаний из кэша
    getPredictions(prefix, maxResults = 3) {
        if (!prefix) return [];
        
        prefix = prefix.toLowerCase();
        const cached = this.prefixCache[prefix] || [];
        return cached.slice(0, maxResults).map(([word]) => word);
    }
}

window.WordFrequencyCache = WordFrequencyCache;
