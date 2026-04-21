import 'express-async-errors';
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';

import charactersRouter    from './routes/characters';
import godModeRouter       from './routes/god-mode';
import aiRouter            from './routes/ai';
import timeRouter          from './routes/time';
import rulesetsRouter      from './routes/rulesets';
import interactionsRouter  from './routes/interactions';
import economyRouter       from './routes/economy';
import ripRouter           from './routes/rip';
import worldRouter         from './routes/world';
import religionsRouter     from './routes/religions';
import factionsRouter      from './routes/factions';
import worldsRouter        from './routes/worlds';
import { prisma }          from './db/client';

const app  = express();
const PORT = process.env.PORT ?? 3001;

// ── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// ── Routes ───────────────────────────────────────────────────
app.use('/api/characters',    charactersRouter);
app.use('/api/god-mode',      godModeRouter);
app.use('/api/ai',            aiRouter);
app.use('/api/time',          timeRouter);
app.use('/api/rulesets',      rulesetsRouter);
app.use('/api/interactions',  interactionsRouter);
app.use('/api/economy',       economyRouter);
app.use('/api/rip',           ripRouter);
app.use('/api/world',         worldRouter);
app.use('/api/religions',     religionsRouter);
app.use('/api/factions',      factionsRouter);
app.use('/api/worlds',        worldsRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── 404 ──────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler ────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);

  // Prisma "record not found"
  if (err.name === 'NotFoundError') {
    res.status(404).json({ error: 'Character not found' });
    return;
  }

  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────
async function main() {
  await prisma.$connect();
  console.log('Connected to database');
  app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
