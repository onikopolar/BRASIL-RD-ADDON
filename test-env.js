console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Todas variáveis:', Object.keys(process.env).filter(key => key.includes('NODE')));
