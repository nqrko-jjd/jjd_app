import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './env.js';
import { attachUser } from './lib/auth.js';
import { errorMiddleware } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { worksitesRouter } from './routes/worksites.js';
import { contactsRouter } from './routes/contacts.js';
import { buildingsRouter } from './routes/buildings.js';
import { peopleRouter } from './routes/people.js';
import { crmRouter } from './routes/crm.js';
import { dashboardRouter, metaRouter, importsRouter } from './routes/misc.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.corsOrigins.includes('*') ? true : env.corsOrigins }));
  app.use(express.json({ limit: '2mb' }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
  app.use(attachUser);

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'jjd-api' }));

  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/worksites', worksitesRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/buildings', buildingsRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api/crm', crmRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/imports', importsRouter);

  app.use(errorMiddleware);
  return app;
}
