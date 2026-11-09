import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // os testes de partidas inteiras (Magnata, truco, naval, Mistério, sinuca) levam 1 a 2 s sozinhos;
    // com tudo rodando em paralelo passavam dos 5 s padrão de vez em quando
    testTimeout: 20_000
  }
})
