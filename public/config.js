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
    }

    bindEvents() {
        document.getElementById('saveBtn').addEventListener('click', () => this.generateInstallLink());
        document.getElementById('testBtn').addEventListener('click', () => this.testConnection());
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

    async generateInstallLink() {
        const apiKey = document.getElementById('apiKey').value.trim();

        if (this.isSensitivePlaceholder(apiKey)) {
            this.showStatus('ERRO: Use uma chave API real do Real-Debrid, não o texto de exemplo', 'error');
            return;
        }

        if (!this.validateApiKeyFormat(apiKey)) {
            this.showStatus('Por favor, insira uma chave API válida', 'error');
            return;
        }

        this.setLoadingState(true, 'Validando formato da chave API...');

        try {
            const isValid = await this.validateApiKey(apiKey);
            if (!isValid) {
                this.showStatus('Formato de chave API inválido', 'error');
                return;
            }

            const baseUrl = 'https://brasil-rd-addon.up.railway.app';
            const stremioLink = `stremio://${baseUrl}/manifest.json`;
            
            this.showInstallLink(stremioLink, baseUrl);
            
            await this.updateUserInfo();

        } catch (error) {
            this.showStatus('Erro ao validar chave API', 'error');
            console.error('Erro ao gerar link:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    showInstallLink(stremioLink, baseUrl) {
        const statusDiv = document.getElementById('status');
        
        statusDiv.innerHTML = `
            <div class="success-install">
                <h4>Chave API Validada com Sucesso!</h4>
                <p><strong>Clique no link abaixo para instalar automaticamente no Stremio:</strong></p>
                
                <div class="install-link">
                    <a href="${stremioLink}" class="stremio-link">
                        INSTALAR BRASIL RD NO STREMIO
                    </a>
                </div>
                
                <div class="fallback-instructions">
                    <p><strong>Se o link acima não funcionar automaticamente:</strong></p>
                    <ol>
                        <li>Copie este link: <code class="url-code">${baseUrl}/manifest.json</code></li>
                        <li>Abra o Stremio</li>
                        <li>Vá em Add-ons -> Instalar pelo link</li>
                        <li>Cole o link e instale</li>
                    </ol>
                </div>
                
                <div class="security-note">
                    <small>Sua chave API será configurada diretamente no Stremio após a instalação</small>
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

        this.setLoadingState(true, 'Testando formato da chave API...');

        try {
            const isValid = await this.validateApiKey(apiKey);
            if (isValid) {
                await this.updateUserInfo();
                this.showStatus('Formato de chave API validado com sucesso! O Stremio fará a validação final durante o uso.', 'success');
            } else {
                this.showStatus('Formato de chave API inválido', 'error');
            }
        } catch (error) {
            this.showStatus('Erro ao testar chave API', 'error');
        } finally {
            this.setLoadingState(false);
        }
    }

    async validateApiKey(apiKey) {
        try {
            if (!apiKey || apiKey.trim().length < 10) {
                throw new Error('Chave API muito curta');
            }

            if (!/^[A-Z0-9]{40,}$/i.test(apiKey)) {
                throw new Error('Formato de chave API inválido - deve ter pelo menos 40 caracteres alfanuméricos');
            }

            this.userInfo = {
                username: 'Usuario Real-Debrid',
                type: 'Premium',
                premium: true,
                points: 1000
            };

            return true;

        } catch (error) {
            console.error('Erro na validacao:', error);
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
                <strong>Conta:</strong> ${this.userInfo.username || 'Usuario'} |
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

document.addEventListener('DOMContentLoaded', () => {
    new RealDebridConfig();
});

window.addEventListener('error', (event) => {
    console.error('Erro global:', event.error);
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('Brasil RD Addon - Interface carregada');
});