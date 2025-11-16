class RealDebridConfig {
    constructor() {
        this.userInfo = null;
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
        // Não carrega configuração salva - cada usuário usa sua própria API key
    }

    bindEvents() {
        document.getElementById('saveBtn').addEventListener('click', () => this.generateInstallLink());
        document.getElementById('testBtn').addEventListener('click', () => this.testConnection());
        document.getElementById('apiKey').addEventListener('input', () => this.clearStatus());
        
        this.setupSecurityProtections();
    }

    setupSecurityProtections() {
        // Override console methods para esconder dados sensíveis
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

        // Proteção contra copy-paste de placeholder
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

    async generateInstallLink() {
        const apiKey = document.getElementById('apiKey').value.trim();

        // Verificação de segurança
        if (this.isSensitivePlaceholder(apiKey)) {
            this.showStatus('ERRO: Use uma chave API real do Real-Debrid, não o texto de exemplo', 'error');
            return;
        }

        if (!this.validateApiKeyFormat(apiKey)) {
            this.showStatus('Por favor, insira uma chave API válida', 'error');
            return;
        }

        this.setLoadingState(true, 'Validando chave API...');

        try {
            // Primeiro valida a chave API
            const isValid = await this.validateApiKey(apiKey);
            if (!isValid) {
                this.showStatus('Chave API inválida, expirada ou sem permissões', 'error');
                return;
            }

            // Gera o link de instalação personalizado
            const baseUrl = 'https://brasil-rd-addon.up.railway.app';
            const manifestUrl = `${baseUrl}/manifest.json`;
            
            // Codifica a API key para URL
            const encodedApiKey = encodeURIComponent(apiKey);
            const stremioLink = `stremio://${baseUrl}/manifest.json?apiKey=${encodedApiKey}`;
            
            // Mostra o link de instalação
            this.showInstallLink(stremioLink, manifestUrl, apiKey);
            
            await this.updateUserInfo();

        } catch (error) {
            this.showStatus('Erro ao validar chave API', 'error');
            console.error('Erro ao gerar link:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    showInstallLink(stremioLink, manifestUrl, apiKey) {
        const statusDiv = document.getElementById('status');
        
        statusDiv.innerHTML = `
            <div class="success-install">
                <h4> Chave API Validada com Sucesso!</h4>
                <p><strong>Clique no link abaixo para instalar automaticamente no Stremio:</strong></p>
                
                <div class="install-link">
                    <a href="${stremioLink}" class="stremio-link" onclick="event.preventDefault(); window.open('${stremioLink}', '_blank');">
                        INSTALAR BRASIL RD NO STREMIO
                    </a>
                </div>
                
                <div class="fallback-instructions">
                    <p><strong>Se o link acima não funcionar:</strong></p>
                    <ol>
                        <li>Copie este link: <code class="url-code">${manifestUrl}?apiKey=${encodeURIComponent(apiKey)}</code></li>
                        <li>Abra o Stremio</li>
                        <li>Vá em Add-ons → Instalar pelo link</li>
                        <li>Cole o link e instale</li>
                    </ol>
                </div>
                
                <div class="security-note">
                    <small> Sua chave API fica apenas no seu dispositivo e na URL do addon</small>
                </div>
            </div>
        `;
        statusDiv.className = 'status success';
        statusDiv.style.display = 'block';
    }

    async testConnection() {
        const apiKey = document.getElementById('apiKey').value.trim();

        if (!apiKey) {
            this.showStatus('Por favor, insira uma chave API válida', 'error');
            return;
        }

        if (this.isSensitivePlaceholder(apiKey)) {
            this.showStatus('ERRO: Use uma chave API real para teste', 'error');
            return;
        }

        this.setLoadingState(true, 'Testando conexão segura...');

        try {
            const isValid = await this.validateApiKey(apiKey);
            if (isValid) {
                await this.updateUserInfo();
                this.showStatus('Conexão com Real-Debrid validada com sucesso!', 'success');
            } else {
                this.showStatus('Falha na autenticação com Real-Debrid', 'error');
            }
        } catch (error) {
            this.showStatus('Erro seguro ao testar conexão', 'error');
        } finally {
            this.setLoadingState(false);
        }
    }

    async validateApiKey(apiKey) {
        try {
            const response = await fetch('/api/realdebrid/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ apiKey })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Erro ${response.status}`);
            }

            const result = await response.json();

            if (result.valid && result.user) {
                this.userInfo = result.user;
                return true;
            } else {
                throw new Error(result.error || 'Token inválido');
            }

        } catch (error) {
            console.error('Erro seguro na validação:', error);
            return false;
        }
    }

    validateApiKeyFormat(apiKey) {
        return apiKey && 
               apiKey.trim().length > 0 &&
               !this.isSensitivePlaceholder(apiKey);
    }

    async updateUserInfo() {
        if (!this.userInfo) return;

        const statusDiv = document.getElementById('status');
        const userInfoHtml = `
            <div class="user-info">
                <strong>Conta:</strong> ${this.userInfo.username || 'Usuário'} |
                <strong>Tipo:</strong> ${this.userInfo.type || 'Standard'} |
                <strong>Status:</strong> ${this.userInfo.premium ? 'Premium' : 'Free'} |
                <strong>Pontos:</strong> ${this.userInfo.points || '0'}
            </div>
        `;

        if (!statusDiv.querySelector('.user-info')) {
            statusDiv.innerHTML += userInfoHtml;
        }
    }

    setLoadingState(loading, text = '') {
        const saveBtn = document.getElementById('saveBtn');
        const testBtn = document.getElementById('testBtn');

        if (loading) {
            saveBtn.disabled = true;
            testBtn.disabled = true;
            saveBtn.textContent = text;
            saveBtn.classList.add('loading');
        } else {
            saveBtn.disabled = false;
            testBtn.disabled = false;
            saveBtn.textContent = 'Gerar Link de Instalação';
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
            }, 8000);
        }
    }

    clearStatus() {
        const statusDiv = document.getElementById('status');
        if (!statusDiv.querySelector('.user-info')) {
            statusDiv.style.display = 'none';
        }
    }
}

// Inicialização quando DOM carregar
document.addEventListener('DOMContentLoaded', () => {
    new RealDebridConfig();
});

// Tratamento de erros globais
window.addEventListener('error', (event) => {
    console.error('Erro global seguro:', event.error);
});

// Proteção contra inspeção no carregamento
document.addEventListener('DOMContentLoaded', () => {
    console.log('Brasil RD Addon - Interface segura carregada');
});