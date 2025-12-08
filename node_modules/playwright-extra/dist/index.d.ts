import type * as pw from 'playwright-core';
import { PlaywrightExtra, PlaywrightExtraClass } from './extra';
import { PluginList } from './plugins';
export { PlaywrightExtra, PlaywrightExtraClass } from './extra';
export { PluginList } from './plugins';
/** A playwright browser launcher */
export declare type PlaywrightBrowserLauncher = pw.BrowserType<{}>;
/** A playwright browser launcher with plugin functionality */
export declare type AugmentedBrowserLauncher = PlaywrightExtraClass & PlaywrightBrowserLauncher;
/**
 * The minimum shape we expect from a playwright compatible launcher object.
 * We intentionally keep this not strict so other custom or compatible launchers can be used.
 */
export interface PlaywrightCompatibleLauncher {
    connect(...args: any[]): Promise<any>;
    launch(...args: any[]): Promise<any>;
}
/** Our custom module exports */
interface ExtraModuleExports {
    PlaywrightExtra: typeof PlaywrightExtra;
    PlaywrightExtraClass: typeof PlaywrightExtraClass;
    PluginList: typeof PluginList;
    addExtra: typeof addExtra;
    chromium: AugmentedBrowserLauncher;
    firefox: AugmentedBrowserLauncher;
    webkit: AugmentedBrowserLauncher;
}
/** Vanilla playwright module exports */
declare type PlaywrightModuleExports = typeof pw;
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
export declare const addExtra: <Launcher extends PlaywrightCompatibleLauncher>(launcher?: Launcher | undefined) => PlaywrightExtraClass & Launcher;
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
export declare const chromium: PlaywrightExtraClass & pw.BrowserType<{}>;
/**
 * This object can be used to launch or connect to Firefox with plugin functionality
 * @note This export will always return the same instance, if you wish to use multiple instances with different plugins use `addExtra`
 */
export declare const firefox: PlaywrightExtraClass & pw.BrowserType<{}>;
/**
 * This object can be used to launch or connect to Webkit with plugin functionality
 * @note This export will always return the same instance, if you wish to use multiple instances with different plugins use `addExtra`
 */
export declare const webkit: PlaywrightExtraClass & pw.BrowserType<{}>;
export declare const _android: pw.Android;
export declare const _electron: pw.Electron;
export declare const request: pw.APIRequest;
export declare const selectors: pw.Selectors;
export declare const devices: {
    [key: string]: {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Blackberry PlayBook": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Blackberry PlayBook landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "BlackBerry Z30": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "BlackBerry Z30 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy Note 3": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy Note 3 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy Note II": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy Note II landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy S III": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy S III landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy S5": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy S5 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy S8": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy S8 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy S9+": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy S9+ landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy Tab S4": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Galaxy Tab S4 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPad (gen 6)": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPad (gen 6) landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPad (gen 7)": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPad (gen 7) landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPad Mini": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPad Mini landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPad Pro 11": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPad Pro 11 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 6": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 6 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 6 Plus": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 6 Plus landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 7": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 7 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 7 Plus": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 7 Plus landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 8": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 8 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 8 Plus": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 8 Plus landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone SE": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone SE landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone X": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone X landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone XR": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone XR landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 11": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 11 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 11 Pro": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 11 Pro landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 11 Pro Max": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 11 Pro Max landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 12": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 12 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 12 Pro": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 12 Pro landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 12 Pro Max": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 12 Pro Max landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 12 Mini": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 12 Mini landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 13": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 13 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 13 Pro": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 13 Pro landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 13 Pro Max": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 13 Pro Max landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 13 Mini": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "iPhone 13 Mini landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "JioPhone 2": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "JioPhone 2 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Kindle Fire HDX": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Kindle Fire HDX landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "LG Optimus L70": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "LG Optimus L70 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Microsoft Lumia 550": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Microsoft Lumia 550 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Microsoft Lumia 950": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Microsoft Lumia 950 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 10": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 10 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 4": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 4 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 5": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 5 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 5X": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 5X landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 6": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 6 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 6P": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 6P landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 7": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nexus 7 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nokia Lumia 520": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nokia Lumia 520 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nokia N9": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Nokia N9 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 2": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 2 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 2 XL": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 2 XL landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 3": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 3 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 4": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 4 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 4a (5G)": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 4a (5G) landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 5": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Pixel 5 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Moto G4": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Moto G4 landscape": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Desktop Chrome HiDPI": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Desktop Edge HiDPI": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Desktop Firefox HiDPI": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Desktop Safari": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Desktop Chrome": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Desktop Edge": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
    "Desktop Firefox": {
        viewport: pw.ViewportSize;
        userAgent: string;
        deviceScaleFactor: number;
        isMobile: boolean;
        hasTouch: boolean;
        defaultBrowserType: "chromium" | "firefox" | "webkit";
    };
} & {
    viewport: pw.ViewportSize;
    userAgent: string;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
    defaultBrowserType: "chromium" | "firefox" | "webkit";
}[];
export declare const errors: typeof pw.errors;
/** Playwright with plugin functionality */
declare const moduleExports: ExtraModuleExports & PlaywrightModuleExports;
export default moduleExports;
