import { DICT } from './ui-dict';
import { TPL } from './ui-dict-tpl';

export const UI_LANGUAGES = [{ code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }, { code: 'pt-BR', label: 'Português (Brasil)' }] as const;
export type UiLocale = typeof UI_LANGUAGES[number]['code'];
export const isUiLocale = (v: unknown): v is UiLocale => UI_LANGUAGES.some(l => l.code === v);
let current: UiLocale = 'fr';
export const setUiLocale = (locale: UiLocale) => { current = locale; };
export const dateLocale = () => current === 'en' ? 'en-GB' : current === 'pt-BR' ? 'pt-BR' : 'fr-BE';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(TPL).map(([key, values]) => ({
  re: new RegExp('^' + key.split(/(\{\d+\})/).map(p => /^\{\d+\}$/.test(p) ? '([\\s\\S]*?)' : esc(p)).join('') + '$'),
  slots: [...key.matchAll(/\{(\d+)\}/g)].map(m => Number(m[1])), values,
}));
const extra: Record<string, [string, string]> = {
  'Prénom': ['First name', 'Nome'],
  'Enregistrez vos informations avant de changer de langue.': ['Save your information before changing language.', 'Salve suas informações antes de mudar o idioma.'],
  'Nom': ['Last name', 'Sobrenome'],
  'Téléphone': ['Phone', 'Telefone'],
  'en cours': ['in progress', 'em andamento'],
  'à valider': ['awaiting approval', 'aguardando aprovação'],
  'validé': ['approved', 'aprovado'],
  'refusé': ['rejected', 'recusado'],
  'Outils': ['Tools', 'Ferramentas'],
  'Messages': ['Messages', 'Mensagens'],
  'Plus': ['More', 'Mais'],
  'Aucun chantier ne correspond': ['No matching job sites', 'Nenhuma obra corresponde'],
  'Aucun chantier pour l’instant': ['No job sites yet', 'Nenhuma obra no momento'],
  'Les chantiers qui vous sont assignés apparaissent ici. Contactez le bureau s’il en manque.': ['Your assigned job sites appear here. Contact the office if any are missing.', 'Suas obras atribuídas aparecem aqui. Entre em contato com o escritório se alguma estiver faltando.'],
  'Sur chantier': ['On site', 'Na obra'],
  'Je quitte le chantier': ['I am leaving the site', 'Estou saindo da obra'],
  'Mes heures →': ['My hours →', 'Minhas horas →'],
  'Prêt pour le chantier': ['Ready for the site', 'Pronto para a obra'],
  'Mon pointage': ['My time entry', 'Meu registro de ponto'],
  'Je suis arrivé sur chantier': ['I have arrived on site', 'Cheguei à obra'],
  'Je suis arrivé': ['I have arrived', 'Cheguei'],
  'Pointe à ton arrivée sur le chantier, puis à ton départ.': ['Clock in when you arrive on site and clock out when you leave.', 'Registre o ponto ao chegar à obra e ao sair.'],
  'Aucun chantier prévu aujourd’hui. Retrouve tes affectations dans Mes chantiers.': ['No site scheduled today. Find your assignments in My sites.', 'Nenhuma obra prevista para hoje. Veja suas atribuições em Minhas obras.'],
  'Pas de chantier prévu aujourd’hui': ['No site scheduled today', 'Nenhuma obra prevista para hoje'],
  'Si ton affectation a changé, vérifie tes chantiers ou contacte le bureau.': ['If your assignment has changed, check your sites or contact the office.', 'Se sua atribuição mudou, confira suas obras ou entre em contato com o escritório.'],
  'Voir mes chantiers': ['View my sites', 'Ver minhas obras'],
  'Fiche du jour ›': ['Daily site sheet ›', 'Ficha do dia ›'],
  'Faire mon rapport': ['Write my report', 'Fazer meu relatório'],
  'Travaux, photos et remarques': ['Work, photos and comments', 'Trabalhos, fotos e observações'],
  'Contacter l’équipe': ['Contact the team', 'Contatar a equipe'],
  'Échanger sur ce chantier': ['Discuss this site', 'Conversar sobre esta obra'],
  'Mes tâches du jour': ['My tasks today', 'Minhas tarefas de hoje'],
  'Aucun pointage sur ce mois.': ['No time entries this month.', 'Nenhum registro de ponto neste mês.'],
  'En attente du bureau': ['Awaiting the office', 'Aguardando o escritório'],
  'Avant retenues': ['Before deductions', 'Antes das deduções'],
  'Terrain': ['Field work', 'Trabalho em campo'],
  'Votre activité': ['Your activity', 'Sua atividade'],
  'Commercial & finances': ['Sales & finances', 'Comercial e finanças'],
  'Répertoires': ['Directories', 'Cadastros'],
  'Administration': ['Administration', 'Administração'],
  'Mon profil': ['My profile', 'Meu perfil'],
  'Mes informations': ['My information', 'Minhas informações'],
  'Langue de l’application': ['Application language', 'Idioma do aplicativo'],
  'Cette langue est enregistrée dans votre compte et utilisée sur le site et dans l’application mobile.': ['This language is saved in your account and used on the website and in the mobile app.', 'Este idioma é salvo na sua conta e usado no site e no aplicativo móvel.'],
  'Informations enregistrées.': ['Information saved.', 'Informações salvas.'],
  'Impossible d’enregistrer les modifications. Réessayez.': ['Unable to save changes. Please try again.', 'Não foi possível salvar as alterações. Tente novamente.'],
  'Identifiant de connexion': ['Login ID', 'Identificador de acesso'],
  'E-mail de contact': ['Contact email', 'E-mail de contato'],
  'Mon espace ouvrier': ['My worker area', 'Minha área de trabalho'],
  'Chantiers où tu es affecté ou as pointé': ['Sites you are assigned to or have clocked in at', 'Obras às quais você foi atribuído ou onde registrou ponto'],
  'Historique de pointage': ['Time entry history', 'Histórico de registros de ponto'],
};
export function translateUi(s: string, locale: UiLocale): string {
  if (locale === 'fr' || !s) return s;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  if (!match || !match[2]) return s;
  const text = match[2], index = locale === 'en' ? 0 : 1;
  const hit = extra[text] ?? DICT[text] ?? DICT[text.replace(/\s+/g, ' ')];
  if (hit) return match[1] + hit[index] + match[3];
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const slots: Record<number, string> = {};
    p.slots.forEach((n, i) => { slots[n] = m[i + 1] ?? ''; });
    // Dynamic names, references and business data keep their original value.
    return match[1] + p.values[index].replace(/\{(\d+)(?::([^|}]*)\|([^}]*))?\}/g, (_v, n, a, b) => a !== undefined ? (slots[Number(n)] ? b : a) : slots[Number(n)] ?? '') + match[3];
  }
  return s;
}
export const tr = (s: string) => translateUi(s, current);
