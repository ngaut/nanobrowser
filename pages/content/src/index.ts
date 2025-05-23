console.log('content script loaded');

// Add debugging to see if buildDomTree is available
console.log('buildDomTree available:', typeof window.buildDomTree === 'function');

// Add a global flag to indicate content script loaded
(window as any).contentScriptLoaded = true;
