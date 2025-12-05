// railway-start.js

// Debug: mostrar ambiente atual
console.log('=== RAILWAY START SCRIPT ===');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set (default: development)');
console.log('DATABASE_URL configured:', !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
  const masked = process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@');
  console.log('Database:', masked.includes('railway') ? 'Railway' : 'Local');
}

// Determinar ambiente baseado em múltiplos fatores
const isProduction = 
  process.env.NODE_ENV === 'production' || 
  process.env.RAILWAY_ENVIRONMENT === 'production' ||
  (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway'));

console.log('Environment detected:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT');

// Executar migrações apenas em produção com banco Railway
if (isProduction && process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')) {
  console.log('=== DATABASE MIGRATION START ===');
  try {
    // Forçar ambiente de produção para a migração
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    require('./scripts/migrate-database.js');
    
    // Restaurar original se existia
    if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
    
    console.log('=== DATABASE MIGRATION COMPLETE ===');
  } catch (error) {
    console.error('MIGRATION ERROR:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
} else {
  console.log('Skipping automatic migrations - not in Railway production');
}

// Iniciar servidor
console.log('=== STARTING SERVER ===');
try {
  require('./dist/server.js');
} catch (error) {
  console.error('SERVER START ERROR:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}