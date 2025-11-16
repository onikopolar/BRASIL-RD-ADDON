declare const router: import("express-serve-static-core").Router;
export declare class ConfigManager {
    private envPath;
    constructor();
    updateApiKey(apiKey: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    getCurrentConfig(): Promise<{
        apiKey?: string;
    }>;
}
export default router;
