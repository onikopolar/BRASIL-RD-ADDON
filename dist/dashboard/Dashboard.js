"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dashboard = void 0;
const react_1 = __importStar(require("react"));
const material_1 = require("@mui/material");
const icons_material_1 = require("@mui/icons-material");
const Dashboard = () => {
    const [magnetLink, setMagnetLink] = (0, react_1.useState)('');
    const [imdbId, setImdbId] = (0, react_1.useState)('');
    const [title, setTitle] = (0, react_1.useState)('');
    const [quality, setQuality] = (0, react_1.useState)('1080p');
    const [category, setCategory] = (0, react_1.useState)('');
    const [language, setLanguage] = (0, react_1.useState)('pt-BR');
    const [loading, setLoading] = (0, react_1.useState)(false);
    const [message, setMessage] = (0, react_1.useState)(null);
    const extractInfoFromMagnet = (magnet) => {
        // Tenta extrair informações do nome do arquivo no magnet
        const nameMatch = magnet.match(/dn=([^&]+)/);
        if (nameMatch) {
            const filename = decodeURIComponent(nameMatch[1]);
            setTitle(filename);
            // Tenta detectar qualidade
            if (filename.includes('4K') || filename.includes('2160p'))
                setQuality('4K');
            else if (filename.includes('1080p'))
                setQuality('1080p');
            else if (filename.includes('720p'))
                setQuality('720p');
            else
                setQuality('SD');
            // Tenta detectar categoria
            if (filename.match(/S\d+E\d+/i))
                setCategory('series');
            else
                setCategory('movie');
        }
    };
    const handleMagnetChange = (e) => {
        const value = e.target.value;
        setMagnetLink(value);
        if (value.startsWith('magnet:')) {
            extractInfoFromMagnet(value);
        }
    };
    const handleAddMagnet = async () => {
        if (!magnetLink.startsWith('magnet:')) {
            setMessage({ type: 'error', text: 'Link magnético inválido' });
            return;
        }
        setLoading(true);
        setMessage(null);
        try {
            const magnetData = {
                imdbId: imdbId || `manual-${Date.now()}`,
                title: title || 'Filme sem título',
                magnet: magnetLink,
                quality,
                seeds: 50, // Default
                category: category || 'movie',
                language
            };
            // Aqui você integra manualmente com sua API
            console.log('Dados para adicionar:', magnetData);
            setMessage({
                type: 'success',
                text: 'Magnet pronto para ser adicionado! Verifique o console.'
            });
            // Limpar formulário
            setMagnetLink('');
            setImdbId('');
            setTitle('');
            setQuality('1080p');
            setCategory('');
        }
        catch (error) {
            setMessage({
                type: 'error',
                text: 'Erro ao processar magnet'
            });
        }
        finally {
            setLoading(false);
        }
    };
    return (<material_1.Container maxWidth="md" sx={{ py: 4 }}>
      <material_1.Paper elevation={3} sx={{ p: 4 }}>
        <material_1.Box sx={{ textAlign: 'center', mb: 4 }}>
          <icons_material_1.Magnet sx={{ fontSize: 48, color: 'primary.main', mb: 2 }}/>
          <material_1.Typography variant="h4" component="h1" gutterBottom>
            Brasil RD - Adicionar Magnets
          </material_1.Typography>
          <material_1.Typography variant="body1" color="text.secondary">
            Adicione links magnéticos para serem processados pelo Real-Debrid
          </material_1.Typography>
        </material_1.Box>

        <material_1.Card>
          <material_1.CardContent>
            <material_1.Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <material_1.TextField label="Link Magnético" value={magnetLink} onChange={handleMagnetChange} placeholder="magnet:?xt=urn:btih:..." fullWidth required disabled={loading}/>

              <material_1.Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <material_1.TextField label="IMDB ID (opcional)" value={imdbId} onChange={(e) => setImdbId(e.target.value)} placeholder="tt1234567" disabled={loading} sx={{ flex: 1 }}/>
                
                <material_1.TextField label="Qualidade" value={quality} onChange={(e) => setQuality(e.target.value)} select SelectProps={{ native: true }} disabled={loading} sx={{ minWidth: 120 }}>
                  <option value="4K">4K</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="SD">SD</option>
                </material_1.TextField>

                <material_1.TextField label="Idioma" value={language} onChange={(e) => setLanguage(e.target.value)} select SelectProps={{ native: true }} disabled={loading} sx={{ minWidth: 120 }}>
                  <option value="pt-BR">Português BR</option>
                  <option value="pt">Português</option>
                  <option value="en">Inglês</option>
                </material_1.TextField>
              </material_1.Box>

              <material_1.TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome do filme/série" fullWidth disabled={loading}/>

              <material_1.TextField label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="filme, serie, etc" fullWidth disabled={loading}/>

              {loading && <material_1.LinearProgress />}

              {message && (<material_1.Alert severity={message.type} icon={message.type === 'success' ? <icons_material_1.CheckCircle /> : <icons_material_1.Error />}>
                  {message.text}
                </material_1.Alert>)}

              <material_1.Button variant="contained" onClick={handleAddMagnet} disabled={loading || !magnetLink} size="large" startIcon={<icons_material_1.Magnet />}>
                {loading ? 'Processando...' : 'Adicionar Magnet'}
              </material_1.Button>
            </material_1.Box>
          </material_1.CardContent>
        </material_1.Card>

        <material_1.Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
          <material_1.Typography variant="body2" color="text.secondary">
            <strong>Como usar:</strong> Cole o link magnético, preencha as informações e clique em adicionar. 
            O sistema irá verificar no Real-Debrid e adicionar ao JSON automaticamente.
          </material_1.Typography>
        </material_1.Box>
      </material_1.Paper>
    </material_1.Container>);
};
exports.Dashboard = Dashboard;
exports.default = exports.Dashboard;
//# sourceMappingURL=Dashboard.js.map