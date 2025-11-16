class RealDebridConfig {
    constructor() {
        this.sensitivePlaceholders = [
            'SUA-CHAVE-API-AQUI',
            'YOUR-API-KEY-HERE', 
            'INSERT-API-KEY',
            'API_KEY_PLACEHOLDER',
            'REPLACE-WITH-API-KEY'
        ];
        this.init();
    }

    async init() {
        this.bindEvents();
        this.updateUIForSDK();
    }

    updateUIForSDK() {
        // Atualiza a UI para refletir o fluxo do SDK
        const saveBtn = document.getElementById('saveBtn');
        const testBtn = document.getElementById('testBtn');
        
        saveBtn.textContent = 'Instalar Addon no Stremio';
        testBtn.style.display = 'none'; // Remove teste de conexão
        
        // Atualiza instruções
        this.updateInstructions();
    }

    updateInstructions() {
        const infoCard = document.querySelector('.info-card');
        if (infoCard) {
            infoCard.innerHTML = `
                <h3>Como Usar:</h3>
                <ol>
                    <li>Obtenha sua API key no site do Real-Debrid</li>
                    <li>Cole a chave no campo acima</li>
                    <li>Clique em "Instalar Addon no Stremio"</li>
                    <li>O Stremio abrirá automaticamente para configuração</li>
                    <li>Complete a instalação no Stremio</li>
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
        document.getElementById('saveBtn').addEventListener('click', () => this.installAddon());
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

    async installAddon() {
        const apiKey = document.getElementById('apiKey').value.trim();

        if (this.isSensitivePlaceholder(apiKey)) {
            this.showStatus('ERRO: Use uma chave API real do Real-Debrid, não o texto de exemplo', 'error');
            return;
        }

        if (!this.validateApiKeyFormat(apiKey)) {
            this.showStatus('Por favor, insira uma chave API válida', 'error');
            return;
        }

        this.setLoadingState(true, 'Preparando instalação...');

        try {
            // Validação básica de formato
            if (!this.validateApiKeyBasic(apiKey)) {
                this.showStatus('Formato de chave API inválido', 'error');
                return;
            }

            // Fluxo oficial do SDK - o Stremio cuida de tudo
            this.showInstallInstructions();

        } catch (error) {
            this.showStatus('Erro ao preparar instalação', 'error');
            console.error('Erro:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    showInstallInstructions() {
        const statusDiv = document.getElementById('status');
        const baseUrl = 'https://brasil-rd-addon.up.railway.app';
        
        statusDiv.innerHTML = `
            <div class="success-install">
                <h4>Pronto para Instalar!</h4>
                <p><strong>Siga os passos abaixo para instalar o addon:</strong></p>
                
                <div class="install-steps">
                    <ol>
                        <li><strong>Abra o Stremio no seu dispositivo</strong></li>
                        <li><strong>Vá até a seção "Addons"</strong></li>
                        <li><strong>Clique em "Instalar pelo link"</strong></li>
                        <li><strong>Cole este link:</strong> 
                            <code class="url-code">${baseUrl}/manifest.json</code>
                        </li>
                        <li><strong>Complete a configuração dentro do Stremio</strong></li>
                    </ol>
                </div>
                
                <div class="copy-section">
                    <p><strong>Link para copiar:</strong></p>
                    <div class="url-container">
                        <code class="url-code">${baseUrl}/manifest.json</code>
                        <button class="copy-btn" onclick="navigator.clipboard.writeText('${baseUrl}/manifest.json').then(() => alert('Link copiado!'))">
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

    validateApiKeyBasic(apiKey) {
        // Validação básica de formato
        if (!apiKey || apiKey.trim().length < 10) {
            return false;
        }

        // Formato típico de chave Real-Debrid (40+ caracteres alfanuméricos)
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
            saveBtn.textContent = 'Instalar Addon no Stremio';
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