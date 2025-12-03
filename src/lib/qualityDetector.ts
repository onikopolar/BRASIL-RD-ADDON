export class QualityDetector {
  private readonly qualityPatterns = [
    { pattern: /\.2160p\./i, quality: '2160p', confidence: 100 },
    { pattern: /\.4k\./i, quality: '2160p', confidence: 100 },
    { pattern: /\b2160p\b/i, quality: '2160p', confidence: 98 },
    { pattern: /\b4k\b/i, quality: '2160p', confidence: 98 },
    { pattern: /2160p/i, quality: '2160p', confidence: 95 },
    { pattern: /4k/i, quality: '2160p', confidence: 95 },
    { pattern: /\buhd\b/i, quality: '2160p', confidence: 90 },
    { pattern: /\bultra.hd\b/i, quality: '2160p', confidence: 90 },
    
    { pattern: /\.1080p\./i, quality: '1080p', confidence: 100 },
    { pattern: /\b1080p\b/i, quality: '1080p', confidence: 98 },
    { pattern: /1080p/i, quality: '1080p', confidence: 95 },
    { pattern: /\bfhd\b/i, quality: '1080p', confidence: 90 },
    { pattern: /\bfull.hd\b/i, quality: '1080p', confidence: 90 },
    
    { pattern: /\.720p\./i, quality: '720p', confidence: 100 },
    { pattern: /\b720p\b/i, quality: '720p', confidence: 98 },
    { pattern: /720p/i, quality: '720p', confidence: 95 },
    { pattern: /\bhd.rip\b/i, quality: '720p', confidence: 85 },
    
    { pattern: /\.hd\./i, quality: 'HD', confidence: 90 },
    { pattern: /\bhd\b/i, quality: 'HD', confidence: 80 },
    { pattern: /\bhigh.def\b/i, quality: 'HD', confidence: 80 },

    { pattern: /\.web-dl\./i, quality: '1080p', confidence: 95 },
    { pattern: /\.bluray\./i, quality: '1080p', confidence: 90 },
    { pattern: /\.blu-ray\./i, quality: '1080p', confidence: 90 },
    { pattern: /\.remux\./i, quality: '2160p', confidence: 95 },
    { pattern: /\.webrip\./i, quality: '1080p', confidence: 85 },
    { pattern: /\.hdtv\./i, quality: '720p', confidence: 80 },
    { pattern: /\.brrip\./i, quality: '1080p', confidence: 85 },
    { pattern: /\.bdrip\./i, quality: '1080p', confidence: 85 }
  ];

  private readonly exactPatterns = [
    { pattern: /\b2160p\b/i, quality: '2160p' },
    { pattern: /\b4k\b/i, quality: '2160p' },
    { pattern: /\b1080p\b/i, quality: '1080p' },
    { pattern: /\b720p\b/i, quality: '720p' },
    { pattern: /\bhd\b/i, quality: 'HD' }
  ];

  private readonly allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);

  extractQuality(title: string): string {
    const cleanTitle = title.toLowerCase();
    
    for (const { pattern, quality, confidence } of this.qualityPatterns) {
      if (pattern.test(cleanTitle) && confidence >= 95) {
        return quality;
      }
    }

    for (const { pattern, quality } of this.exactPatterns) {
      if (pattern.test(cleanTitle)) {
        return quality;
      }
    }

    for (const { pattern, quality, confidence } of this.qualityPatterns) {
      if (pattern.test(cleanTitle) && confidence >= 80) {
        return quality;
      }
    }

    return this.inferQualityFromContext(cleanTitle);
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
    return this.extractQuality(filename);
  }

  extractQualityFromStreamName(name: string | undefined): string {
    if (!name) return 'HD';
    return this.extractQuality(name);
  }

  isValidQuality(quality: string): boolean {
    return this.allowedQualities.has(quality);
  }
}
