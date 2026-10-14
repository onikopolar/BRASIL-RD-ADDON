export class QualityDetector {
  private static instance: QualityDetector;

  public static getInstance(): QualityDetector {
    if (!QualityDetector.instance) QualityDetector.instance = new QualityDetector();
    return QualityDetector.instance;
  }

  private readonly explicitResolutionPatterns = [
    { pattern: /\b(2160p|4k|uhd)\b/i, quality: '2160p' },
    { pattern: /\b(1080p|fhd|full hd)\b/i, quality: '1080p' },
    { pattern: /\b(720p)\b/i, quality: '720p' },
    { pattern: /\b(480p|sd)\b/i, quality: 'SD' }
  ];

  private readonly allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
  private readonly qualityOrder = ['2160p', '1080p', '720p', 'HD'];

  // Sempre respeita a resolução que veio explícita no texto. Sem resolução, devolve HD — nunca inventa qualidade a partir do formato da fonte.
  extractAllQualities(title: string): string[] {
    if (!title) return ['HD'];
    const cleanTitle = title.toLowerCase();
    const foundQualities = new Set<string>();

    for (const { pattern, quality } of this.explicitResolutionPatterns) {
      if (pattern.test(cleanTitle)) {
        foundQualities.add(quality);
      }
    }

    if (foundQualities.size === 0) {
      return ['HD'];
    }

    return Array.from(foundQualities)
      .filter(q => this.allowedQualities.has(q))
      .sort((a, b) => this.qualityOrder.indexOf(a) - this.qualityOrder.indexOf(b));
  }

  extractBestQuality(title: string): string {
    const allQualities = this.extractAllQualities(title);
    return allQualities.length > 0 ? allQualities[0] : 'HD';
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
    if (!title) return ['HD'];
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

  // Retorna null quando não há resolução explícita — quem precisa saber se existe qualidade real usa esse.
  extractQualityOrNull(text: string): string | null {
    if (!text) return null;
    const q = this.extractBestQuality(text);
    return q === 'HD' ? null : q;
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
}