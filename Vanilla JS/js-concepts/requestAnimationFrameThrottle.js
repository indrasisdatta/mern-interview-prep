const requestAnimationFrameThrottle = (fn) => {
    let isQueued;
    return (...args) => {
        if (isQueued) return;
        isQueued = true;
        requestAnimationFrame(() => {
            fn(...args);
            isQueued = false;
        });
    }
}