import type * as pw from 'playwright-core';
import type { CompatiblePlugin } from './types';
import { PluginList } from './plugins';
declare type PlaywrightBrowserLauncher = pw.BrowserType;
/**
 * The Playwright browser launcher APIs we're augmenting
 * @private
 */
interface AugmentedLauncherAPIs extends Pick<PlaywrightBrowserLauncher, 'launch' | 'launchPersistentContext' | 'connect' | 'connectOverCDP'> {
}
/**
 * Modular plugin framework to teach `playwright` new tricks.
 */
export declare class PlaywrightExtraClass implements AugmentedLauncherAPIs {
    private _launcher?;
    /** Plugin manager */
    readonly plugins: PluginList;
    constructor(_launcher?: Partial<PlaywrightBrowserLauncher> | undefined);
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
    use(plugin: CompatiblePlugin): this;
    launch(...args: Parameters<PlaywrightBrowserLauncher['launch']>): ReturnType<PlaywrightBrowserLauncher['launch']>;
    launchPersistentContext(...args: Parameters<PlaywrightBrowserLauncher['launchPersistentContext']>): ReturnType<PlaywrightBrowserLauncher['launchPersistentContext']>;
    connect(wsEndpointOrOptions: string | (pw.ConnectOptions & {
        wsEndpoint?: string;
    }), wsOptions?: pw.ConnectOptions): ReturnType<PlaywrightBrowserLauncher['connect']>;
    connectOverCDP(wsEndpointOrOptions: string | (pw.ConnectOverCDPOptions & {
        endpointURL?: string;
    }), wsOptions?: pw.ConnectOverCDPOptions): ReturnType<PlaywrightBrowserLauncher['connectOverCDP']>;
    protected _bindBrowserContextEvents(context: pw.BrowserContext, contextOptions?: pw.BrowserContextOptions): Promise<void>;
    protected _bindBrowserEvents(browser: pw.Browser): Promise<void>;
}
/**
 * PlaywrightExtra class with additional launcher methods.
 *
 * Augments the class with an instance proxy to pass on methods that are not augmented to the original target.
 *
 */
export declare const PlaywrightExtra: typeof PlaywrightExtraClass;
export {};
