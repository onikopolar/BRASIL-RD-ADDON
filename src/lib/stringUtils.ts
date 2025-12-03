export function normalizeTitleForComparison(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calculateLevenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }

  return matrix[str2.length][str1.length];
}

export function calculateStringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) {
    return 1.0;
  }
  
  const distance = calculateLevenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

export function extractCleanMovieTitle(fullTitle: string): string {
  const cleanTitle = fullTitle
    .replace(/(1080p|720p|4K|2160p|HD|WEB-DL|WEBRip|BluRay|H264|H265|x264|x265|AC3|DTS|DUAL|Dublado|Legendado)/gi, '')
    .replace(/[.\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\([^)]*\)/g, '')
    .trim();
  
  return cleanTitle || fullTitle;
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 255);
}