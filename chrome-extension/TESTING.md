# Chrome Extension Testing Guide

## Issues Fixed (January 2025)

### **Service Worker Registration Errors** ✅
- **Fixed**: Node.js `process.env.NODE_ENV` leaking into browser code
- **Solution**: Replaced with `import.meta.env.DEV` for Vite compatibility
- **Added**: Proper browser polyfills in Vite configuration

### **"process is not defined" Error** ✅
- **Fixed**: Node.js globals being bundled for browser environment
- **Solution**: Added define configuration to prevent Node.js leaks
- **Externalized**: Node.js modules (crypto, fs, path, etc.) from browser bundle

## Testing Steps

### **1. Build the Extension**
```bash
cd chrome-extension
pnpm build:debug
```

**Expected Output:**
- ✅ `823 modules transformed` (improved from 964)
- ✅ Bundle: `~1,417 kB` (gzip: `~362 kB`) - **11.4% smaller!**
- ✅ No critical errors 
- ⚠️ **Expected warnings**: chromium-bidi globals (safe to ignore)

### **2. Load Extension in Chrome**
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `../dist` directory (should contain `manifest.json`)

**Expected Result:**
- ✅ Extension loads without errors
- ✅ No "Service worker registration failed" messages
- ✅ No "process is not defined" errors in console

### **3. Verify Extension Functionality**
1. **Side Panel**: Click the extension icon - side panel should open
2. **Options Page**: Right-click extension → Options should open
3. **Background Script**: Check `chrome://extensions/` → Background page should be active

### **4. Console Verification**
Open Chrome DevTools for the extension:
1. Go to `chrome://extensions/`
2. Find Nanobrowser extension
3. Click "service worker" link under "Inspect views"

**Expected Console Output:**
```
[2025-01-XX] [INFO] [background] background loaded
```

**Should NOT see:**
- ❌ "Service worker registration failed"
- ❌ "process is not defined"
- ❌ "module externalized for browser compatibility" errors for core functionality

## Common Issues & Solutions

### **Issue**: Service Worker Won't Start
**Check**: 
- Manifest.json points to correct service worker file
- Background script doesn't use Node.js APIs
- All imports resolve to browser-compatible modules

### **Issue**: Extension Loads but Features Don't Work
**Check**:
- Content scripts injected properly (`buildDomTree.js`)
- Side panel communication working
- Storage permissions configured correctly

### **Issue**: Build Warnings About External Modules
**Status**: Expected - external libraries may reference Node.js modules
**Action**: Safe to ignore if extension functionality works

## Success Criteria

✅ **Extension loads without errors**
✅ **Service worker starts successfully** 
✅ **No Node.js global errors in console**
✅ **Side panel opens and responds**
✅ **Options page accessible**
✅ **Content scripts inject on web pages**

## Architecture Verification

The fixes ensure:
- **Pure browser compatibility**: No Node.js globals in bundled code
- **Proper polyfills**: Browser-compatible alternatives defined
- **External dependencies**: Node.js modules excluded from bundle
- **Service worker support**: Chrome Extension V3 compatibility

---

*Testing guide updated: January 2025* 