"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightExtra = exports.PlaywrightExtraClass = void 0;
const debug_1 = __importDefault(require("debug"));
const debug = (0, debug_1.default)('playwright-extra');
const plugins_1 = require("./plugins");
const loader_1 = require("./helper/loader");
/**
 * Modular plugin framework to teach `playwright` new tricks.
 */
class PlaywrightExtraClass {
    constructor(_launcher) {
        this._launcher = _launcher;
        this.plugins = new plugins_1.PluginList();
    }
    /**
     * The **main interface** to register plugins.
     *
     * Can be called multiple times to enable multiple plugins.
     *
     * Plugins derived from `PuppeteerExtraPlugin` will be used with a compatiblity layer.
     *
     * @example
     * chromium.use(plugin1).use(plugin2)
     * firefox.use(plugin1).use(plugin2)
     *
     * @see [PuppeteerExtraPlugin]
     *
     * @return The same `PlaywrightExtra` instance (for optional chaining)
     */
    use(plugin) {
        const isValid = plugin && 'name' in plugin;
        if (!isValid) {
            throw new Error('A plugin must be provided to .use()');
        }
        if (this.plugins.add(plugin)) {
            debug('Plugin registered', plugin.name);
        }
        return this;
    }
    /**
     * In order to support a default export which will require vanilla playwright automatically,
     * as well as `addExtra` to patch a provided launcher, we need to so some gymnastics here.
     *
     * Otherwise this would throw immediately, even when only using the `addExtra` export with an arbitrary compatible launcher.
     *
     * The solution is to make the vanilla launcher optional and only throw once we try to effectively use and can't find it.
     *
     * @internal
     */
    get launcher() {
        if (!this._launcher) {
            throw loader_1.playwrightLoader.requireError;
        }
        return this._launcher;
    }
    async launch(...args) {
        if (!this.launcher.launch) {
            throw new Error('Launcher does not support "launch"');
        }
        let [options] = args;
        options = Object.assign({ args: [] }, (options || {})); // Initialize args array
        debug('launch', options);
        this.plugins.prepare();
        // Give plugins the chance to modify the options before continuing
        options =
            (await this.plugins.dispatchBlocking('beforeLaunch', options)) || options;
        debug('launch with options', options);
        if ('userDataDir' in options) {
            debug("A plugin defined userDataDir during .launch, which isn't supported by playwright - ignoring");
            delete options.userDataDir;
        }
        const browser = await this.launcher['launch'](options);
        await this.plugins.dispatchBlocking('onBrowser', browser);
        await this._bindBrowserEvents(browser);
        await this.plugins.dispatchBlocking('afterLaunch', browser);
        return browser;
    }
    async launchPersistentContext(...args) {
        if (!this.launcher.launchPersistentContext) {
            throw new Error('Launcher does not support "launchPersistentContext"');
        }
        let [userDataDir, options] = args;
        options = Object.assign({ args: [] }, (options || {})); // Initialize args array
        debug('launchPersistentContext', options);
        this.plugins.prepare();
        // Give plugins the chance to modify the options before continuing
        options =
            (await this.plugins.dispatchBlocking('beforeLaunch', options)) || options;
        const context = await this.launcher['launchPersistentContext'](userDataDir, options);
        await this.plugins.dispatchBlocking('afterLaunch', context);
        this._bindBrowserContextEvents(context);
        return context;
    }
    async connect(wsEndpointOrOptions, wsOptions = {}) {
        if (!this.launcher.connect) {
            throw new Error('Launcher does not support "connect"');
        }
        this.plugins.prepare();
        // Playwright currently supports two function signatures for .connect
        let options = {};
        let wsEndpointAsString = false;
        if (typeof wsEndpointOrOptions === 'object') {
            options = Object.assign(Object.assign({}, wsEndpointOrOptions), wsOptions);
        }
        else {
            wsEndpointAsString = true;
            options = Object.assign({ wsEndpoint: wsEndpointOrOptions }, wsOptions);
        }
        debug('connect', options);
        // Give plugins the chance to modify the options before launch/connect
        options =
            (await this.plugins.dispatchBlocking('beforeConnect', options)) || options;
        // Follow call signature of end user
        const args = [];
        const wsEndpoint = options.wsEndpoint;
        if (wsEndpointAsString) {
            delete options.wsEndpoint;
            args.push(wsEndpoint, options);
        }
        else {
            args.push(options);
        }
        const browser = (await this.launcher['connect'](...args));
        await this.plugins.dispatchBlocking('onBrowser', browser);
        await this._bindBrowserEvents(browser);
        await this.plugins.dispatchBlocking('afterConnect', browser);
        return browser;
    }
    async connectOverCDP(wsEndpointOrOptions, wsOptions = {}) {
        if (!this.launcher.connectOverCDP) {
            throw new Error(`Launcher does not implement 'connectOverCDP'`);
        }
        this.plugins.prepare();
        // Playwright currently supports two function signatures for .connectOverCDP
        let options = {};
        let wsEndpointAsString = false;
        if (typeof wsEndpointOrOptions === 'object') {
            options = Object.assign(Object.assign({}, wsEndpointOrOptions), wsOptions);
        }
        else {
            wsEndpointAsString = true;
            options = Object.assign({ endpointURL: wsEndpointOrOptions }, wsOptions);
        }
        debug('connectOverCDP'), options;
        // Give plugins the chance to modify the options before launch/connect
        options =
            (await this.plugins.dispatchBlocking('beforeConnect', options)) || options;
        // Follow call signature of end user
        const args = [];
        const endpointURL = options.endpointURL;
        if (wsEndpointAsString) {
            delete options.endpointURL;
            args.push(endpointURL, options);
        }
        else {
            args.push(options);
        }
        const browser = (await this.launcher['connectOverCDP'](...args));
        await this.plugins.dispatchBlocking('onBrowser', browser);
        await this._bindBrowserEvents(browser);
        await this.plugins.dispatchBlocking('afterConnect', browser);
        return browser;
    }
    async _bindBrowserContextEvents(context, contextOptions) {
        debug('_bindBrowserContextEvents');
        this.plugins.dispatch('onContextCreated', context, contextOptions);
        // Make sure things like `addInitScript` show an effect on the very first page as well
        context.newPage = ((originalMethod, ctx) => {
            return async () => {
                const page = await originalMethod.call(ctx);
                await page.goto('about:blank');
                return page;
            };
        })(context.newPage, context);
        context.on('close', () => {
            // When using `launchPersistentContext` context closing is the same as browser closing
            if (!context.browser()) {
                this.plugins.dispatch('onDisconnected');
            }
        });
        context.on('page', page => {
            this.plugins.dispatch('onPageCreated', page);
            page.on('close', () => {
                this.plugins.dispatch('onPageClose', page);
            });
        });
    }
    async _bindBrowserEvents(browser) {
        debug('_bindPlaywrightBrowserEvents');
        browser.on('disconnected', () => {
            this.plugins.dispatch('onDisconnected', browser);
        });
        // Note: `browser.newPage` will implicitly call `browser.newContext` as well
        browser.newContext = ((originalMethod, ctx) => {
            return async (options = {}) => {
                const contextOptions = (await this.plugins.dispatchBlocking('beforeContext', options, browser)) || options;
                const context = await originalMethod.call(ctx, contextOptions);
                this._bindBrowserContextEvents(context, contextOptions);
                return context;
            };
        })(browser.newContext, browser);
    }
}
exports.PlaywrightExtraClass = PlaywrightExtraClass;
/**
 * PlaywrightExtra class with additional launcher methods.
 *
 * Augments the class with an instance proxy to pass on methods that are not augmented to the original target.
 *
 */
exports.PlaywrightExtra = new Proxy(PlaywrightExtraClass, {
    construct(classTarget, args) {
        debug(`create instance of ${classTarget.name}`);
        const result = Reflect.construct(classTarget, args);
        return new Proxy(result, {
            get(target, prop) {
                if (prop in target) {
                    return Reflect.get(target, prop);
                }
                debug('proxying property to original launcher: ', prop);
                return Reflect.get(target.launcher, prop);
            }
        });
    }
});
//# sourceMappingURL=extra.js.map