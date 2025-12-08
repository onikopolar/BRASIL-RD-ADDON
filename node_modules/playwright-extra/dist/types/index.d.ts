import type * as pw from 'playwright-core';
declare type PropType<TObj, TProp extends keyof TObj> = TObj[TProp];
declare type PluginEnv = {
    framework: 'playwright';
};
/** Strongly typed plugin lifecycle events for internal use */
export declare abstract class PluginLifecycleMethods {
    onPluginRegistered(env?: PluginEnv): Promise<void>;
    beforeLaunch(options: pw.LaunchOptions): Promise<pw.LaunchOptions | void>;
    afterLaunch(browserOrContext?: pw.Browser | pw.BrowserContext): Promise<void>;
    beforeConnect(options: pw.ConnectOptions): Promise<pw.ConnectOptions | void>;
    afterConnect(browser: pw.Browser): Promise<void>;
    onBrowser(browser: pw.Browser): Promise<void>;
    onPageCreated(page: pw.Page): Promise<void>;
    onPageClose(page: pw.Page): Promise<void>;
    onDisconnected(browser?: pw.Browser): Promise<void>;
    beforeContext(options?: pw.BrowserContextOptions, browser?: pw.Browser): Promise<pw.BrowserContextOptions | void>;
    onContextCreated(context?: pw.BrowserContext, options?: pw.BrowserContextOptions): Promise<void>;
}
/** A valid plugin method name */
export declare type PluginMethodName = keyof PluginLifecycleMethods;
/** A valid plugin method function */
export declare type PluginMethodFn<TName extends PluginMethodName> = PropType<PluginLifecycleMethods, TName>;
declare type PluginRequirements = Set<'launch' | 'headful' | 'dataFromPlugins' | 'runLast'>;
declare type PluginDependencies = Set<string> | Map<string, any> | string[];
interface PluginData {
    name: string | {
        [key: string]: any;
    };
    value: {
        [key: string]: any;
    };
}
export interface CompatiblePluginLifecycleMethods {
    onPluginRegistered(...any: any[]): Promise<any> | any;
    beforeLaunch(...any: any[]): Promise<any> | any;
    afterLaunch(...any: any[]): Promise<any> | any;
    beforeConnect(...any: any[]): Promise<any> | any;
    afterConnect(...any: any[]): Promise<any> | any;
    onBrowser(...any: any[]): Promise<any> | any;
    onPageCreated(...any: any[]): Promise<any> | any;
    onPageClose(...any: any[]): Promise<any> | any;
    onDisconnected(...any: any[]): Promise<any> | any;
    beforeContext(...any: any[]): Promise<any> | any;
    onContextCreated(...any: any[]): Promise<any> | any;
}
/**
 * PuppeteerExtraPlugin interface, strongly typed for internal use
 * @private
 */
export interface PuppeteerExtraPlugin extends Partial<PluginLifecycleMethods> {
    _isPuppeteerExtraPlugin: boolean;
    name: string;
    /** Disable the puppeteer compatibility shim for this plugin */
    noPuppeteerShim?: boolean;
    requirements?: PluginRequirements;
    dependencies?: PluginDependencies;
    data?: PluginData[];
    getDataFromPlugins?(name?: string): void;
    _registerChildClassMembers?(prototype: any): void;
    _childClassMembers?: string[];
    plugins?: CompatiblePlugin[];
}
/**
 * Minimal compatible PuppeteerExtraPlugin interface
 * @private
 */
export interface CompatiblePuppeteerPlugin extends Partial<CompatiblePluginLifecycleMethods> {
    _isPuppeteerExtraPlugin: boolean;
    name?: string;
}
export interface CompatiblePlaywrightPlugin extends Partial<CompatiblePluginLifecycleMethods> {
    _isPlaywrightExtraPlugin: boolean;
    name?: string;
}
export interface CompatibleExtraPlugin extends Partial<CompatiblePluginLifecycleMethods> {
    _isExtraPlugin: boolean;
    name?: string;
}
/**
 * A compatible plugin
 */
export declare type CompatiblePlugin = CompatiblePuppeteerPlugin | CompatiblePlaywrightPlugin | CompatibleExtraPlugin;
export declare type CompatiblePluginModule = (...args: any[]) => CompatiblePlugin;
export declare type Plugin = PuppeteerExtraPlugin;
export declare type PluginModule = (...args: any[]) => Plugin;
export {};
