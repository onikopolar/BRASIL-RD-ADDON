export class QualityDetector {
  private static instance: QualityDetector;

  public static getInstance(): QualityDetector {
    if (!QualityDetector.instance) {
      QualityDetector.instance = new QualityDetector();
    }
    return QualityDetector.instance;
  }

  private readonly qualityPatterns = [
    // 2160p / 4K
    { pattern: /\.2160p\./i, quality: '2160p', confidence: 100 },
    { pattern: /\.4k\./i, quality: '2160p', confidence: 100 },
    { pattern: /\b2160p\b/i, quality: '2160p', confidence: 98 },
    { pattern: /\b4k\b/i, quality: '2160p', confidence: 98 },
    { pattern: /2160p/i, quality: '2160p', confidence: 95 },
    { pattern: /4k/i, quality: '2160p', confidence: 95 },
    { pattern: /\buhd\b/i, quality: '2160p', confidence: 90 },
    { pattern: /\bultra.hd\b/i, quality: '2160p', confidence: 90 },
    
    // 1080p
    { pattern: /\.1080p\./i, quality: '1080p', confidence: 100 },
    { pattern: /\b1080p\b/i, quality: '1080p', confidence: 98 },
    { pattern: /1080p/i, quality: '1080p', confidence: 95 },
    { pattern: /\bfhd\b/i, quality: '1080p', confidence: 90 },
    { pattern: /\bfull.hd\b/i, quality: '1080p', confidence: 90 },
    
    // 720p
    { pattern: /\.720p\./i, quality: '720p', confidence: 100 },
    { pattern: /\b720p\b/i, quality: '720p', confidence: 98 },
    { pattern: /720p/i, quality: '720p', confidence: 95 },
    { pattern: /\bhd.rip\b/i, quality: '720p', confidence: 85 },
    
    // HD genérico
    { pattern: /\.hd\./i, quality: 'HD', confidence: 90 },
    { pattern: /\bhd\b/i, quality: 'HD', confidence: 80 },
    { pattern: /\bhigh.def\b/i, quality: 'HD', confidence: 80 },

    // Tipos de fonte que indicam qualidade
    { pattern: /\.web-dl\./i, quality: '1080p', confidence: 95 },
    { pattern: /\.bluray\./i, quality: '1080p', confidence: 90 },
    { pattern: /\.blu-ray\./i, quality: '1080p', confidence: 90 },
    { pattern: /\.remux\./i, quality: '2160p', confidence: 95 },
    { pattern: /\.webrip\./i, quality: '1080p', confidence: 85 },
    { pattern: /\.hdtv\./i, quality: '720p', confidence: 80 },
    { pattern: /\.brrip\./i, quality: '1080p', confidence: 85 },
    { pattern: /\.bdrip\./i, quality: '1080p', confidence: 85 }
  ];

  private readonly allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
  private readonly qualityOrder = ['2160p', '1080p', '720p', 'HD'];

  /**
   * Extrai TODAS as qualidades presentes em um título
   * Retorna array de qualidades únicas
   */
  extractAllQualities(title: string): string[] {
    const cleanTitle = title.toLowerCase();
    const foundQualities = new Set<string>();
    
    // Percorrer todos os padrões
    for (const { pattern, quality, confidence } of this.qualityPatterns) {
      if (pattern.test(cleanTitle) && confidence >= 80) {
        foundQualities.add(quality);
      }
    }
    
    // Se não encontrou qualidades específicas, tentar inferir
    if (foundQualities.size === 0) {
      const inferred = this.inferQualityFromContext(cleanTitle);
      foundQualities.add(inferred);
    }
    
    // Ordenar da melhor para pior qualidade
    return Array.from(foundQualities)
      .filter(quality => this.allowedQualities.has(quality))
      .sort((a, b) => {
        const indexA = this.qualityOrder.indexOf(a);
        const indexB = this.qualityOrder.indexOf(b);
        return indexA - indexB; // Menor índice = melhor qualidade
      });
  }

  /**
   * Extrai a MELHOR qualidade de um título
   */
  extractBestQuality(title: string): string {
    const allQualities = this.extractAllQualities(title);
    
    if (allQualities.length > 0) {
      return allQualities[0]; // Primeiro é o melhor (já ordenado)
    }
    
    return this.inferQualityFromContext(title.toLowerCase());
  }

  /**
   * Extrai a PIOR qualidade de um título (útil para range mínimo)
   */
  extractWorstQuality(title: string): string {
    const allQualities = this.extractAllQualities(title);
    
    if (allQualities.length > 0) {
      return allQualities[allQualities.length - 1]; // Último é o pior
    }
    
    return 'HD';
  }

  /**
   * Verifica se um título tem múltiplas qualidades
   */
  hasMultipleQualities(title: string): boolean {
    const qualities = this.extractAllQualities(title);
    return qualities.length > 1;
  }

  /**
   * Cria qualidades baseadas em um range (ex: 720p/1080p/4K)
   */
  expandQualityRange(title: string): string[] {
    const cleanTitle = title.toLowerCase();
    const qualities = new Set<string>();
    
    // Verificar padrões de range como "720p/1080p/4K" ou "720p|1080p|4K"
    const rangePatterns = [
      /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*\|\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*&\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*\+\s*(\d{3,4}p)/gi
    ];
    
    for (const pattern of rangePatterns) {
      const matches = cleanTitle.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Extrair números individuais
          const numberMatches = match.match(/\d{3,4}p/gi);
          if (numberMatches) {
            numberMatches.forEach(num => {
              if (num.includes('2160') || num.includes('4k')) {
                qualities.add('2160p');
              } else if (num.includes('1080')) {
                qualities.add('1080p');
              } else if (num.includes('720')) {
                qualities.add('720p');
              }
            });
          }
        });
      }
    }
    
    // Se encontrou qualidades no range, retornar
    if (qualities.size > 0) {
      return Array.from(qualities).sort((a, b) => 
        this.qualityOrder.indexOf(a) - this.qualityOrder.indexOf(b)
      );
    }
    
    // Se não, usar o método normal
    return this.extractAllQualities(title);
  }

  /**
   * Método legado para compatibilidade (extrai apenas uma qualidade)
   */
  extractQuality(title: string): string {
    return this.extractBestQuality(title);
  }

  private inferQualityFromContext(titleLower: string): string {
    if (titleLower.includes('remux') || titleLower.includes('web-dl')) {
      return '1080p';
    }
    
    if (titleLower.includes('bluray') || titleLower.includes('blu-ray')) {
      return '1080p';
    }
    
    if (titleLower.includes('hdtv')) {
      return '720p';
    }
    
    return 'HD';
  }

  extractQualityFromFilename(filename: string): string {
    return this.extractBestQuality(filename);
  }

  extractQualityFromStreamName(name: string | undefined): string {
    if (!name) return 'HD';
    return this.extractBestQuality(name);
  }

  isValidQuality(quality: string): boolean {
    return this.allowedQualities.has(quality);
  }

  /**
   * Verifica se uma qualidade está presente no título
   */
  hasQuality(title: string, quality: string): boolean {
    const qualities = this.extractAllQualities(title);
    return qualities.includes(quality);
  }

  /**
   * Obtém a ordem de uma qualidade (0 = melhor, 3 = pior)
   */
  getQualityOrder(quality: string): number {
    const index = this.qualityOrder.indexOf(quality);
    return index !== -1 ? index : this.qualityOrder.length;
  }
}