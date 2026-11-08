/**
 * Campos de texto livres (chat, nomes, código da sala) não são formulário de cadastro nem de pagamento.
 * Sem isto o Chrome às vezes oferece o Google Pay ou um cartão salvo nesses campos, e gerenciadores de
 * senha mostram o ícone deles. `autocomplete="off"` sozinho não basta em todo navegador, então:
 * - `name` neutro, que não lembra nenhum campo de cadastro (as heurísticas também leem o `name`);
 * - os atributos que 1Password, LastPass e Dashlane respeitam.
 * Use espalhando nos <input> de texto: `<input {...noAutofill('chat')} />` e `autoComplete="off"` no <form>.
 */
export function noAutofill(field: string): {
  name: string
  autoComplete: 'off'
  'data-1p-ignore': 'true'
  'data-lpignore': 'true'
  'data-form-type': 'other'
} {
  return { name: `janja-${field}`, autoComplete: 'off', 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-form-type': 'other' }
}
