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
        console.log('RealDebridConfig inicializado - Adaptado para Railway');
    }

    async loadCurrentConfig() {
        try {
            console.log('Carregando configuração atual...');
            const response = await fetch('/config');
            console.log('Resposta do /config:', response.status);
            const config = await response.json();
            console.log('Configuração carregada:', config);
            
            if (config.apiKey) {
                document.getElementById('apiKey').value = config.apiKey;
                console.log('API key preenchida do cache');
            }
        } catch (error) {
            console.log('Nenhuma configuração anterior encontrada:', error);
        }
    }

    updateUIForSDK() {
        const saveBtn = document.getElementById('saveBtn');
        saveBtn.textContent = 'Salvar Configuração';
        this.updateInstructions();
        console.log('UI atualizada para Railway');
    }

    updateInstructions() {
        const infoCard = document.querySelector('.info-card');
        if (infoCard) {
            infoCard.innerHTML = `
                <h3>Instalação no Railway:</h3>
                <ol>
                    <li>Obtenha sua API key no site do Real-Debrid</li>
                    <li>Cole a chave no campo acima</li>
                    <li>Clique em "Salvar Configuração"</li>
                    <li>Use o protocolo stremio:// do Railway</li>
                    <li>Cole na barra de endereço do navegador</li>
                    <li>O Stremio abrirá com prompt de instalação</li>
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
        console.log('Eventos vinculados');
        
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
        console.log('Iniciando saveConfigAndInstall, API Key:', apiKey ? '***' + apiKey.slice(-4) : 'vazia');

        if (this.isSensitivePlaceholder(apiKey)) {
            console.log('API key é placeholder, bloqueando');
            this.showStatus('ERRO: Use uma chave API real do Real-Debrid, não o texto de exemplo', 'error');
            return;
        }

        if (!this.validateApiKeyFormat(apiKey)) {
            console.log('API key com formato inválido');
            this.showStatus('Por favor, insira uma chave API válida', 'error');
            return;
        }

        this.setLoadingState(true, 'Salvando configuração...');

        try {
            if (!this.validateApiKeyBasic(apiKey)) {
                console.log('Validação básica da API key falhou');
                this.showStatus('Formato de chave API inválido', 'error');
                return;
            }

            console.log('Enviando API key para o backend...');
            const saveResponse = await fetch('/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ apiKey: apiKey })
            });

            console.log('Resposta do backend:', saveResponse.status);
            const saveResult = await saveResponse.json();
            console.log('Resultado do save:', saveResult);

            if (saveResult.success) {
                console.log('Configuração salva com sucesso, mostrando opcoes Railway');
                this.showRailwayInstallOptions();
            } else {
                console.log('Erro ao salvar configuração:', saveResult.error);
                this.showStatus('Erro ao salvar configuração: ' + (saveResult.error || 'Erro desconhecido'), 'error');
            }

        } catch (error) {
            console.error('Erro na função saveConfigAndInstall:', error);
            this.showStatus('Erro de conexão com o servidor', 'error');
        } finally {
            this.setLoadingState(false);
        }
    }

    showRailwayInstallOptions() {
        console.log('Mostrando opcoes de instalacao para Railway');
        const statusDiv = document.getElementById('status');
        const apiKey = document.getElementById('apiKey').value.trim();
        const baseUrl = this.baseUrl;
        
        // URL do Railway - substitua pelo seu dominio real do Railway
        const railwayDomain = 'brasil-rd-addon.up.railway.app';
        const railwayUrl = `https://${railwayDomain}`;
        const railwayStremioProtocol = `stremio://${railwayDomain}/manifest.json?apiKey=${apiKey}`;
        
        // URL atual (pode ser localhost ou railway)
        const currentUrl = `${baseUrl}/manifest.json?apiKey=${apiKey}`;
        const currentStremioProtocol = `stremio://${window.location.hostname}/manifest.json?apiKey=${apiKey}`;
        
        console.log('URL Railway:', railwayUrl);
        console.log('Protocolo Railway:', railwayStremioProtocol);
        console.log('URL Atual:', currentUrl);
        console.log('Protocolo Atual:', currentStremioProtocol);
        
        statusDiv.innerHTML = `
            <div class="success-install">
                <h4>Configuração Salva com Sucesso!</h4>
                <p><strong>Escolha o metodo de instalacao:</strong></p>
                
                <div class="railway-options">
                    <div class="railway-option">
                        <h5>Opcao 1: Railway (Recomendado)</h5>
                        <p><strong>Use o dominio publico do Railway - funciona como o Torrentio</strong></p>
                        <div class="url-container">
                            <code class="url-code">${railwayStremioProtocol}</code>
                            <button class="copy-btn" onclick="copyToClipboard('${railwayStremioProtocol}')">
                                Copiar Protocolo Railway
                            </button>
                        </div>
                        <small>Domínio publico: ${railwayDomain}</small>
                    </div>
                    
                    <div class="railway-option">
                        <h5>Opcao 2: Ambiente Atual</h5>
                        <p><strong>Use o dominio atual (${window.location.hostname})</strong></p>
                        <div class="url-container">
                            <code class="url-code">${currentStremioProtocol}</code>
                            <button class="copy-btn" onclick="copyToClipboard('${currentStremioProtocol}')">
                                Copiar Protocolo Atual
                            </button>
                        </div>
                    </div>
                </div>
                
                <div class="fallback-options">
                    <div class="fallback-option">
                        <h5>URLs HTTP para copiar (Metodo Manual):</h5>
                        <p><strong>Use estas URLs se os protocolos nao funcionarem</strong></p>
                        <div class="url-container">
                            <code class="url-code">${railwayUrl}/manifest.json?apiKey=${apiKey}</code>
                            <button class="copy-btn" onclick="copyToClipboard('${railwayUrl}/manifest.json?apiKey=${apiKey}')">
                                Copiar URL Railway
                            </button>
                        </div>
                        <div class="url-container">
                            <code class="url-code">${currentUrl}</code>
                            <button class="copy-btn" onclick="copyToClipboard('${currentUrl}')">
                                Copiar URL Atual
                            </button>
                        </div>
                    </div>
                </div>
                
                <div class="install-steps">
                    <p><strong>Como instalar:</strong></p>
                    <ol>
                        <li>Copie um dos protocolos acima (recomendado: Railway)</li>
                        <li>Cole na barra de endereco do navegador (NAO clique)</li>
                        <li>O Stremio abrira automaticamente</li>
                        <li>Confirme a instalacao no prompt</li>
                        <li>Se nao funcionar, use as URLs HTTP manualmente no Stremio</li>
                    </ol>
                </div>
                
                <div class="notes">
                    <p><strong>Notas importantes:</strong></p>
                    <ul>
                        <li>Railway: Domínio publico - funciona igual ao Torrentio</li>
                        <li>Ambiente Atual: Pode ser localhost (teste) ou railway</li>
                        <li>Protocolos devem ser COLADOS na barra de endereco</li>
                        <li>URLs HTTP funcionam manualmente no Stremio</li>
                        <li>Addon ja vem pre-configurado com sua API key</li>
                    </ul>
                </div>
            </div>
        `;
        statusDiv.className = 'status success';
        statusDiv.style.display = 'block';
    }

    validateApiKeyBasic(apiKey) {
        if (!apiKey || apiKey.trim().length < 10) {
            console.log('API key muito curta');
            return false;
        }

        if (!/^[A-Z0-9]{40,}$/i.test(apiKey)) {
            console.log('API key com formato invalido (regex)');
            return false;
        }

        console.log('API key validada com sucesso');
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
            console.log('Loading state: true -', text);
        } else {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salvar Configuração';
            saveBtn.classList.remove('loading');
            console.log('Loading state: false');
        }
    }

    showStatus(message, type) {
        console.log('Mostrando status:', type, message);
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
        console.log('Status limpo');
    }
}

// Adicionar metodo copyToClipboard ao escopo global
window.copyToClipboard = function(text) {
    console.log('copyToClipboard global chamado:', text);
    navigator.clipboard.writeText(text).then(() => {
        alert('URL copiada para a area de transferencia!');
    });
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM carregado, iniciando RealDebridConfig');
    new RealDebridConfig();
});

window.addEventListener('error', (event) => {
    console.error('Erro global:', event.error);
});