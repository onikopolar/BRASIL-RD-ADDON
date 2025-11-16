class RealDebridConfig {
    constructor() {
        this.apiBaseUrl = 'https://api.real-debrid.com/rest/1.0';
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadCurrentConfig();
        await this.validateCurrentToken();
    }

    bindEvents() {
        document.getElementById('saveBtn').addEventListener('click', () => this.saveConfig());
        document.getElementById('testBtn').addEventListener('click', () => this.testConnection());
        document.getElementById('apiKey').addEventListener('input', () => this.clearStatus());
    }

    async loadCurrentConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const config = await response.json();
                if (config.apiKey) {
                    document.getElementById('apiKey').value = config.apiKey;
                    this.showStatus('Configuração atual carregada', 'info');
                }
            }
        } catch (error) {
            console.error('Erro ao carregar configuração:', error);
        }
    }

    async saveConfig() {
        const apiKey = document.getElementById('apiKey').value.trim();
        
        if (!this.validateApiKeyFormat(apiKey)) {
            this.showStatus('Formato de chave API inválido', 'error');
            return;
        }

        this.setLoadingState(true, 'Salvando...');

        try {
            // Primeiro testa a chave
            const isValid = await this.validateApiKey(apiKey);
            if (!isValid) {
                this.showStatus('Chave API inválida ou expirada', 'error');
                return;
            }

            // Se válida, salva no servidor
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
                this.showStatus('Configuração salva e validada com sucesso!', 'success');
                await this.updateUserInfo();
            } else {
                this.showStatus(`Erro no servidor: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showStatus('Erro de conexão com o servidor', 'error');
            console.error('Erro ao salvar configuração:', error);
        } finally {
            this.setLoadingState(false);
        }
    }

    async testConnection() {
        const apiKey = document.getElementById('apiKey').value.trim();
        
        if (!apiKey) {
            this.showStatus('Por favor, insira uma chave API', 'error');
            return;
        }

        this.setLoadingState(true, 'Testando conexão...');

        try {
            const isValid = await this.validateApiKey(apiKey);
            if (isValid) {
                await this.updateUserInfo();
                this.showStatus('Conexão com Real-Debrid bem-sucedida!', 'success');
            } else {
                this.showStatus('Falha na autenticação com Real-Debrid', 'error');
            }
        } catch (error) {
            this.showStatus('Erro ao testar conexão: ' + error.message, 'error');
        } finally {
            this.setLoadingState(false);
        }
    }

    async validateApiKey(apiKey) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/user`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 401) {
                throw new Error('Token expirado ou inválido');
            }

            if (response.status === 403) {
                throw new Error('Conta bloqueada ou sem permissões');
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const userData = await response.json();
            this.userInfo = userData;
            return true;

        } catch (error) {
            console.error('Erro na validação da API:', error);
            return false;
        }
    }

    async validateCurrentToken() {
        const apiKey = document.getElementById('apiKey').value.trim();
        if (apiKey) {
            const isValid = await this.validateApiKey(apiKey);
            if (!isValid) {
                this.showStatus('Chave API atual é inválida ou expirada', 'warning');
            }
        }
    }

    validateApiKeyFormat(apiKey) {
        // Verifica formato básico - chaves Real-Debrid geralmente têm 40+ caracteres
        return apiKey && apiKey.length >= 20;
    }

    async updateUserInfo() {
        if (!this.userInfo) return;

        // Atualiza a UI com informações do usuário
        const statusDiv = document.getElementById('status');
        const userInfoHtml = `
            <div class="user-info">
                <strong>Conta Real-Debrid:</strong> ${this.userInfo.username || this.userInfo.email} |
                <strong>Tipo:</strong> ${this.userInfo.type || 'N/A'} |
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

        // Auto-esconder mensagens de sucesso após 5 segundos
        if (type === 'success') {
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 5000);
        }
    }

    clearStatus() {
        const statusDiv = document.getElementById('status');
        statusDiv.style.display = 'none';
    }
}

// Inicialização quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', () => {
    new RealDebridConfig();
});

// Tratamento de erros globais
window.addEventListener('error', (event) => {
    console.error('Erro global:', event.error);
});
