"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureTemplate = void 0;
const logger_js_1 = require("../utils/logger.js");
const logger = new logger_js_1.Logger('ConfigureTemplate');
const configureTemplate = (manifest, apiKey) => {
    const background = manifest.background || 'https://dl.strem.io/addon-background.jpg';
    const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png';
    const configKey = manifest.config?.[0]?.key || 'apiKey';
    const initialApiKey = apiKey?.trim() || '';
    return `<!DOCTYPE html>
    <html style="background-image: url(${background});">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>${manifest.name} - Stremio Addon</title>
        
        <style>
            * { box-sizing: border-box; }
            body, html { margin: 0; padding: 0; width: 100%; min-height: 100%; }
            body { padding: 2vh; font-size: 2.2vh; }
            html { 
                background-size: cover; 
                background-position: center center; 
                background-repeat: no-repeat; 
                box-shadow: inset 0 0 0 2000px rgb(0 0 0 / 60%); 
            }
            body { display: flex; font-family: 'Open Sans', Arial, sans-serif; color: white; }
            h1 { font-size: 3.8vh; font-weight: 700; margin: 0; }
            h2 { font-size: 2.2vh; font-weight: normal; font-style: italic; opacity: 0.8; margin:0; }
            h3 { font-size: 2.2vh; margin: 0; }
            p { font-size: 1.75vh; margin: 0; text-shadow: 0 0 1vh rgba(0, 0, 0, 0.15); }
            ul { font-size: 1.75vh; margin: 0; margin-top: 1vh; padding-left: 3vh; }
            a { color: white; text-decoration: none; }
            a.api-link { color: #34c5dbff; font-weight: 600; }
            a.api-link:hover { text-decoration: underline; }
            
            button {
                border: 0; outline: 0; color: white; background: #8A5AAB;
                padding: 1.2vh 3.5vh; margin: auto; text-align: center;
                font-family: 'Open Sans', Arial, sans-serif; font-size: 2.2vh;
                font-weight: 600; cursor: pointer; display: block;
                box-shadow: 0 0.5vh 1vh rgba(0, 0, 0, 0.2);
                transition: box-shadow 0.1s ease-in-out;
            }
            button:hover { box-shadow: none; }
            button:active { box-shadow: 0 0 0 0.5vh white inset; }
            
            #addon { width: 40vh; margin: auto; }
            .logo { height: 14vh; width: 14vh; margin: auto; margin-bottom: 3vh; }
            .logo img { width: 100%; }
            .name { line-height: 5vh; text-align: center; }
            .version { line-height: 5vh; opacity: 0.8; margin-bottom: 2vh; text-align: center; }
            .description { text-align: center; }
            .separator { margin-bottom: 4vh; }
            .form-element { margin-bottom: 2vh; }
            
            input[type="text"] {
                width: 100%; padding: 8px; border: 1px solid #ccc;
                border-radius: 3px; font-size: 14px; margin-top: 0.5vh;
            }
            
            .info-text {
                font-size: 1.8vh; color: #ecf0f1; margin-top: 1.5vh;
                line-height: 1.4; text-shadow: 0 0 1vh rgba(0, 0, 0, 0.3);
            }
            
            .warning-text {
                font-size: 1.7vh; color: #fff428ff; margin-top: 2vh;
                padding: 1.5vh; background: rgba(243, 156, 18, 0.15);
                border-radius: 5px; border-left: 4px solid #f39c12;
                line-height: 1.5; text-shadow: 0 0 1vh rgba(0, 0, 0, 0.3);
            }
            
            .warning-text strong { color: #fce729ff; }

            /* Botões lado a lado */
            .install-buttons {
                display: none; /* Inicialmente oculto */
                gap: 1.5vh;
                justify-content: center;
                width: 100%;
            }
            .install-buttons.visible {
                display: flex;
            }
            .install-buttons a {
                flex: 1;
                text-decoration: none;
            }
            .install-buttons button {
                width: 100%;
            }

            /* Mobile */
            @media (max-width: 768px) {
                body { padding: 2.5vh 2vh; }
                #addon { width: 100%; max-width: 50vh; }
                h1 { font-size: 4.2vh; }
                h2, h3 { font-size: 2.2vh; }
                p, ul, .info-text { font-size: 1.8vh; }
                .warning-text { font-size: 1.7vh; }
                button { width: 100%; padding: 1.6vh; font-size: 2vh; }
                input[type="text"] { padding: 1.3vh; font-size: 2vh; }
                .logo { height: 11vh; width: 11vh; }
                .separator { margin-bottom: 2.5vh; }
            }

            @media (max-width: 375px) {
                h1 { font-size: 3.6vh; }
                h2, h3 { font-size: 2vh; }
                button { font-size: 1.8vh; padding: 1.3vh; }
                .logo { height: 9vh; width: 9vh; }
            }
        </style>
        
        <link href="https://fonts.googleapis.com/css?family=Open+Sans:400,600,700&display=swap" rel="stylesheet">
    </head>
    
    <body>
        <div id="addon">
            <div class="logo">
                <img src="${logo}" alt="${manifest.name} Logo">
            </div>
            
            <h1 class="name">${manifest.name}</h1>
            <h2 class="version">v${manifest.version}</h2>
            <h2 class="description">${manifest.description}</h2>
            
            <div class="separator"></div>
            
            <h3>Este addon oferece:</h3>
            <ul>
                <li>Filmes</li>
                <li>Séries</li>
            </ul>
            
            <div class="separator"></div>
            
            <form class="pure-form" id="mainForm">
                <div class="form-element">
                    <div class="label-to-top">
                        Chave de API do Torbox 
                        <a href="https://torbox.app/" target="_blank" class="api-link">
                            (Obtenha sua API aqui)
                        </a>
                    </div>
                    
                    <input type="text" 
                           id="${configKey}" 
                           name="${configKey}" 
                           class="full-width" 
                           required 
                           placeholder="Cole sua chave de API do Torbox"
                           autocomplete="off"
                           value="${initialApiKey}" />
                    
                    <div class="info-text">
                        Documentação completa: 
                        <a href="https://github.com/onikopolar/BRASIL-RD-ADDON" target="_blank" class="api-link">
                            GitHub Oficial
                        </a>
                    </div>
                    
                    <div class="warning-text">
                        <strong>Aviso de Segurança:</strong> Este é o repositório oficial mantido por ONIKO. 
                        Não me responsabilizo pela segurança de sua chave API em forks ou versões não oficiais.
                    </div>
                </div>
            </form>
            
            <div class="separator"></div>
            
            <div id="installButtons" class="install-buttons">
                <a id="installStremioLink" class="install-link" href="#">
                    <button name="Install">STREMIO</button>
                </a>
                <a id="installNuvioLink" class="install-link" href="#">
                    <button name="InstallNuvio">NUVIO</button>
                </a>
            </div>
            
            <div id="directUrlSection" class="form-element" style="display: none;">
                <div class="label-to-top" style="margin-bottom: 0.5vh;">
                    URL do Manifest (para AlOManager / uso manual)
                </div>
                <input id="directUrl" type="text" readonly onclick="this.select();document.execCommand('copy');var t=this;t.style.background='rgba(138,90,171,0.3)';setTimeout(function(){t.style.background='rgba(255,255,255,0.1)'},600);" 
                       style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 3px; font-size: 14px; margin-top: 0.5vh; background: rgba(255,255,255,0.1); color: #ccc; cursor: pointer;" 
                       title="Clique para copiar" />
            </div>
        </div>
        
        <script>
            (function() {
                const apiKeyInput = document.getElementById('${configKey}');
                const installButtons = document.getElementById('installButtons');
                const installStremioLink = document.getElementById('installStremioLink');
                const installNuvioLink = document.getElementById('installNuvioLink');
                const directUrl = document.getElementById('directUrl');
                const directUrlSection = document.getElementById('directUrlSection');
                const mainForm = document.getElementById('mainForm');

                function getBaseUrl() {
                    return window.location.protocol + '//' + window.location.host;
                }

                function updateLinks() {
                    const apiKey = apiKeyInput.value.trim();
                    const baseUrl = getBaseUrl();

                    if (apiKey) {
                        const manifestUrl = baseUrl + '/torbox=' + encodeURIComponent(apiKey) + '/manifest.json';
                        directUrl.value = manifestUrl;
                        directUrlSection.style.display = 'block';
                        installButtons.classList.add('visible');

                        // Stremio: usa protocolo stremio://
                        installStremioLink.href = 'stremio://' + window.location.host + '/torbox=' + encodeURIComponent(apiKey) + '/manifest.json';

                        // Nuvio: usa deep link nuvio://
                        installNuvioLink.href = 'nuvio://' + window.location.host + '/torbox=' + encodeURIComponent(apiKey) + '/manifest.json';
                    } else {
                        installButtons.classList.remove('visible');
                        directUrl.value = '';
                        directUrlSection.style.display = 'none';
                        installStremioLink.href = '#';
                        installNuvioLink.href = '#';
                    }
                }

                apiKeyInput.oninput = updateLinks;
                apiKeyInput.onpaste = () => setTimeout(updateLinks, 100);
                mainForm.onsubmit = (e) => e.preventDefault();
                
                installStremioLink.onclick = () => {
                    if (!mainForm.reportValidity()) {
                        alert('Por favor, insira sua API Key do Torbox.');
                        return false;
                    }
                    return true;
                };

                updateLinks();
            })();
        </script>
    </body>
    </html>`;
};
exports.configureTemplate = configureTemplate;
logger.info('ConfigureTemplate v2.7.0 carregado - Suporte a Stremio e Nuvio com deep link');
