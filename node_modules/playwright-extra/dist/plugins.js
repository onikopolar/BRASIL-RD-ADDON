"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginList = void 0;
const debug_1 = __importDefault(require("debug"));
const debug = (0, debug_1.default)('playwright-extra:plugins');
const loader_1 = require("./helper/loader");
const puppeteer_compatiblity_shim_1 = require("./puppeteer-compatiblity-shim");
class PluginList {
    constructor() {
        this._plugins = [];
        this._dependencyDefaults = new Map();
        this._dependencyResolution = new Map();
    }
    /**
     * Get a list of all registered plugins.
     */
    get list() {
        return this._plugins;
    }
    /**
     * Get the names of all registered plugins.
     */
    get names() {
        return this._plugins.map(p => p.name);
    }
    /**
     * Add a new plugin to the list (after checking if it's well-formed).
     *
     * @param plugin
     * @internal
     */
    add(plugin) {
        var _a;
        if (!this.isValidPluginInstance(plugin)) {
            return false;
        }
        if (!!plugin.onPluginRegistered) {
            plugin.onPluginRegistered({ framework: 'playwright' });
        }
        // PuppeteerExtraPlugin: Populate `_childClassMembers` list containing methods defined by the plugin
        if (!!plugin._registerChildClassMembers) {
            plugin._registerChildClassMembers(Object.getPrototypeOf(plugin));
        }
        if ((_a = plugin.requirements) === null || _a === void 0 ? void 0 : _a.has('dataFromPlugins')) {
            plugin.getDataFromPlugins = this.getData.bind(this);
        }
        this._plugins.push(plugin);
        return true;
    }
    /** Check if the shape of a plugin is correct or warn */
    isValidPluginInstance(plugin) {
        if (!plugin ||
            typeof plugin !== 'object' ||
            !plugin._isPuppeteerExtraPlugin) {
            console.error(`Warning: Plugin is not derived from PuppeteerExtraPlugin, ignoring.`, plugin);
            return false;
        }
        if (!plugin.name) {
            console.error(`Warning: Plugin with no name registering, ignoring.`, plugin);
            return false;
        }
        return true;
    }
    /** Error callback in case calling a plugin method throws an error. Can be overwritten. */
    onPluginError(plugin, method, err) {
        console.warn(`An error occured while executing "${method}" in plugin "${plugin.name}":`, err);
    }
    /**
     * Define default values for plugins implicitly required through the `dependencies` plugin stanza.
     *
     * @param dependencyPath - The string by which the dependency is listed (not the plugin name)
     *
     * @example
     * chromium.use(stealth)
     * chromium.plugins.setDependencyDefaults('stealth/evasions/webgl.vendor', { vendor: 'Bob', renderer: 'Alice' })
     */
    setDependencyDefaults(dependencyPath, opts) {
        this._dependencyDefaults.set(dependencyPath, opts);
        return this;
    }
    /**
     * Define custom plugin modules for plugins implicitly required through the `dependencies` plugin stanza.
     *
     * Using this will prevent dynamic imports from being used, which JS bundlers often have issues with.
     *
     * @example
     * chromium.use(stealth)
     * chromium.plugins.setDependencyResolution('stealth/evasions/webgl.vendor', VendorPlugin)
     */
    setDependencyResolution(dependencyPath, pluginModule) {
        this._dependencyResolution.set(dependencyPath, pluginModule);
        return this;
    }
    /**
     * Prepare plugins to be used (resolve dependencies, ordering)
     * @internal
     */
    prepare() {
        this.resolveDependencies();
        this.order();
    }
    /** Return all plugins using the supplied method */
    filterByMethod(methodName) {
        return this._plugins.filter(plugin => {
            // PuppeteerExtraPlugin: The base class will already define all methods, hence we need to do a different check
            if (!!plugin._childClassMembers &&
                Array.isArray(plugin._childClassMembers)) {
                return plugin._childClassMembers.includes(methodName);
            }
            return methodName in plugin;
        });
    }
    /** Conditionally add puppeteer compatibility to values provided to the plugins */
    _addPuppeteerCompatIfNeeded(plugin, method, args) {
        const canUseShim = plugin._isPuppeteerExtraPlugin && !plugin.noPuppeteerShim;
        const methodWhitelist = [
            'onBrowser',
            'onPageCreated',
            'onPageClose',
            'afterConnect',
            'afterLaunch'
        ];
        const shouldUseShim = methodWhitelist.includes(method);
        if (!canUseShim || !shouldUseShim) {
            return args;
        }
        debug('add puppeteer compatibility', plugin.name, method);
        return [...args.map(arg => (0, puppeteer_compatiblity_shim_1.addPuppeteerCompat)(arg))];
    }
    /**
     * Dispatch plugin lifecycle events in a typesafe way.
     * Only Plugins that expose the supplied property will be called.
     *
     * Will not await results to dispatch events as fast as possible to all plugins.
     *
     * @param method - The lifecycle method name
     * @param args - Optional: Any arguments to be supplied to the plugin methods
     * @internal
     */
    dispatch(method, ...args) {
        var _a, _b;
        const plugins = this.filterByMethod(method);
        debug('dispatch', method, {
            all: this._plugins.length,
            filteredByMethod: plugins.length
        });
        for (const plugin of plugins) {
            try {
                args = this._addPuppeteerCompatIfNeeded.bind(this)(plugin, method, args);
                const fnType = (_b = (_a = plugin[method]) === null || _a === void 0 ? void 0 : _a.constructor) === null || _b === void 0 ? void 0 : _b.name;
                debug('dispatch to plugin', {
                    plugin: plugin.name,
                    method,
                    fnType
                });
                if (fnType === 'AsyncFunction') {
                    ;
                    plugin[method](...args).catch((err) => this.onPluginError(plugin, method, err));
                }
                else {
                    ;
                    plugin[method](...args);
                }
            }
            catch (err) {
                this.onPluginError(plugin, method, err);
            }
        }
    }
    /**
     * Dispatch plugin lifecycle events in a typesafe way.
     * Only Plugins that expose the supplied property will be called.
     *
     * Can also be used to get a definite return value after passing it to plugins:
     * Calls plugins sequentially and passes on a value (waterfall style).
     *
     * The plugins can either modify the value or return an updated one.
     * Will return the latest, updated value which ran through all plugins.
     *
     * By convention only the first argument will be used as the updated value.
     *
     * @param method - The lifecycle method name
     * @param args - Optional: Any arguments to be supplied to the plugin methods
     * @internal
     */
    async dispatchBlocking(method, ...args) {
        const plugins = this.filterByMethod(method);
        debug('dispatchBlocking', method, {
            all: this._plugins.length,
            filteredByMethod: plugins.length
        });
        let retValue = null;
        for (const plugin of plugins) {
            try {
                args = this._addPuppeteerCompatIfNeeded.bind(this)(plugin, method, args);
                retValue = await plugin[method](...args);
                // In case we got a return value use that as new first argument for followup function calls
                if (retValue !== undefined) {
                    args[0] = retValue;
                }
            }
            catch (err) {
                this.onPluginError(plugin, method, err);
                return retValue;
            }
        }
        return retValue;
    }
    /**
     * Order plugins that have expressed a special placement requirement.
     *
     * This is useful/necessary for e.g. plugins that depend on the data from other plugins.
     *
     * @private
     */
    order() {
        debug('order:before', this.names);
        const runLast = this._plugins
            .filter(p => { var _a; return (_a = p.requirements) === null || _a === void 0 ? void 0 : _a.has('runLast'); })
            .map(p => p.name);
        for (const name of runLast) {
            const index = this._plugins.findIndex(p => p.name === name);
            this._plugins.push(this._plugins.splice(index, 1)[0]);
        }
        debug('order:after', this.names);
    }
    /**
     * Collects the exposed `data` property of all registered plugins.
     * Will be reduced/flattened to a single array.
     *
     * Can be accessed by plugins that listed the `dataFromPlugins` requirement.
     *
     * Implemented mainly for plugins that need data from other plugins (e.g. `user-preferences`).
     *
     * @see [PuppeteerExtraPlugin]/data
     * @param name - Filter data by optional name
     *
     * @private
     */
    getData(name) {
        const data = this._plugins
            .filter((p) => !!p.data)
            .map((p) => (Array.isArray(p.data) ? p.data : [p.data]))
            .reduce((acc, arr) => [...acc, ...arr], []);
        return name ? data.filter((d) => d.name === name) : data;
    }
    /**
     * Handle `plugins` stanza (already instantiated plugins that don't require dynamic imports)
     */
    resolvePluginsStanza() {
        debug('resolvePluginsStanza');
        const pluginNames = new Set(this.names);
        this._plugins
            .filter(p => !!p.plugins && p.plugins.length)
            .filter(p => !pluginNames.has(p.name)) // TBD: Do we want to filter out existing?
            .forEach(parent => {
            ;
            (parent.plugins || []).forEach(p => {
                debug(parent.name, 'adding missing plugin', p.name);
                this.add(p);
            });
        });
    }
    /**
     * Handle `dependencies` stanza (which requires dynamic imports)
     *
     * Plugins can define `dependencies` as a Set or Array of dependency paths, or a Map with additional opts
     *
     * @note
     * - The default opts for implicit dependencies can be defined using `setDependencyDefaults()`
     * - Dynamic imports can be avoided by providing plugin modules with `setDependencyResolution()`
     */
    resolveDependenciesStanza() {
        debug('resolveDependenciesStanza');
        /** Attempt to dynamically require a plugin module */
        const requireDependencyOrDie = (parentName, dependencyPath) => {
            // If the user provided the plugin module already we use that
            if (this._dependencyResolution.has(dependencyPath)) {
                return this._dependencyResolution.get(dependencyPath);
            }
            const possiblePrefixes = ['puppeteer-extra-plugin-']; // could be extended later
            const isAlreadyPrefixed = possiblePrefixes.some(prefix => dependencyPath.startsWith(prefix));
            const packagePaths = [];
            // If the dependency is not already prefixed we attempt to require all possible combinations to find one that works
            if (!isAlreadyPrefixed) {
                packagePaths.push(...possiblePrefixes.map(prefix => prefix + dependencyPath));
            }
            // We always attempt to require the path verbatim (as a last resort)
            packagePaths.push(dependencyPath);
            const pluginModule = (0, loader_1.requirePackages)(packagePaths);
            if (pluginModule) {
                return pluginModule;
            }
            const explanation = `
The plugin '${parentName}' listed '${dependencyPath}' as dependency,
which could not be found. Please install it:

${packagePaths
                .map(packagePath => `yarn add ${packagePath.split('/')[0]}`)
                .join(`\n or:\n`)}

Note: You don't need to require the plugin yourself,
unless you want to modify it's default settings.

If your bundler has issues with dynamic imports take a look at '.plugins.setDependencyResolution()'.
      `;
            console.warn(explanation);
            throw new Error('Plugin dependency not found');
        };
        const existingPluginNames = new Set(this.names);
        const recursivelyLoadMissingDependencies = ({ name: parentName, dependencies }) => {
            if (!dependencies) {
                return;
            }
            const processDependency = (dependencyPath, opts) => {
                const pluginModule = requireDependencyOrDie(parentName, dependencyPath);
                opts = opts || this._dependencyDefaults.get(dependencyPath) || {};
                const plugin = pluginModule(opts);
                if (existingPluginNames.has(plugin.name)) {
                    debug(parentName, '=> dependency already exists:', plugin.name);
                    return;
                }
                existingPluginNames.add(plugin.name);
                debug(parentName, '=> adding new dependency:', plugin.name, opts);
                this.add(plugin);
                return recursivelyLoadMissingDependencies(plugin);
            };
            if (dependencies instanceof Set || Array.isArray(dependencies)) {
                return [...dependencies].forEach(dependencyPath => processDependency(dependencyPath));
            }
            if (dependencies instanceof Map) {
                // Note: `k,v => v,k` (Map + forEach will reverse the order)
                return dependencies.forEach((v, k) => processDependency(k, v));
            }
        };
        this.list.forEach(recursivelyLoadMissingDependencies);
    }
    /**
     * Lightweight plugin dependency management to require plugins and code mods on demand.
     * @private
     */
    resolveDependencies() {
        debug('resolveDependencies');
        this.resolvePluginsStanza();
        this.resolveDependenciesStanza();
    }
}
exports.PluginList = PluginList;
//# sourceMappingURL=plugins.js.map