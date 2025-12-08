import { Plugin, PluginMethodName, PluginMethodFn, CompatiblePluginModule } from './types';
export declare class PluginList {
    private readonly _plugins;
    private readonly _dependencyDefaults;
    private readonly _dependencyResolution;
    constructor();
    /**
     * Get a list of all registered plugins.
     */
    get list(): import("./types").PuppeteerExtraPlugin[];
    /**
     * Get the names of all registered plugins.
     */
    get names(): string[];
    /** Check if the shape of a plugin is correct or warn */
    protected isValidPluginInstance(plugin: Plugin): boolean;
    /** Error callback in case calling a plugin method throws an error. Can be overwritten. */
    onPluginError(plugin: Plugin, method: PluginMethodName, err: Error): void;
    /**
     * Define default values for plugins implicitly required through the `dependencies` plugin stanza.
     *
     * @param dependencyPath - The string by which the dependency is listed (not the plugin name)
     *
     * @example
     * chromium.use(stealth)
     * chromium.plugins.setDependencyDefaults('stealth/evasions/webgl.vendor', { vendor: 'Bob', renderer: 'Alice' })
     */
    setDependencyDefaults(dependencyPath: string, opts: any): this;
    /**
     * Define custom plugin modules for plugins implicitly required through the `dependencies` plugin stanza.
     *
     * Using this will prevent dynamic imports from being used, which JS bundlers often have issues with.
     *
     * @example
     * chromium.use(stealth)
     * chromium.plugins.setDependencyResolution('stealth/evasions/webgl.vendor', VendorPlugin)
     */
    setDependencyResolution(dependencyPath: string, pluginModule: CompatiblePluginModule): this;
    /** Return all plugins using the supplied method */
    protected filterByMethod(methodName: PluginMethodName): import("./types").PuppeteerExtraPlugin[];
    /** Conditionally add puppeteer compatibility to values provided to the plugins */
    protected _addPuppeteerCompatIfNeeded<TMethod extends PluginMethodName>(plugin: Plugin, method: TMethod, args: Parameters<PluginMethodFn<TMethod>>): Parameters<PluginMethodFn<TMethod>>;
    /**
     * Order plugins that have expressed a special placement requirement.
     *
     * This is useful/necessary for e.g. plugins that depend on the data from other plugins.
     *
     * @private
     */
    protected order(): void;
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
    protected getData(name?: string): any;
    /**
     * Handle `plugins` stanza (already instantiated plugins that don't require dynamic imports)
     */
    protected resolvePluginsStanza(): void;
    /**
     * Handle `dependencies` stanza (which requires dynamic imports)
     *
     * Plugins can define `dependencies` as a Set or Array of dependency paths, or a Map with additional opts
     *
     * @note
     * - The default opts for implicit dependencies can be defined using `setDependencyDefaults()`
     * - Dynamic imports can be avoided by providing plugin modules with `setDependencyResolution()`
     */
    protected resolveDependenciesStanza(): void;
    /**
     * Lightweight plugin dependency management to require plugins and code mods on demand.
     * @private
     */
    protected resolveDependencies(): void;
}
