export class QualityDetector {
  private static instance: QualityDetector;

  public static getInstance(): QualityDetector {
    if (!QualityDetector.instance) {
      QualityDetector.instance = new QualityDetector();
    }
    return QualityDetector.instance;
  }

  private readonly explicitResolutionPatterns = [
    { pattern: /\b(2160p|4k|uhd)\b/i, quality: '2160p', confidence: 100 },
    { pattern: /\b(1080p|fhd|full hd)\b/i, quality: '1080p', confidence: 100 },
    { pattern: /\b(720p|hd)\b/i, quality: '720p', confidence: 100 },
    { pattern: /\b(480p|sd)\b/i, quality: 'SD', confidence: 100 }
  ];

  private readonly sourcePatterns = [
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

  extractAllQualities(title: string): string[] {
    const cleanTitle = title.toLowerCase();
    const foundQualities = new Set<string>();

    // 1. Prioriza resoluções explícitas
    for (const { pattern, quality } of this.explicitResolutionPatterns) {
      if (pattern.test(cleanTitle)) {
        foundQualities.add(quality);
      }
    }

    // 2. Se encontrou pelo menos uma resolução explícita, retorna apenas essas
    if (foundQualities.size > 0) {
      return Array.from(foundQualities)
        .filter(q => this.allowedQualities.has(q))
        .sort((a, b) => this.qualityOrder.indexOf(a) - this.qualityOrder.indexOf(b));
    }

    // 3. Caso contrário, usa padrões de fonte como fallback
    for (const { pattern, quality } of this.sourcePatterns) {
      if (pattern.test(cleanTitle) && this.allowedQualities.has(quality)) {
        foundQualities.add(quality);
      }
    }

    // 4. Se ainda não encontrou, infere do contexto
    if (foundQualities.size === 0) {
      foundQualities.add(this.inferQualityFromContext(cleanTitle));
    }

    return Array.from(foundQualities)
      .filter(q => this.allowedQualities.has(q))
      .sort((a, b) => this.qualityOrder.indexOf(a) - this.qualityOrder.indexOf(b));
  }

  extractBestQuality(title: string): string {
    const allQualities = this.extractAllQualities(title);
    return allQualities.length > 0 ? allQualities[0] : this.inferQualityFromContext(title.toLowerCase());
  }

  extractWorstQuality(title: string): string {
    const allQualities = this.extractAllQualities(title);
    return allQualities.length > 0 ? allQualities[allQualities.length - 1] : 'HD';
  }

  hasMultipleQualities(title: string): boolean {
    const qualities = this.extractAllQualities(title);
    return qualities.length > 1;
  }

  expandQualityRange(title: string): string[] {
    const cleanTitle = title.toLowerCase();
    const qualities = new Set<string>();

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

    if (qualities.size > 0) {
      return Array.from(qualities).sort((a, b) =>
        this.qualityOrder.indexOf(a) - this.qualityOrder.indexOf(b)
      );
    }

    return this.extractAllQualities(title);
  }

  extractQuality(title: string): string {
    return this.extractBestQuality(title);
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

  hasQuality(title: string, quality: string): boolean {
    const qualities = this.extractAllQualities(title);
    return qualities.includes(quality);
  }

  getQualityOrder(quality: string): number {
    const index = this.qualityOrder.indexOf(quality);
    return index !== -1 ? index : this.qualityOrder.length;
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
}
