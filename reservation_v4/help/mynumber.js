(() => {
    const returnToSettings = () => {
        if (window.history.length > 1 && document.referrer) {
            window.history.back();
            return;
        }
        window.location.href = '../index.html';
    };

    document.getElementById('helpBackBottom')?.addEventListener('click', returnToSettings);
})();
