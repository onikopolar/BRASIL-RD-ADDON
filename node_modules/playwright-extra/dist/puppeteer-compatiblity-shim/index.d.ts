import type * as pw from 'playwright-core';
export declare type PlaywrightObject = pw.Page | pw.Frame | pw.Browser;
export interface PuppeteerBrowserShim {
    isCompatShim?: boolean;
    isPlaywright?: boolean;
    pages?: pw.BrowserContext['pages'];
    userAgent: () => Promise<'string'>;
}
export interface PuppeteerPageShim {
    isCompatShim?: boolean;
    isPlaywright?: boolean;
    browser?: () => pw.Browser;
    evaluateOnNewDocument?: pw.Page['addInitScript'];
    _client: () => pw.CDPSession;
}
export declare const isPlaywrightPage: (obj: unknown) => obj is pw.Page;
export declare const isPlaywrightFrame: (obj: unknown) => obj is pw.Frame;
export declare const isPlaywrightBrowser: (obj: unknown) => obj is pw.Browser;
export declare const isPuppeteerCompat: (obj?: unknown) => obj is PlaywrightObject;
/** Augment a Playwright object with compatibility with certain Puppeteer methods */
export declare function addPuppeteerCompat<Input extends pw.Page | pw.Frame | pw.Browser | null>(object: Input): Input;
export declare function getPageCDPSession(page: pw.Page | pw.Frame): Promise<pw.CDPSession>;
export declare function getBrowserCDPSession(browser: pw.Browser): Promise<pw.CDPSession>;
export declare function createPageShim(page: pw.Page | pw.Frame): pw.Page | pw.Frame;
export declare function createBrowserShim(browser: pw.Browser): pw.Browser;
