import { Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from './lib/http.js';
import { scopeStore } from './lib/entity-scope.js';

const base = new PrismaClient();

/**
 * Cloisonnement par entité (voir lib/entity-scope.ts) : quand la requête en cours vient d'un utilisateur limité à une entité, toute lecture ou
 * écriture sur un modèle rattaché à un chantier est restreinte aux chantiers de cette entité — automatiquement, pour TOUTES les routes.
 * Sans cloisonnement (cas général), l'extension ne fait rien.
 */
const MODELS = Prisma.dmmf.datamodel.models;
const DIRECT = new Set(MODELS.filter((m) => m.fields.some((f) => f.name === 'worksite' && f.type === 'Worksite')).map((m) => m.name));
const VIA_THREAD = new Set(MODELS.filter((m) => m.fields.some((f) => f.name === 'thread' && f.type === 'Thread') && m.name !== 'Worksite').map((m) => m.name));
const BY_ID = new Set(['ScopeDoc', 'PurchaseList']); // worksiteId sans relation déclarée
const delegateOf = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);
const notFound = (model: string) => new Prisma.PrismaClientKnownRequestError(`${model} introuvable`, { code: 'P2025', clientVersion: Prisma.prismaVersion.client });
const and = (where: unknown, extra: unknown) => (where ? { AND: [where, extra] } : extra);

async function filterFor(model: string, entity: string): Promise<unknown | null> {
  if (model === 'Worksite') return { entity };
  if (DIRECT.has(model)) return { worksite: { entity } };
  if (VIA_THREAD.has(model)) return { thread: { worksite: { entity } } };
  if (BY_ID.has(model)) {
    const store = scopeStore.getStore();
    if (store && !store.worksiteIds) store.worksiteIds = (await base.worksite.findMany({ where: { entity }, select: { id: true } })).map((w) => w.id);
    return { worksiteId: { in: store?.worksiteIds ?? [] } };
  }
  return null;
}

const READ_MANY = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
const WRITE_MANY = new Set(['updateMany', 'updateManyAndReturn', 'deleteMany']);

const extended = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const store = scopeStore.getStore();
        if (!store) return query(args);
        const filter = await filterFor(model, store.entity);
        if (!filter) return query(args);
        const a = args as Record<string, unknown>;
        const raw = base as unknown as Record<string, Record<string, (x: unknown) => Promise<unknown>>>;
        const d = raw[delegateOf(model)]!;

        if (READ_MANY.has(operation) || WRITE_MANY.has(operation)) return query({ ...a, where: and(a.where, filter) } as never);
        if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
          const row = await d[operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow']!({ ...a, where: and(a.where, filter) });
          return row;
        }
        if (operation === 'update' || operation === 'delete') {
          const ok = await d.findFirst!({ where: and(a.where, filter), select: { id: true } });
          if (!ok) throw notFound(model);
          return query(args);
        }
        if (operation === 'upsert') {
          const exists = await d.findFirst!({ where: a.where, select: { id: true } });
          if (exists && !(await d.findFirst!({ where: and(a.where, filter), select: { id: true } }))) throw notFound(model);
          return query(args);
        }
        if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
          if (model === 'Worksite') {
            const rows = (operation === 'create' ? [a.data] : a.data) as Record<string, unknown>[];
            for (const r of Array.isArray(rows) ? rows : [rows]) r.entity = store.entity; // un compte cloisonné ne crée que dans son entité
            return query(args);
          }
          const rows = (operation === 'create' ? [a.data] : (a.data as unknown[])) as Record<string, unknown>[];
          for (const r of Array.isArray(rows) ? rows : [rows]) {
            const wid = (r.worksiteId as string | null | undefined) ?? (r.worksite as { connect?: { id?: string } } | undefined)?.connect?.id ?? null;
            if (DIRECT.has(model) || BY_ID.has(model)) {
              if (!wid || !(await base.worksite.findFirst({ where: { id: wid, entity: store.entity }, select: { id: true } }))) throw new HttpError(403, 'Chantier hors de votre périmètre.');
            }
          }
          return query(args);
        }
        return query(args);
      },
    },
  },
});

/** Même interface que PrismaClient (le reste du code n'a rien à changer) ; le filtrage se fait à l'exécution. */
export const prisma = extended as unknown as PrismaClient;

/** Client sans cloisonnement : réservé aux tâches internes (authentification, vérifications du cloisonnement lui-même). */
export const rawPrisma = base;

/** Incrément atomique d'un compteur nommé (numéros R- / D- / F-). */
export async function nextCounter(name: string, start = 0): Promise<number> {
  const row = await prisma.counter.upsert({
    where: { name },
    create: { name, value: start + 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

/**
 * Prochain numéro de chantier : « R-857 ». Le compteur est recalé au-dessus du
 * plus grand numéro R- déjà présent (import inclus), puis on saute tout numéro
 * déjà pris par sécurité.
 */
export async function nextWorksiteRef(): Promise<string> {
  const existing = await prisma.counter.findUnique({ where: { name: 'worksite' } });
  const rows = await prisma.worksite.findMany({
    where: { ref: { startsWith: 'R-' } },
    select: { ref: true },
  });
  let max = existing?.value ?? 0;
  for (const r of rows) {
    const m = r.ref.match(/^R-0*(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (!existing || existing.value < max) {
    await prisma.counter.upsert({
      where: { name: 'worksite' },
      create: { name: 'worksite', value: max },
      update: { value: max },
    });
  }
  const taken = new Set(rows.map((r) => r.ref));
  for (let i = 0; i < 100; i++) {
    const n = await nextCounter('worksite');
    if (!taken.has(`R-${n}`)) return `R-${n}`;
  }
  throw new Error('Impossible d’attribuer un numéro de chantier');
}
