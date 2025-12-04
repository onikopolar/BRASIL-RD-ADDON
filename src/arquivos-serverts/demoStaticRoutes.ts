import { Logger } from '../utils/logger';

const logger = new Logger('DemoStaticRoutes');

/**
 * Configura rotas de demonstração do sistema de respostas estáticas
 * Inspirado no sistema do Torrentio
 */
export const setupDemoStaticRoutes = (app: any) => {
    // Rota de demonstração das respostas estáticas
    app.get('/demo-static', (req: any, res: any) => {
        const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brasil RD - Demo Respostas Estáticas</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        header {
            text-align: center;
            margin-bottom: 40px;
            padding: 20px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            backdrop-filter: blur(10px);
        }
        
        h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        
        .subtitle {
            font-size: 1.2rem;
            opacity: 0.9;
            margin-bottom: 20px;
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .feature-card {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 25px;
            backdrop-filter: blur(10px);
            transition: transform 0.3s ease, background 0.3s ease;
        }
        
        .feature-card:hover {
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.15);
        }
        
        .feature-icon {
            font-size: 3rem;
            margin-bottom: 15px;
        }
        
        .feature-title {
            font-size: 1.5rem;
            margin-bottom: 10px;
            color: #fff;
        }
        
        .feature-description {
            font-size: 1rem;
            line-height: 1.6;
            opacity: 0.9;
            margin-bottom: 20px;
        }
        
        .response-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin-bottom: 40px;
        }
        
        .response-card {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            padding: 20px;
            text-align: center;
            transition: all 0.3s ease;
            cursor: pointer;
            text-decoration: none;
            color: white;
            display: block;
        }
        
        .response-card:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: scale(1.05);
        }
        
        .response-icon {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        
        .response-name {
            font-size: 1.2rem;
            margin-bottom: 5px;
            font-weight: bold;
        }
        
        .response-type {
            font-size: 0.9rem;
            opacity: 0.8;
            background: rgba(255, 255, 255, 0.2);
            padding: 3px 10px;
            border-radius: 20px;
            display: inline-block;
            margin-bottom: 10px;
        }
        
        .info-box {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 25px;
            margin-top: 40px;
            backdrop-filter: blur(10px);
        }
        
        .info-box h2 {
            margin-bottom: 15px;
            color: #fff;
        }
        
        .info-box p {
            line-height: 1.6;
            margin-bottom: 15px;
            opacity: 0.9;
        }
        
        .endpoints {
            margin-top: 20px;
        }
        
        .endpoint {
            background: rgba(255, 255, 255, 0.1);
            padding: 10px 15px;
            border-radius: 8px;
            margin-bottom: 10px;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            word-break: break-all;
        }
        
        .endpoint a {
            color: #4fc3f7;
            text-decoration: none;
        }
        
        .endpoint a:hover {
            text-decoration: underline;
        }
        
        @media (max-width: 768px) {
            h1 {
                font-size: 2rem;
            }
            
            .features {
                grid-template-columns: 1fr;
            }
            
            .response-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>��� Brasil RD - Sistema de Respostas Estáticas</h1>
            <p class="subtitle">Inspirado no sistema do Torrentio para melhor experiência do usuário</p>
        </header>
        
        <div class="features">
            <div class="feature-card">
                <div class="feature-icon">⏳</div>
                <h3 class="feature-title">Download em Andamento</h3>
                <p class="feature-description">
                    Quando um torrent está sendo baixado no Real-Debrid, 
                    mostramos um aviso amigável em vez de erro. O usuário 
                    sabe que precisa aguardar alguns minutos.
                </p>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">❌</div>
                <h3 class="feature-title">Erros Explicativos</h3>
                <p class="feature-description">
                    Cada tipo de erro tem uma mensagem clara e específica:
                    chave API inválida, limite excedido, conteúdo bloqueado, etc.
                </p>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">���</div>
                <h3 class="feature-title">Não Mais "Stream Não Encontrado"</h3>
                <p class="feature-description">
                    Eliminamos a frustração do usuário que vê "Nenhum stream disponível" 
                    quando na verdade o conteúdo está sendo processado.
                </p>
            </div>
        </div>
        
        <h2 style="text-align: center; margin-bottom: 20px;">Respostas Disponíveis</h2>
        <div class="response-grid">
            <a href="/static/downloading" class="response-card">
                <div class="response-icon">⏳</div>
                <div class="response-name">Download em Andamento</div>
                <div class="response-type">STATUS</div>
                <p>Aguarde alguns minutos enquanto baixamos</p>
            </a>
            
            <a href="/static/failed_download" class="response-card">
                <div class="response-icon">❌</div>
                <div class="response-name">Download Falhou</div>
                <div class="response-type">ERRO</div>
                <p>Não foi possível baixar o torrent</p>
            </a>
            
            <a href="/static/failed_access" class="response-card">
                <div class="response-icon">���</div>
                <div class="response-name">Erro de Autenticação</div>
                <div class="response-type">ERRO</div>
                <p>Chave API do Real-Debrid inválida</p>
            </a>
            
            <a href="/static/limits_exceeded" class="response-card">
                <div class="response-icon">⏱️</div>
                <div class="response-name">Limites Excedidos</div>
                <div class="response-type">ERRO</div>
                <p>Você excedeu os limites do Real-Debrid</p>
            </a>
            
            <a href="/static/failed_rar" class="response-card">
                <div class="response-icon">���</div>
                <div class="response-name">Arquivo RAR</div>
                <div class="response-type">ERRO</div>
                <p>Arquivo compactado não suportado</p>
            </a>
            
            <a href="/static/failed_too_big" class="response-card">
                <div class="response-icon">���</div>
                <div class="response-name">Torrent Muito Grande</div>
                <div class="response-type">ERRO</div>
                <p>Excede limite de tamanho do Real-Debrid</p>
            </a>
        </div>
        
        <div class="info-box">
            <h2>��� Como Funciona</h2>
            <p>
                Este sistema é inspirado no Torrentio. Quando o Real-Debrid retorna 
                um status como "downloading", "queued" ou "magnet_conversion", 
                em vez de retornar "null" (que faz o Stremio mostrar "Nenhum stream disponível"), 
                retornamos uma URL especial que mostra uma mensagem informativa ao usuário.
            </p>
            
            <p>
                O Stremio reproduz esta URL como um stream normal, permitindo que o 
                usuário veja informações sobre o status do download.
            </p>
            
            <p>
                <strong>Exemplo de fluxo:</strong><br>
                1. Usuário seleciona um torrent no Stremio<br>
                2. Brasil RD detecta que o torrent está "downloading" no Real-Debrid<br>
                3. Retorna URL: <code>http://localhost:7000/static/downloading</code><br>
                4. Stremio mostra: "⏳ Download em Andamento" com descrição explicativa<br>
                5. Usuário aguarda e tenta novamente em alguns minutos
            </p>
            
            <div class="endpoints">
                <h3>��� Endpoints Disponíveis</h3>
                <div class="endpoint">
                    <strong>JSON Info:</strong> <a href="/static">/static</a> (lista todas as respostas)
                </div>
                <div class="endpoint">
                    <strong>HTML Page:</strong> <a href="/static/html/downloading">/static/html/{response}</a>
                </div>
                <div class="endpoint">
                    <strong>Video Stream:</strong> <a href="/static/video/downloading">/static/video/{response}</a>
                </div>
                <div class="endpoint">
                    <strong>JSON Response:</strong> <a href="/static/downloading">/static/{response}</a>
                </div>
                <div class="endpoint">
                    <strong>Health Check:</strong> <a href="/health">/health</a>
                </div>
            </div>
        </div>
        
        <div class="info-box" style="margin-top: 20px;">
            <h2>��� Integração com Real-Debrid</h2>
            <p>
                O <code>RealDebridService.ts</code> foi modificado para usar este sistema:
            </p>
            <div class="endpoint">
                <strong>Método atualizado:</strong> <code>getStreamLinkForTorrent()</code><br>
                Agora retorna URLs estáticas quando o status não é "downloaded"
            </div>
            <div class="endpoint">
                <strong>Método novo:</strong> <code>getStreamLinkWithStatus()</code><br>
                Retorna objeto completo com status, URL estática e progresso
            </div>
            <p style="margin-top: 15px;">
                Status mapeados para respostas estáticas:<br>
                • "downloading", "uploading", "queued" → DOWNLOADING<br>
                • "magnet_conversion", "waiting_files_selection" → DOWNLOADING<br>
                • "error", "dead" → FAILED_DOWNLOAD<br>
                • Códigos de erro específicos → respostas específicas
            </p>
        </div>
    </div>
    
    <script>
        // Script simples para demonstrar as respostas
        document.addEventListener('DOMContentLoaded', function() {
            const cards = document.querySelectorAll('.response-card');
            cards.forEach(card => {
                card.addEventListener('click', function(e) {
                    e.preventDefault();
                    const url = this.getAttribute('href');
                    const responseName = this.querySelector('.response-name').textContent;
                    
                    // Mostrar preview da resposta
                    fetch(url)
                        .then(response => {
                            if (response.headers.get('content-type')?.includes('application/json')) {
                                return response.json().then(data => {
                                    alert(data.name + '\\n\\n' + data.description);
                                });
                            } else {
                                window.open(url, '_blank');
                            }
                        })
                        .catch(() => {
                            window.open(url, '_blank');
                        });
                });
            });
            
            // Log de inicialização
            console.log('Brasil RD - Demo de Respostas Estáticas carregada');
            console.log('Sistema inspirado no Torrentio para melhor UX');
        });
    </script>
</body>
</html>
        `;
        
        res.setHeader('content-type', 'text/html');
        res.end(html);
        
        logger.info('Página de demo de respostas estáticas servida', {
            endpoint: '/demo-static',
            note: 'Sistema inspirado no Torrentio'
        });
    });

    logger.info('Rotas de demonstração de respostas estáticas configuradas', {
        routes: ['/demo-static']
    });
};
