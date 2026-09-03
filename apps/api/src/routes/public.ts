import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import { sendMail } from '../lib/mail.js';

export const publicRouter = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(60).optional().or(z.literal('')),
  type: z.string().trim().max(60).optional().or(z.literal('')),
  location: z.string().trim().max(200).optional().or(z.literal('')),
  message: z.string().trim().min(5).max(4000),
  website: z.string().max(200).optional(), // honeypot : doit rester vide (rempli => bot)
});

// throttle mémoire simple : 5 requêtes / 10 min / IP
const hits = new Map<string, number[]>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const win = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  win.push(now);
  hits.set(ip, win);
  return win.length > 5;
}

publicRouter.post(
  '/contact',
  asyncHandler(async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'Formulaire incomplet' });
    const d = parsed.data;

    // honeypot rempli ou trop de requêtes -> on répond OK sans rien créer
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (d.website || throttled(ip)) return res.json({ ok: true });

    const title = `${d.type ? `${d.type} — ` : ''}${d.name}${d.company ? ` (${d.company})` : ''}`;
    const noteLines = [
      `Demande via le site jjd-consult.be`,
      d.type && `Type : ${d.type}`,
      `Nom : ${d.name}`,
      d.company && `Société : ${d.company}`,
      `E-mail : ${d.email}`,
      d.phone && `Téléphone : ${d.phone}`,
      d.location && `Localisation : ${d.location}`,
      '',
      d.message,
    ].filter(Boolean);

    const opp = await prisma.crmOpportunity.create({
      data: {
        title: title.slice(0, 180),
        stage: 'new',
        source: 'site',
        nextActionOn: new Date(),
        note: noteLines.join('\n'),
      },
    });

    await sendMail(
      'info@jjd-consult.be',
      `Nouvelle demande site — ${title}`,
      noteLines.join('\n') + `\n\nPipeline : opportunité ${opp.id}`,
    );

    res.json({ ok: true });
  }),
);
