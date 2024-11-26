document.addEventListener('DOMContentLoaded', function() {
    const enableSwitch = document.getElementById('enableSwitch');

    // Загружаем текущее состояние
    chrome.storage.sync.get(['isEnabled'], function(result) {
        enableSwitch.checked = result.isEnabled !== undefined ? result.isEnabled : true;
    });

    // Обрабатываем изменение состояния
    enableSwitch.addEventListener('change', function() {
        const isEnabled = this.checked;
        chrome.storage.sync.set({ isEnabled: isEnabled }, function() {
            console.log('T9 ' + (isEnabled ? 'включен' : 'выключен'));
        });
    });
});
