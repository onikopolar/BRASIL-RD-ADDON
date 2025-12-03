"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureTemplate = void 0;
const configureTemplate = (manifest) => {
    const background = manifest.background || 'https://dl.strem.io/addon-background.jpg';
    const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png';
    return `<!DOCTYPE html>
    <html style="background-image: url(${background});">
    <head>
        <meta charset="utf-8">
        <title>${manifest.name} - Stremio Addon</title>
        <style>
            * {
                box-sizing: border-box;
            }

            body,
            html {
                margin: 0;
                padding: 0;
                width: 100%;
                min-height: 100%;
            }

            body {
                padding: 2vh;
                font-size: 2.2vh;
            }

            html {
                background-size: auto 100%;
                background-size: cover;
                background-position: center center;
                background-repeat: no-repeat;
                box-shadow: inset 0 0 0 2000px rgb(0 0 0 / 60%);
            }

            body {
                display: flex;
                font-family: 'Open Sans', Arial, sans-serif;
                color: white;
            }

            h1 {
                font-size: 4.5vh;
                font-weight: 700;
            }

            h2 {
                font-size: 2.2vh;
                font-weight: normal;
                font-style: italic;
                opacity: 0.8;
            }

            h3 {
                font-size: 2.2vh;
            }

            h1,
            h2,
            h3,
            p {
                margin: 0;
                text-shadow: 0 0 1vh rgba(0, 0, 0, 0.15);
            }

            p {
                font-size: 1.75vh;
            }

            ul {
                font-size: 1.75vh;
                margin: 0;
                margin-top: 1vh;
                padding-left: 3vh;
            }

            a {
                color: white
            }

            a.install-link {
                text-decoration: none
            }

            a.api-link {
                color: #34c5dbff;
                text-decoration: none;
                font-weight: 600;
            }

            a.info-link {
                color: #34c5dbff;
                text-decoration: none;
                font-weight: 600;
            }

            a.api-link:hover,
            a.info-link:hover {
                text-decoration: underline;
            }

            button {
                border: 0;
                outline: 0;
                color: white;
                background: #8A5AAB;
                padding: 1.2vh 3.5vh;
                margin: auto;
                text-align: center;
                font-family: 'Open Sans', Arial, sans-serif;
                font-size: 2.2vh;
                font-weight: 600;
                cursor: pointer;
                display: block;
                box-shadow: 0 0.5vh 1vh rgba(0, 0, 0, 0.2);
                transition: box-shadow 0.1s ease-in-out;
            }

            button:hover {
                box-shadow: none;
            }

            button:active {
                box-shadow: 0 0 0 0.5vh white inset;
            }

            #addon {
                width: 40vh;
                margin: auto;
            }

            .logo {
                height: 14vh;
                width: 14vh;
                margin: auto;
                margin-bottom: 3vh;
            }

            .logo img {
                width: 100%;
            }

            .name, .version {
                display: inline-block;
                vertical-align: top;
            }

            .name {
                line-height: 5vh;
                margin: 0;
            }

            .version {
                position: relative;
                line-height: 5vh;
                opacity: 0.8;
                margin-bottom: 2vh;
            }

            .contact {
                position: absolute;
                left: 0;
                bottom: 4vh;
                width: 100%;
                text-align: center;
            }

            .contact a {
                font-size: 1.4vh;
                font-style: italic;
            }

            .separator {
                margin-bottom: 4vh;
            }

            .form-element {
                margin-bottom: 2vh;
            }

            .label-to-top {
                margin-bottom: 2vh;
            }

            .label-to-right {
                margin-left: 1vh !important;
            }

            .full-width {
                width: 100%;
            }

            input[type="text"] {
                width: 100%;
                padding: 8px;
                border: 1px solid #ccc;
                border-radius: 3px;
                font-size: 14px;
            }

            .info-text {
                font-size: 1.8vh;
                color: #ecf0f1;
                margin-top: 1.5vh;
                line-height: 1.4;
                text-shadow: 0 0 1vh rgba(0, 0, 0, 0.3);
            }

            .warning-text {
                font-size: 1.7vh;
                color: #fff428ff;
                margin-top: 2vh;
                padding: 1.5vh;
                background: rgba(243, 156, 18, 0.15);
                border-radius: 5px;
                border-left: 4px solid #f39c12;
                line-height: 1.5;
                text-shadow: 0 0 1vh rgba(0, 0, 0, 0.3);
            }

            .warning-text strong {
                color: #fce729ff;
            }
        </style>
        <link href="https://fonts.googleapis.com/css?family=Open+Sans:400,600,700&display=swap" rel="stylesheet">
    </head>
    <body>
        <div id="addon">
            <div class="logo">
                <img src="${logo}">
            </div>
            <h1 class="name">${manifest.name}</h1>
            <h2 class="version">v${manifest.version}</h2>
            <h2 class="description">${manifest.description}</h2>

            <div class="separator"></div>

            <h3 class="gives">Este addon oferece: :</h3>
            <ul>
                <li>Filmes</li>
                <li>Séries</li>
            </ul>

            <div class="separator"></div>

            <form class="pure-form" id="mainForm">
                <div class="form-element">
                    <div class="label-to-top">Chave de API do Real-Debrid (Obtenha sua <a href="https://real-debrid.com/apitoken" target="_blank" class="api-link">API aqui</a>)</div>
                    <input type="text" id="${manifest.config[0].key}" name="${manifest.config[0].key}" class="full-width" required placeholder="${manifest.config[0].placeholder}"/>
                    
                    <div class="info-text">
                        Documentação completa do addon disponível <a href="https://github.com/onikopolar/BRASIL-RD-ADDON" target="_blank" class="info-link">aqui</a>
                    </div>

                    <div class="warning-text">
                        <strong>Aviso de Segurança:</strong> Este é o repositório oficial mantido por ONIKO. Não me responsabilizo pela segurança de sua chave API em forks ou versões não oficiais deste projeto.
                    </div>
                </div>
            </form>

            <div class="separator"></div>

            <a id="installLink" class="install-link" href="#">
                <button name="Install">INSTALL</button>
            </a>
        </div>
        <script>
            installLink.onclick = () => {
                return mainForm.reportValidity()
            }
            const updateLink = () => {
                const config = Object.fromEntries(new FormData(mainForm))
                installLink.href = 'stremio://' + window.location.host + '/' + encodeURIComponent(JSON.stringify(config)) + '/manifest.json'
            }
            mainForm.onchange = updateLink
            updateLink()
        </script>
    </body>
    </html>`;
};
exports.configureTemplate = configureTemplate;
