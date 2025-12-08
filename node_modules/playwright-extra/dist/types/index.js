"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginLifecycleMethods = void 0;
/** Strongly typed plugin lifecycle events for internal use */
class PluginLifecycleMethods {
    async onPluginRegistered(env) { }
    async beforeLaunch(options) { }
    async afterLaunch(browserOrContext) { }
    async beforeConnect(options) { }
    async afterConnect(browser) { }
    async onBrowser(browser) { }
    async onPageCreated(page) { }
    async onPageClose(page) { }
    async onDisconnected(browser) { }
    // Playwright only at the moment
    async beforeContext(options, browser) { }
    async onContextCreated(context, options) { }
}
exports.PluginLifecycleMethods = PluginLifecycleMethods;
//# sourceMappingURL=index.js.map