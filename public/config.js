class RealDebridConfig {
    constructor() {
        this.sensitivePlaceholders = [
            'SUA-CHAVE-API-AQUI',
            'YOUR-API-KEY-HERE', 
            'INSERT-API-KEY',
            'API_KEY_PLACEHOLDER',
            'REPLACE-WITH-API-KEY'
        ];
        this.addonUrl = 'https://brasil-rd-addon.up.railway.app/manifest.json';
        this.init();
    }

    async init() {
        this.bindEvents();
        this.updateUIForSDK();
    }

    updateUIForSDK() {
        const saveBtn = document.getElementById('saveBtn');
        saveBtn.textContent = 'Instalar com SDK Oficial do Stremio';
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
                    <li>Clique em "Instalar com SDK Oficial do Stremio"</li>
                    <li>O Stremio abrirá automaticamente</li>
                    <li>Complete a configuração dentro do app</li>
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
        document.getElementById('saveBtn').addEventListener('click', () => this.installWithSDK());
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

    async installWithSDK() {
        const apiKey = document.getElementById('apiKey').value.trim();

        if (this.isSensitivePlaceholder(apiKey)) {
            this.showStatus('ERRO: Use uma chave API real do Real-Debrid, não o texto de exemplo', 'error');
            return;
        }

        if (!this.validateApiKeyFormat(apiKey)) {
            this.showStatus('Por favor, insira uma chave API válida', 'error');
            return;
        }

        this.setLoadingState(true, 'Abrindo Stremio...');

        try {
            if (!this.validateApiKeyBasic(apiKey)) {
                this.showStatus('Formato de chave API inválido', 'error');
                return;
            }

            // Fluxo oficial do SDK Stremio
            const stremioUrl = `stremio://${this.addonUrl}`;
            
            // Tenta abrir o Stremio via protocolo
            window.location.href = stremioUrl;
            
            // Fallback: se o Stremio não abrir em 2 segundos, mostra instruções manuais
            setTimeout(() => {
                if (!document.hidden) {
                    this.showManualInstall();
                }
            }, 2000);

        } catch (error) {
            this.showStatus('Erro ao tentar abrir o Stremio', 'error');
            console.error('Erro:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    showManualInstall() {
        const statusDiv = document.getElementById('status');
        
        statusDiv.innerHTML = `
            <div class="success-install">
                <h4>Stremio não detectado automaticamente</h4>
                <p><strong>Siga estes passos para instalar manualmente:</strong></p>
                
                <div class="install-steps">
                    <ol>
                        <li><strong>Abra o Stremio manualmente</strong></li>
                        <li><strong>Vá até a seção "Addons"</strong></li>
                        <li><strong>Clique em "Instalar pelo link"</strong></li>
                        <li><strong>Cole este link:</strong></li>
                    </ol>
                </div>
                
                <div class="copy-section">
                    <div class="url-container">
                        <code class="url-code">${this.addonUrl}</code>
                        <button class="copy-btn" onclick="this.copyToClipboard()">
                            Copiar
                        </button>
                    </div>
                </div>
                
                <div class="notes">
                    <p><strong>Notas importantes:</strong></p>
                    <ul>
                        <li>O Stremio irá solicitar a chave API durante a instalação</li>
                        <li>Sua chave fica salva apenas no seu Stremio</li>
                        <li>Não compartilhe sua chave API com ninguém</li>
                    </ul>
                </div>
            </div>
        `;
        statusDiv.className = 'status success';
        statusDiv.style.display = 'block';
    }

    copyToClipboard() {
        navigator.clipboard.writeText(this.addonUrl).then(() => {
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
            saveBtn.textContent = 'Instalar com SDK Oficial do Stremio';
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

document.addEventListener('DOMContentLoaded', () => {
    new RealDebridConfig();
});

window.addEventListener('error', (event) => {
    console.error('Erro global:', event.error);
});