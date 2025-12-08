import type * as pw from 'playwright-core';
/** Node.js module loader helper */
export declare class Loader<TargetModule> {
    moduleName: string;
    packageNames: string[];
    constructor(moduleName: string, packageNames: string[]);
    /**
     * Lazy load a top level export from another module by wrapping it in a JS proxy.
     *
     * This allows us to re-export e.g. `devices` from `playwright` while redirecting direct calls
     * to it to the module version the user has installed, rather than shipping with a hardcoded version.
     *
     * If we don't do this and the user doesn't have the target module installed we'd throw immediately when our code is imported.
     *
     * We use a "super" Proxy defining all traps, so calls like `Object.keys(playwright.devices).length` will return the correct value.
     */
    lazyloadExportOrDie<T extends keyof TargetModule>(exportName: T): TargetModule[T];
    /** Load the module if possible */
    loadModule(): TargetModule | undefined;
    /** Load the module if possible or throw */
    loadModuleOrDie(): TargetModule;
    get requireError(): Error;
}
export declare function requirePackages<TargetModule = any>(packageNames: string[]): TargetModule | undefined;
/** Playwright specific module loader */
export declare const playwrightLoader: Loader<typeof pw>;
