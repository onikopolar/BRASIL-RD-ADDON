class RealDebridConfig {
    constructor() {
        this.stremioUrl = 'stremio://brasil-rd-addon.up.railway.app/manifest.json';
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
        await this.loadCurrentConfig();
        // Não valida automaticamente para evitar exposição
    }

    bindEvents() {
        document.getElementById('saveBtn').addEventListener('click', () => this.saveConfig());
        document.getElementById('testBtn').addEventListener('click', () => this.testConnection());
        document.getElementById('apiKey').addEventListener('input', () => this.clearStatus());
        
        // Proteção contra inspeção - limpa logs sensíveis
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

    async loadCurrentConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const config = await response.json();
                // SÓ preenche se for uma chave válida e não for placeholder
                if (config.apiKey && 
                    !this.isSensitivePlaceholder(config.apiKey) && 
                    this.validateApiKeyFormat(config.apiKey)) {
                    document.getElementById('apiKey').value = config.apiKey;
                    this.showStatus('Configuração segura carregada', 'info');
                } else {
                    // Campo fica VAZIO por segurança
                    document.getElementById('apiKey').value = '';
                    this.showStatus('Insira sua chave API do Real-Debrid', 'info');
                }
            }
        } catch (error) {
            console.error('Erro ao carregar configuração:', error);
            // Em caso de erro, campo fica VAZIO
            document.getElementById('apiKey').value = '';
        }
    }

    async saveConfig() {
        const apiKey = document.getElementById('apiKey').value.trim();

        // Verificação EXTRA de segurança
        if (this.isSensitivePlaceholder(apiKey)) {
            this.showStatus('ERRO: Use uma chave API real do Real-Debrid, não o texto de exemplo', 'error');
            return;
        }

        if (!this.validateApiKeyFormat(apiKey)) {
            this.showStatus('Por favor, insira uma chave API válida', 'error');
            return;
        }

        this.setLoadingState(true, 'Validando e salvando com segurança...');

        try {
            // Validação via nosso backend seguro - ÚNICA validação real
            const isValid = await this.validateApiKey(apiKey);
            if (!isValid) {
                this.showStatus('Chave API inválida, expirada ou sem permissões', 'error');
                return;
            }

            // Salva no servidor APÓS validação
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    apiKey,
                    timestamp: new Date().toISOString()
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus('Configuração validada e salva com sucesso! Redirecionando para Stremio...', 'success');
                await this.updateUserInfo();

                // Redireciona após breve delay
                setTimeout(() => {
                    this.redirectToStremio();
                }, 2000);

            } else {
                this.showStatus(`Erro no servidor: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showStatus('Erro de conexão segura com o servidor', 'error');
            console.error('Erro ao salvar configuração:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    redirectToStremio() {
        // Tenta abrir via protocolo stremio://
        window.location.href = this.stremioUrl;

        // Fallback seguro
        setTimeout(() => {
            this.showStatus('Se o Stremio não abriu: Adicione manualmente via URL → https://brasil-rd-addon.up.railway.app/manifest.json', 'info');
        }, 1000);
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
            this.showStatus('🔒 Erro seguro ao testar conexão', 'error');
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
        // VALIDAÇÃO OFICIAL: Apenas verifica se não está vazio e não é placeholder
        // A validação real é feita exclusivamente pela API do Real-Debrid
        return apiKey && 
               apiKey.trim().length > 0 &&
               !this.isSensitivePlaceholder(apiKey);
    }

    async updateUserInfo() {
        if (!this.userInfo) return;

        // Atualiza UI com informações SEGURAS (sem dados sensíveis)
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
            saveBtn.textContent = 'Salvar Configuração';
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
        // Não limpa mensagens de usuário
        if (!statusDiv.querySelector('.user-info')) {
            statusDiv.style.display = 'none';
        }
    }
}

// Inicialização SEGURA quando DOM carregar
document.addEventListener('DOMContentLoaded', () => {
    new RealDebridConfig();
});

// Tratamento SEGURO de erros globais
window.addEventListener('error', (event) => {
    console.error('Erro global seguro:', event.error);
});

// Proteção contra inspeção no carregamento
document.addEventListener('DOMContentLoaded', () => {
    console.log('Brasil RD Addon - Interface segura carregada');
});