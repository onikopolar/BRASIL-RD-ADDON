"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigManager = void 0;
const express_1 = require("express");
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
const logger = new logger_1.Logger('ConfigAPI');
class ConfigManager {
    envPath;
    constructor() {
        this.envPath = path.join(process.cwd(), '.env');
    }
    async updateApiKey(apiKey) {
        try {
            let envContent = '';
            // Ler arquivo .env atual se existir
            if (await fs.pathExists(this.envPath)) {
                envContent = await fs.readFile(this.envPath, 'utf8');
            }
            // Atualizar ou adicionar REAL_DEBRID_API_KEY
            if (envContent.includes('REAL_DEBRID_API_KEY=')) {
                envContent = envContent.replace(/REAL_DEBRID_API_KEY=.*/, `REAL_DEBRID_API_KEY=${apiKey}`);
            }
            else {
                envContent += `\nREAL_DEBRID_API_KEY=${apiKey}\n`;
            }
            // Garantir que outras configurações essenciais existam
            if (!envContent.includes('NODE_ENV=')) {
                envContent += 'NODE_ENV=production\n';
            }
            if (!envContent.includes('PORT=')) {
                envContent += 'PORT=7000\n';
            }
            await fs.writeFile(this.envPath, envContent);
            logger.info('API key atualizada com sucesso');
            return { success: true };
        }
        catch (error) {
            const errorMsg = `Erro ao atualizar API key: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
            logger.error(errorMsg);
            return { success: false, error: errorMsg };
        }
    }
    async getCurrentConfig() {
        try {
            if (!await fs.pathExists(this.envPath)) {
                return {};
            }
            const envContent = await fs.readFile(this.envPath, 'utf8');
            const apiKeyMatch = envContent.match(/REAL_DEBRID_API_KEY=(.*)/);
            return {
                apiKey: apiKeyMatch ? apiKeyMatch[1] : undefined
            };
        }
        catch (error) {
            logger.error('Erro ao ler configuração atual');
            return {};
        }
    }
}
exports.ConfigManager = ConfigManager;
const configManager = new ConfigManager();
// Rota para obter configuração atual
router.get('/config', async (req, res) => {
    try {
        const config = await configManager.getCurrentConfig();
        res.json(config);
    }
    catch (error) {
        logger.error('Erro no GET /config:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});
// Rota para salvar nova configuração
router.post('/config', async (req, res) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) {
            return res.status(400).json({ error: 'Chave API é obrigatória' });
        }
        const result = await configManager.updateApiKey(apiKey);
        if (result.success) {
            const response = {
                success: true,
                message: 'Configuração atualizada com sucesso'
            };
            res.json(response);
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        logger.error('Erro no POST /config:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});
// Rota para gerar URL personalizada Torrentio-style
router.get('/generate-url', (req, res) => {
    const { apiKey } = req.query;
    if (!apiKey) {
        return res.status(400).json({ error: 'API key é obrigatória' });
    }
    // Gerar URL personalizada como o Torrentio
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const personalizedUrl = `${baseUrl}/manifest.json?apiKey=${encodeURIComponent(apiKey)}`;
    logger.info('URL personalizada gerada', {
        baseUrl,
        hasApiKey: !!apiKey
    });
    res.json({
        success: true,
        url: personalizedUrl,
        installUrl: personalizedUrl,
        message: 'Use esta URL para instalar o addon já configurado'
    });
});
// Rota de saúde para verificar se servidor está ativo
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
exports.default = router;
//# sourceMappingURL=config.js.map