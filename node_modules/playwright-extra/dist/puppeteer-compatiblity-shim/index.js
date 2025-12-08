"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBrowserShim = exports.createPageShim = exports.getBrowserCDPSession = exports.getPageCDPSession = exports.addPuppeteerCompat = exports.isPuppeteerCompat = exports.isPlaywrightBrowser = exports.isPlaywrightFrame = exports.isPlaywrightPage = void 0;
const debug_1 = __importDefault(require("debug"));
const debug = (0, debug_1.default)('playwright-extra:puppeteer-compat');
const isPlaywrightPage = (obj) => {
    return 'unroute' in obj;
};
exports.isPlaywrightPage = isPlaywrightPage;
const isPlaywrightFrame = (obj) => {
    return ['parentFrame', 'frameLocator'].every(x => x in obj);
};
exports.isPlaywrightFrame = isPlaywrightFrame;
const isPlaywrightBrowser = (obj) => {
    return 'newContext' in obj;
};
exports.isPlaywrightBrowser = isPlaywrightBrowser;
const isPuppeteerCompat = (obj) => {
    return !!obj && typeof obj === 'object' && !!obj.isCompatShim;
};
exports.isPuppeteerCompat = isPuppeteerCompat;
const cache = {
    objectToShim: new Map(),
    cdpSession: {
        page: new Map(),
        browser: new Map()
    }
};
/** Augment a Playwright object with compatibility with certain Puppeteer methods */
function addPuppeteerCompat(object) {
    if (!object || typeof object !== 'object') {
        return object;
    }
    if (cache.objectToShim.has(object)) {
        return cache.objectToShim.get(object);
    }
    if ((0, exports.isPuppeteerCompat)(object)) {
        return object;
    }
    debug('addPuppeteerCompat', cache.objectToShim.size);
    if ((0, exports.isPlaywrightPage)(object) || (0, exports.isPlaywrightFrame)(object)) {
        const shim = createPageShim(object);
        cache.objectToShim.set(object, shim);
        return shim;
    }
    if ((0, exports.isPlaywrightBrowser)(object)) {
        const shim = createBrowserShim(object);
        cache.objectToShim.set(object, shim);
        return shim;
    }
    debug('Received unknown object:', Reflect.ownKeys(object));
    return object;
}
exports.addPuppeteerCompat = addPuppeteerCompat;
// Only chromium browsers support CDP
const dummyCDPClient = {
    send: async (...args) => {
        debug('dummy CDP client called', 'send', args);
    },
    on: (...args) => {
        debug('dummy CDP client called', 'on', args);
    }
};
async function getPageCDPSession(page) {
    let session = cache.cdpSession.page.get(page);
    if (session) {
        debug('getPageCDPSession: use existing');
        return session;
    }
    debug('getPageCDPSession: use new');
    const context = (0, exports.isPlaywrightFrame)(page)
        ? page.page().context()
        : page.context();
    try {
        session = await context.newCDPSession(page);
        cache.cdpSession.page.set(page, session);
        return session;
    }
    catch (err) {
        debug('getPageCDPSession: error while creating session:', err.message);
        debug('getPageCDPSession: Unable create CDP session (most likely a different browser than chromium) - returning a dummy');
    }
    return dummyCDPClient;
}
exports.getPageCDPSession = getPageCDPSession;
async function getBrowserCDPSession(browser) {
    let session = cache.cdpSession.browser.get(browser);
    if (session) {
        debug('getBrowserCDPSession: use existing');
        return session;
    }
    debug('getBrowserCDPSession: use new');
    try {
        session = await browser.newBrowserCDPSession();
        cache.cdpSession.browser.set(browser, session);
        return session;
    }
    catch (err) {
        debug('getBrowserCDPSession: error while creating session:', err.message);
        debug('getBrowserCDPSession: Unable create CDP session (most likely a different browser than chromium) - returning a dummy');
    }
    return dummyCDPClient;
}
exports.getBrowserCDPSession = getBrowserCDPSession;
function createPageShim(page) {
    const objId = Math.random().toString(36).substring(2, 7);
    const shim = new Proxy(page, {
        get(target, prop) {
            if (prop === 'isCompatShim' || prop === 'isPlaywright') {
                return true;
            }
            debug('page - get', objId, prop);
            if (prop === '_client') {
                return () => ({
                    send: async (method, params) => {
                        const session = await getPageCDPSession(page);
                        return await session.send(method, params);
                    },
                    on: (event, listener) => {
                        getPageCDPSession(page).then(session => {
                            session.on(event, listener);
                        });
                    }
                });
            }
            if (prop === 'setBypassCSP') {
                return async (enabled) => {
                    const session = await getPageCDPSession(page);
                    return await session.send('Page.setBypassCSP', {
                        enabled
                    });
                };
            }
            if (prop === 'setUserAgent') {
                return async (userAgent, userAgentMetadata) => {
                    const session = await getPageCDPSession(page);
                    return await session.send('Emulation.setUserAgentOverride', {
                        userAgent,
                        userAgentMetadata
                    });
                };
            }
            if (prop === 'browser') {
                if ((0, exports.isPlaywrightPage)(page)) {
                    return () => {
                        let browser = page.context().browser();
                        if (!browser) {
                            debug('page.browser() - not available, most likely due to launchPersistentContext');
                            // Use a page shim as quick drop-in (so browser.userAgent() still works)
                            browser = page;
                        }
                        return addPuppeteerCompat(browser);
                    };
                }
            }
            if (prop === 'evaluateOnNewDocument') {
                if ((0, exports.isPlaywrightPage)(page)) {
                    return async function (pageFunction, ...args) {
                        return await page.addInitScript(pageFunction, args[0]);
                    };
                }
            }
            // Only relevant when page is being used a pseudo stand-in for the browser object (launchPersistentContext)
            if (prop === 'userAgent') {
                return async (enabled) => {
                    const session = await getPageCDPSession(page);
                    const data = await session.send('Browser.getVersion');
                    return data.userAgent;
                };
            }
            return Reflect.get(target, prop);
        }
    });
    return shim;
}
exports.createPageShim = createPageShim;
function createBrowserShim(browser) {
    const objId = Math.random().toString(36).substring(2, 7);
    const shim = new Proxy(browser, {
        get(target, prop) {
            if (prop === 'isCompatShim' || prop === 'isPlaywright') {
                return true;
            }
            debug('browser - get', objId, prop);
            if (prop === 'pages') {
                return () => browser
                    .contexts()
                    .flatMap(c => c.pages().map(page => addPuppeteerCompat(page)));
            }
            if (prop === 'userAgent') {
                return async () => {
                    const session = await getBrowserCDPSession(browser);
                    const data = await session.send('Browser.getVersion');
                    return data.userAgent;
                };
            }
            return Reflect.get(target, prop);
        }
    });
    return shim;
}
exports.createBrowserShim = createBrowserShim;
//# sourceMappingURL=index.js.map