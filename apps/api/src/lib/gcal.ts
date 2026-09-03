/**
 * Synchro Google Agenda — l'app pousse ses événements de planning vers l'agenda
 * partagé de JJD (compte de service). Dégradation silencieuse si non configuré :
 * l'app marche sans, les événements restent locaux.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { env } from '../env.js';

let cached: ReturnType<typeof google.calendar> | null = null;
let checked = false;

function client() {
  if (checked) return cached;
  checked = true;
  const keyPath = path.isAbsolute(env.google.saKeyFile)
    ? env.google.saKeyFile
    : path.resolve(process.cwd(), env.google.saKeyFile);
  if (!env.google.calendarId || !existsSync(keyPath)) {
    // eslint-disable-next-line no-console
    console.log('[gcal] non configuré (clé ou calendarId manquant) — synchro désactivée');
    return null;
  }
  try {
    const creds = JSON.parse(readFileSync(keyPath, 'utf8'));
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });
    cached = google.calendar({ version: 'v3', auth });
    // eslint-disable-next-line no-console
    console.log(`[gcal] actif — agenda ${env.google.calendarId}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[gcal] clé illisible :', (e as Error).message);
    cached = null;
  }
  return cached;
}

export function gcalEnabled(): boolean {
  return client() !== null;
}

interface EventInput {
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay?: boolean;
}

function toResource(e: EventInput) {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return {
    summary: e.summary,
    description: e.description,
    location: e.location,
    start: e.allDay ? { date: d(e.start) } : { dateTime: e.start.toISOString() },
    end: e.allDay ? { date: d(e.end) } : { dateTime: e.end.toISOString() },
  };
}

/** Crée ou met à jour ; renvoie l'id Google de l'événement (ou null si off). */
export async function upsertEvent(googleEventId: string | null, e: EventInput): Promise<string | null> {
  const cal = client();
  if (!cal) return null;
  try {
    if (googleEventId) {
      const r = await cal.events.update({
        calendarId: env.google.calendarId,
        eventId: googleEventId,
        requestBody: toResource(e),
      });
      return r.data.id ?? googleEventId;
    }
    const r = await cal.events.insert({
      calendarId: env.google.calendarId,
      requestBody: toResource(e),
    });
    return r.data.id ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[gcal] upsert échoué :', (err as Error).message);
    return googleEventId;
  }
}

export async function deleteEvent(googleEventId: string): Promise<void> {
  const cal = client();
  if (!cal) return;
  try {
    await cal.events.delete({ calendarId: env.google.calendarId, eventId: googleEventId });
  } catch {
    /* déjà supprimé */
  }
}
