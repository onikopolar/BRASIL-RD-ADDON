class RealDebridConfig {
    constructor() {
        this.sensitivePlaceholders = [
            'SUA-CHAVE-API-AQUI',
            'YOUR-API-KEY-HERE', 
            'INSERT-API-KEY',
            'API_KEY_PLACEHOLDER',
            'REPLACE-WITH-API-KEY'
        ];
        this.baseUrl = window.location.origin;
        this.init();
    }

    async init() {
        this.bindEvents();
        this.updateUIForSDK();
        await this.loadCurrentConfig();
    }

    async loadCurrentConfig() {
        try {
            const response = await fetch('/config');
            const config = await response.json();
            
            if (config.apiKey) {
                document.getElementById('apiKey').value = config.apiKey;
            }
        } catch (error) {
            console.log('Nenhuma configuração anterior encontrada');
        }
    }

    updateUIForSDK() {
        const saveBtn = document.getElementById('saveBtn');
        saveBtn.textContent = 'Salvar Configuração e Instalar Addon';
        this.updateInstructions();
    }

    updateInstructions() {
        const infoCard = document.querySelector('.info-card');
        if (infoCard) {
            infoCard.innerHTML = `
                <h3>Como Instalar (Fluxo Oficial SDK):</h3>
                <ol>
                    <li>Obtenha sua API key no site do Real-Debrid</li>
                    <li>Cole a chave no campo acima</li>
                    <li>Clique em "Salvar Configuração e Instalar Addon"</li>
                    <li>Sua chave será salva no servidor</li>
                    <li>Use o link abaixo para instalar no Stremio</li>
                </ol>

                <div class="features">
                    <h4>Funcionalidades:</h4>
                    <ul>
                        <li>Conteúdo brasileiro (dublado/legendado) por: BLUDV, COMANDO, STARCK</li>
                        <li>Qualidade 4K, 1080p, 720p automática</li>
                        <li>Velocidade de busca: 2-3 segundos</li>
                        <li>Suporte a filmes e séries</li>
                        <li>Integração completa com Real-Debrid</li>
                    </ul>
                </div>
            `;
        }
    }

    bindEvents() {
        document.getElementById('saveBtn').addEventListener('click', () => this.saveConfigAndInstall());
        document.getElementById('apiKey').addEventListener('input', () => this.clearStatus());
        
        this.setupSecurityProtections();
    }

    setupSecurityProtections() {
        const originalLog = console.log;
        const originalError = console.error;
        
        console.log = (...args) => {
            const sanitizedArgs = args.map(arg => this.sanitizeSensitiveData(arg));
            originalLog.apply(console, sanitizedArgs);
        };
        
        console.error = (...args) => {
            const sanitizedArgs = args.map(arg => this.sanitizeSensitiveData(arg));
            originalError.apply(console, sanitizedArgs);
        };

        document.getElementById('apiKey').addEventListener('paste', (e) => {
            setTimeout(() => {
                const pastedValue = e.target.value;
                if (this.isSensitivePlaceholder(pastedValue)) {
                    e.target.value = '';
                    this.showStatus('Por favor, cole sua chave API real do Real-Debrid', 'warning');
                }
            }, 10);
        });
    }

    sanitizeSensitiveData(data) {
        if (typeof data === 'string') {
            let sanitized = data;
            this.sensitivePlaceholders.forEach(placeholder => {
                sanitized = sanitized.replace(new RegExp(placeholder, 'gi'), '[REDACTED]');
            });
            return sanitized;
        }
        return data;
    }

    isSensitivePlaceholder(value) {
        return this.sensitivePlaceholders.some(placeholder => 
            value.toLowerCase().includes(placeholder.toLowerCase())
        );
    }

    async saveConfigAndInstall() {
        const apiKey = document.getElementById('apiKey').value.trim();

        if (this.isSensitivePlaceholder(apiKey)) {
            this.showStatus('ERRO: Use uma chave API real do Real-Debrid, não o texto de exemplo', 'error');
            return;
        }

        if (!this.validateApiKeyFormat(apiKey)) {
            this.showStatus('Por favor, insira uma chave API válida', 'error');
            return;
        }

        this.setLoadingState(true, 'Salvando configuração...');

        try {
            if (!this.validateApiKeyBasic(apiKey)) {
                this.showStatus('Formato de chave API inválido', 'error');
                return;
            }

            // Salvar a configuração no backend
            const saveResponse = await fetch('/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ apiKey: apiKey })
            });

            const saveResult = await saveResponse.json();

            if (saveResult.success) {
                this.showInstallInstructions();
            } else {
                this.showStatus('Erro ao salvar configuração: ' + (saveResult.error || 'Erro desconhecido'), 'error');
            }

        } catch (error) {
            this.showStatus('Erro de conexão com o servidor', 'error');
            console.error('Erro:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    showInstallInstructions() {
        const statusDiv = document.getElementById('status');
        const addonUrl = `${this.baseUrl}/manifest.json`;
        const stremioUrl = `stremio://${window.location.host}/manifest.json`;
        
        statusDiv.innerHTML = `
            <div class="success-install">
                <h4>Configuração Salva com Sucesso!</h4>
                <p><strong>Agora instale o addon no Stremio:</strong></p>
                
                <div class="install-steps">
                    <ol>
                        <li><strong>Método Automático (Recomendado):</strong></li>
                        <li>Clique no botão abaixo para abrir o Stremio</li>
                        <li>Ou use o método manual se o automático não funcionar</li>
                    </ol>
                </div>
                
                <div class="actions">
                    <button onclick="window.location.href='${stremioUrl}'" class="btn btn-primary">
                        Abrir no Stremio (Automático)
                    </button>
                </div>
                
                <div class="copy-section">
                    <p><strong>Método Manual:</strong></p>
                    <div class="url-container">
                        <code class="url-code">${addonUrl}</code>
                        <button class="copy-btn" onclick="this.copyToClipboard('${addonUrl}')">
                            Copiar
                        </button>
                    </div>
                    <small>Cole este link no Stremio: Addons → Instalar pelo link</small>
                </div>
                
                <div class="notes">
                    <p><strong>Notas importantes:</strong></p>
                    <ul>
                        <li>Sua chave API foi salva com sucesso no servidor</li>
                        <li>O addon agora está pronto para uso</li>
                        <li>Durante a instalação, o Stremio pode solicitar confirmação</li>
                    </ul>
                </div>
            </div>
        `;
        statusDiv.className = 'status success';
        statusDiv.style.display = 'block';
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            const copyBtn = event.target;
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copiado!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        });
    }

    validateApiKeyBasic(apiKey) {
        if (!apiKey || apiKey.trim().length < 10) {
            return false;
        }

        if (!/^[A-Z0-9]{40,}$/i.test(apiKey)) {
            return false;
        }

        return true;
    }

    validateApiKeyFormat(apiKey) {
        return apiKey && 
               apiKey.trim().length > 0 &&
               !this.isSensitivePlaceholder(apiKey);
    }

    setLoadingState(loading, text = '') {
        const saveBtn = document.getElementById('saveBtn');

        if (loading) {
            saveBtn.disabled = true;
            saveBtn.textContent = text;
            saveBtn.classList.add('loading');
        } else {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salvar Configuração e Instalar Addon';
            saveBtn.classList.remove('loading');
        }
    }

    showStatus(message, type) {
        const statusDiv = document.getElementById('status');
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        statusDiv.style.display = 'block';

        if (type === 'success') {
            setTimeout(() => {
                if (statusDiv.textContent === message) {
                    statusDiv.style.display = 'none';
                }
            }, 10000);
        }
    }

    clearStatus() {
        const statusDiv = document.getElementById('status');
        statusDiv.style.display = 'none';
    }
}

// Adicionar método copyToClipboard ao escopo global
window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('Link copiado para a área de transferência!');
    });
};

document.addEventListener('DOMContentLoaded', () => {
    new RealDebridConfig();
});

window.addEventListener('error', (event) => {
    console.error('Erro global:', event.error);
});