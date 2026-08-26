/**
 * Exportador principal do sistema de filtro de títulos
 */

// Exportar interfaces
export * from './interfaces.js';

// Exportar classes utilitárias
export { TitleCleaner } from './TitleCleaner.js';
export { LanguageDetector } from './LanguageDetector.js';
export { SimilarityCalculator } from './SimilarityCalculator.js';
export { CacheManager } from './CacheManager.js';

// NOTA: O TitleFilter principal está em ../titleFilter.ts
// Não exportamos aqui porque não é um módulo desta pasta