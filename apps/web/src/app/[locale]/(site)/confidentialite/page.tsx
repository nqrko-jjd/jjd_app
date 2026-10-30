import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

type Block = { title: string; paras: string[] };
type Copy = { metaTitle: string; metaDescription: string; h1: string; updated: string; intro: string; blocks: Block[] };

const FR: Copy = {
  metaTitle: 'Politique de confidentialité – JJD Chantier',
  metaDescription: 'Données personnelles traitées par l’application JJD Chantier et par jjd-consult.be : lesquelles, pourquoi, combien de temps, et vos droits.',
  h1: 'Politique de confidentialité',
  updated: 'Dernière mise à jour : 30 octobre 2026',
  intro: 'JJD Consult SRL (« JJD », « nous ») est responsable du traitement des données décrites ci-dessous, collectées par l’application mobile JJD Chantier et par le site jjd-consult.be.',
  blocks: [
    {
      title: 'À qui s’adresse l’application',
      paras: ['JJD Chantier est un outil de travail réservé aux membres de l’équipe JJD, aux sous-traitants et aux clients invités. Les comptes sont créés par JJD ; il n’est pas possible de s’inscrire soi-même.'],
    },
    {
      title: 'Données que nous traitons',
      paras: [
        'Compte : nom, adresse e-mail, rôle et identifiant de connexion.',
        'Pointage : heures de début et de fin de journée, chantier concerné et, au moment du pointage seulement, votre position, afin de vérifier que le pointage a bien été fait sur le chantier. L’application ne suit pas votre position en arrière-plan.',
        'Contenus que vous ajoutez : photos de chantier, justificatifs et notes de frais (photos de tickets), notes vocales, messages et rapports.',
        'Codes scannés : l’appareil photo sert à lire des codes (matériel, étiquettes). Les images de ces scans ne sont pas conservées.',
        'Notifications : un identifiant technique de votre téléphone, nécessaire pour vous envoyer des notifications sur les chantiers et les plannings.',
        'Données techniques : type d’appareil, version de l’application et journaux d’erreurs, pour assurer le fonctionnement et la sécurité du service.',
      ],
    },
    {
      title: 'Pourquoi nous les utilisons',
      paras: [
        'Pour gérer les chantiers, les équipes, le planning, les heures prestées, les achats et la facturation (exécution du contrat et obligations légales et comptables).',
        'Pour assurer la sécurité de l’application et prévenir les abus (intérêt légitime).',
        'Nous ne vendons pas vos données et ne les utilisons pas pour de la publicité ou du profilage commercial.',
      ],
    },
    {
      title: 'Autorisations demandées sur votre téléphone',
      paras: [
        'Appareil photo : photos de chantier, justificatifs, lecture de codes. Photos : ajouter une image existante. Micro : seulement quand vous enregistrez une note vocale. Position : seulement au pointage. Notifications : alertes de chantier.',
        'Vous pouvez retirer chaque autorisation à tout moment dans les réglages du téléphone ; certaines fonctions ne seront alors plus disponibles.',
      ],
    },
    {
      title: 'Partage et hébergement',
      paras: [
        'Les données sont stockées sur les serveurs de JJD Consult. Elles sont partagées uniquement avec les personnes qui ont besoin d’y accéder dans le cadre du chantier (équipe JJD, client concerné), et avec les prestataires techniques qui font fonctionner le service (hébergement, envoi des notifications), qui agissent pour notre compte.',
        'Nous pouvons aussi communiquer des données lorsque la loi l’exige.',
      ],
    },
    {
      title: 'Durée de conservation',
      paras: ['Les données de chantier, de temps et de facturation sont conservées le temps nécessaire à l’exécution des travaux, puis le temps imposé par les obligations légales et comptables. Les données d’un compte désactivé sont supprimées ou anonymisées lorsque plus aucune obligation ne s’y oppose.'],
    },
    {
      title: 'Vos droits',
      paras: [
        'Vous pouvez demander l’accès, la rectification, l’effacement, la limitation ou l’export de vos données, et vous opposer à certains traitements. Pour supprimer votre compte ou exercer un droit, écrivez à info@jjd-consult.be.',
        'Vous pouvez aussi introduire une réclamation auprès de l’Autorité de protection des données (autoriteprotectiondonnees.be).',
      ],
    },
    {
      title: 'Contact',
      paras: ['JJD Consult SRL – info@jjd-consult.be – +32 2 887 92 39.'],
    },
  ],
};

const EN: Copy = {
  metaTitle: 'Privacy policy – JJD Chantier',
  metaDescription: 'Personal data processed by the JJD Chantier app and jjd-consult.be: what, why, how long, and your rights.',
  h1: 'Privacy policy',
  updated: 'Last updated: 30 October 2026',
  intro: 'JJD Consult SRL (“JJD”, “we”) is the controller of the data described below, collected by the JJD Chantier mobile app and the jjd-consult.be website.',
  blocks: [
    {
      title: 'Who the app is for',
      paras: ['JJD Chantier is a work tool for JJD team members, subcontractors and invited clients. Accounts are created by JJD; self-registration is not possible.'],
    },
    {
      title: 'Data we process',
      paras: [
        'Account: name, email address, role and login identifier.',
        'Time tracking: start and end times, the worksite concerned and, only at the moment you clock in, your location, to check that you clocked in on site. The app does not track your location in the background.',
        'Content you add: worksite photos, receipts and expense photos, voice notes, messages and reports.',
        'Scanned codes: the camera reads codes (equipment, labels). Images of these scans are not kept.',
        'Notifications: a technical identifier of your phone, needed to send worksite and planning notifications.',
        'Technical data: device type, app version and error logs, to keep the service running and secure.',
      ],
    },
    {
      title: 'Why we use it',
      paras: [
        'To manage worksites, teams, planning, hours, purchases and invoicing (performance of the contract and legal and accounting obligations).',
        'To keep the app secure and prevent abuse (legitimate interest).',
        'We do not sell your data and do not use it for advertising or commercial profiling.',
      ],
    },
    {
      title: 'Permissions requested on your phone',
      paras: [
        'Camera: worksite photos, receipts, code scanning. Photos: add an existing image. Microphone: only when you record a voice note. Location: only when clocking in. Notifications: worksite alerts.',
        'You can withdraw each permission at any time in your phone settings; some features will then be unavailable.',
      ],
    },
    {
      title: 'Sharing and hosting',
      paras: [
        'Data is stored on JJD Consult servers. It is shared only with people who need it for the worksite (JJD team, the client concerned) and with technical providers that run the service (hosting, notification delivery) acting on our behalf.',
        'We may also disclose data where the law requires it.',
      ],
    },
    {
      title: 'Retention',
      paras: ['Worksite, time and invoicing data is kept for as long as needed to carry out the work, then for the period required by legal and accounting obligations. Data of a deactivated account is deleted or anonymised once no obligation prevents it.'],
    },
    {
      title: 'Your rights',
      paras: [
        'You may request access, rectification, erasure, restriction or export of your data, and object to certain processing. To delete your account or exercise a right, write to info@jjd-consult.be.',
        'You may also lodge a complaint with the Belgian Data Protection Authority (autoriteprotectiondonnees.be).',
      ],
    },
    {
      title: 'Contact',
      paras: ['JJD Consult SRL – info@jjd-consult.be – +32 2 887 92 39.'],
    },
  ],
};

// Le néerlandais reprend le texte français tant qu’il n’est pas traduit.
const copyFor = (locale: string): Copy => (locale === 'en' ? EN : FR);

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const c = copyFor(locale);
  return { title: c.metaTitle, description: c.metaDescription };
}

export default async function ConfidentialitePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = copyFor(locale);

  return (
    <section className="s-section">
      <div className="s-wrap" style={{ maxWidth: '46rem' }}>
        <h1 style={{ margin: '0 0 0.6rem' }}>{c.h1}</h1>
        <p style={{ color: 'var(--s-ink-soft)', margin: '0 0 1.6rem' }}>{c.updated}</p>
        <p className="s-lead" style={{ marginBottom: '2rem' }}>{c.intro}</p>
        <div style={{ display: 'grid', gap: '1.8rem' }}>
          {c.blocks.map((b) => (
            <div key={b.title}>
              <h2 style={{ fontSize: '1.25rem', margin: '0 0 0.6rem' }}>{b.title}</h2>
              <div style={{ display: 'grid', gap: '0.7rem', color: 'var(--s-ink-soft)' }}>
                {b.paras.map((p) => <p key={p}>{p}</p>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
