/**
 * Exportador principal do sistema de filtro de títulos
 */

// Exportar interfaces
export * from './interfaces';

// Exportar classes utilitárias
export { TitleCleaner } from './TitleCleaner';
export { LanguageDetector } from './LanguageDetector';
export { SimilarityCalculator } from './SimilarityCalculator';
export { MetadataExtractor } from './MetadataExtractor';
export { CacheManager } from './CacheManager';

// NOTA: O TitleFilter principal está em ../titleFilter.ts
// Não exportamos aqui porque não é um módulo desta pasta