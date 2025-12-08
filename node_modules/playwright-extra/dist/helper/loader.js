"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.playwrightLoader = exports.requirePackages = exports.Loader = void 0;
/** Node.js module loader helper */
class Loader {
    constructor(moduleName, packageNames) {
        this.moduleName = moduleName;
        this.packageNames = packageNames;
    }
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
    lazyloadExportOrDie(exportName) {
        const that = this;
        const trapHandler = Object.fromEntries(Object.getOwnPropertyNames(Reflect).map((name) => [
            name,
            function (target, ...args) {
                const moduleExport = that.loadModuleOrDie()[exportName];
                const customTarget = moduleExport;
                const result = Reflect[name](customTarget || target, ...args);
                return result;
            }
        ]));
        return new Proxy({}, trapHandler);
    }
    /** Load the module if possible */
    loadModule() {
        return requirePackages(this.packageNames);
    }
    /** Load the module if possible or throw */
    loadModuleOrDie() {
        const module = requirePackages(this.packageNames);
        if (module) {
            return module;
        }
        throw this.requireError;
    }
    get requireError() {
        const moduleNamePretty = this.moduleName.charAt(0).toUpperCase() + this.moduleName.slice(1);
        return new Error(`
  ${moduleNamePretty} is missing. :-)

  I've tried loading ${this.packageNames
            .map(p => `"${p}"`)
            .join(', ')} - no luck.

  Make sure you install one of those packages or use the named 'addExtra' export,
  to patch a specific (and maybe non-standard) implementation of ${moduleNamePretty}.

  To get the latest stable version of ${moduleNamePretty} run:
  'yarn add ${this.moduleName}' or 'npm i ${this.moduleName}'
  `);
    }
}
exports.Loader = Loader;
function requirePackages(packageNames) {
    for (const name of packageNames) {
        try {
            return require(name);
        }
        catch (_) {
            continue; // noop
        }
    }
    return;
}
exports.requirePackages = requirePackages;
/** Playwright specific module loader */
exports.playwrightLoader = new Loader('playwright', [
    'playwright-core',
    'playwright'
]);
//# sourceMappingURL=loader.js.map