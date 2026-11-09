/** Lógica pura do tour (sem DOM nem driver.js): testável em Node. */

/** Sobe quando o tour mudar de forma relevante; quem viu uma versão menor vê de novo. */
export const TOUR_VERSION = 1

/** `seen` é a versão do tour já vista (0 = nunca). */
export const shouldShowTour = (seen: number | undefined, version: number = TOUR_VERSION): boolean =>
  !(typeof seen === 'number' && seen >= version)

export type TourAnswer = 'ask' | 'yes' | 'no'

/**
 * Pergunta da primeira visita: só se nunca respondeu e nenhum tour foi visto
 * (quem já viu um tour numa versão anterior do app não é perguntado de novo).
 */
export const shouldAskTour = (answer: TourAnswer | undefined, roomSeen: number | undefined, homeSeen: number | undefined): boolean =>
  (answer ?? 'ask') === 'ask' && !roomSeen && !homeSeen

/** Tour automático: só para quem respondeu sim e ainda não viu esta versão. */
export const shouldAutoTour = (answer: TourAnswer | undefined, seen: number | undefined, version: number = TOUR_VERSION): boolean =>
  answer === 'yes' && shouldShowTour(seen, version)

export interface TourStep {
  id: string
  /** seletor CSS do elemento; sem seletor = popover centralizado */
  selector?: string
  title: string
  text: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** mostra o Jan pequeno no popover */
  jan?: boolean
}

/** Tira os passos cujo elemento não existe (ex.: dropdown de áudio com 1 dispositivo). */
export function filterSteps<T extends { selector?: string }>(steps: T[], exists: (selector: string) => boolean): T[] {
  return steps.filter((s) => !s.selector || exists(s.selector))
}

const t = (name: string) => `[data-tour="${name}"]`

export const ROOM_STEPS: TourStep[] = [
  { id: 'welcome', title: 'Bem-vindo à sala', text: 'Um minuto para mostrar onde fica cada coisa.', jan: true },
  { id: 'link', selector: t('copy-link'), side: 'right', title: 'Convide os amigos', text: 'Copie o link da sala. Quem abrir entra direto pelo navegador.' },
  { id: 'people', selector: t('people'), side: 'right', title: 'Quem está na sala', text: 'Aqui aparecem todos. Quem está falando acende, e cada voz tem o seu volume.' },
  {
    id: 'share',
    selector: t('share'),
    side: 'top',
    title: 'Compartilhar tela',
    text: 'Para mandar o som, escolha a tela inteira e marque "Compartilhar áudio do sistema".'
  },
  {
    id: 'quality',
    selector: t('quality'),
    side: 'top',
    title: 'Qualidade',
    text: 'Cada opção mostra quanta internet gasta. Texto e código pedem pouca; jogo e vídeo pedem mais.'
  },
  { id: 'mic', selector: t('mic'), side: 'top', title: 'Microfone', text: 'Ele começa desligado. Ligue aqui ou aperte M.' },
  {
    id: 'camera',
    selector: t('camera'),
    side: 'top',
    title: 'Câmera',
    text: 'Liga a sua webcam para a sala. Ela aparece junto das telas e também no canto dos jogos. Atalho: C.'
  },
  {
    id: 'stage',
    selector: t('stage'),
    side: 'top',
    title: 'O palco',
    text: 'Cada tela compartilhada aparece aqui. Duplo clique ou F abre em tela cheia.'
  },
  {
    id: 'control',
    selector: t('control'),
    side: 'right',
    title: 'Controle remoto',
    text: 'Dá para controlar o PC de um amigo. Passe o mouse na tela dele e clique no ícone de mouse. Ele precisa permitir e ter o JanJa Helper aberto (só quem é controlado precisa). Esc duas vezes solta; Ctrl+Alt+Shift+P corta na hora, do lado dele.'
  },
  {
    id: 'sounds',
    selector: t('sounds'),
    side: 'top',
    title: 'Sons de aviso',
    text: 'Campainha quando alguém pede para entrar, toc-toc quando pedem o controle do seu PC e um aviso quando alguém começa a compartilhar.'
  },
  {
    id: 'games',
    selector: t('games'),
    side: 'top',
    title: 'Jogos',
    text: 'Joguem poker, truco, sinuca, Stop, batalha naval, Mistério, mini-golfe, xadrez, damas ou Magnata sem sair da chamada. Abra um jogo e os amigos recebem o convite.'
  },
  { id: 'done', title: 'Pronto', text: 'Dá para rever este tour no botão ? da barra lateral.' }
]

export const HOME_STEPS: TourStep[] = [
  { id: 'name', selector: t('home-name'), side: 'right', title: 'Seu apelido', text: 'É assim que os amigos vão te ver. Fica salvo neste navegador.' },
  {
    id: 'actions',
    selector: t('home-actions'),
    side: 'right',
    title: 'Criar ou entrar',
    text: 'Crie uma sala e mande o link, ou cole aqui o link ou o código que você recebeu.'
  },
  { id: 'recents', selector: t('home-recents'), side: 'right', title: 'Salas recentes', text: 'Suas últimas salas ficam aqui. Clique para voltar a uma delas.' }
]
