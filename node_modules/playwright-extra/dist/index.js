"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errors = exports.devices = exports.selectors = exports.request = exports._electron = exports._android = exports.webkit = exports.firefox = exports.chromium = exports.addExtra = exports.PluginList = exports.PlaywrightExtraClass = exports.PlaywrightExtra = void 0;
const extra_1 = require("./extra");
const plugins_1 = require("./plugins");
const loader_1 = require("./helper/loader");
var extra_2 = require("./extra");
Object.defineProperty(exports, "PlaywrightExtra", { enumerable: true, get: function () { return extra_2.PlaywrightExtra; } });
Object.defineProperty(exports, "PlaywrightExtraClass", { enumerable: true, get: function () { return extra_2.PlaywrightExtraClass; } });
var plugins_2 = require("./plugins");
Object.defineProperty(exports, "PluginList", { enumerable: true, get: function () { return plugins_2.PluginList; } });
/**
 * Augment the provided Playwright browser launcher with plugin functionality.
 *
 * Using `addExtra` will always create a fresh PlaywrightExtra instance.
 *
 * @example
 * import playwright from 'playwright'
 * import { addExtra } from 'playwright-extra'
 *
 * const chromium = addExtra(playwright.chromium)
 * chromium.use(plugin)
 *
 * @param launcher - Playwright (or compatible) browser launcher
 */
const addExtra = (launcher) => new extra_1.PlaywrightExtra(launcher);
exports.addExtra = addExtra;
/**
 * This object can be used to launch or connect to Chromium with plugin functionality.
 *
 * This default export will behave exactly the same as the regular playwright
 * (just with extra plugin functionality) and can be used as a drop-in replacement.
 *
 * Behind the scenes it will try to require either the `playwright-core`
 * or `playwright` module from the installed dependencies.
 *
 * @note
 * Due to Node.js import caching this will result in a single
 * PlaywrightExtra instance, even when used in different files. If you need multiple
 * instances with different plugins please use `addExtra`.
 *
 * @example
 * // javascript import
 * const { chromium } = require('playwright-extra')
 *
 * // typescript/es6 module import
 * import { chromium } from 'playwright-extra'
 *
 * // Add plugins
 * chromium.use(...)
 */
exports.chromium = (0, exports.addExtra)((loader_1.playwrightLoader.loadModule() || {}).chromium);
/**
 * This object can be used to launch or connect to Firefox with plugin functionality
 * @note This export will always return the same instance, if you wish to use multiple instances with different plugins use `addExtra`
 */
exports.firefox = (0, exports.addExtra)((loader_1.playwrightLoader.loadModule() || {}).firefox);
/**
 * This object can be used to launch or connect to Webkit with plugin functionality
 * @note This export will always return the same instance, if you wish to use multiple instances with different plugins use `addExtra`
 */
exports.webkit = (0, exports.addExtra)((loader_1.playwrightLoader.loadModule() || {}).webkit);
// Other playwright module exports we simply re-export with lazy loading
exports._android = loader_1.playwrightLoader.lazyloadExportOrDie('_android');
exports._electron = loader_1.playwrightLoader.lazyloadExportOrDie('_electron');
exports.request = loader_1.playwrightLoader.lazyloadExportOrDie('request');
exports.selectors = loader_1.playwrightLoader.lazyloadExportOrDie('selectors');
exports.devices = loader_1.playwrightLoader.lazyloadExportOrDie('devices');
exports.errors = loader_1.playwrightLoader.lazyloadExportOrDie('errors');
/** Playwright with plugin functionality */
const moduleExports = {
    // custom exports
    PlaywrightExtra: extra_1.PlaywrightExtra,
    PlaywrightExtraClass: extra_1.PlaywrightExtraClass,
    PluginList: plugins_1.PluginList,
    addExtra: exports.addExtra,
    chromium: exports.chromium,
    firefox: exports.firefox,
    webkit: exports.webkit,
    // vanilla exports
    _android: exports._android,
    _electron: exports._electron,
    request: exports.request,
    selectors: exports.selectors,
    devices: exports.devices,
    errors: exports.errors
};
exports.default = moduleExports;
//# sourceMappingURL=index.js.map