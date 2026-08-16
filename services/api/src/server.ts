import { createPool } from './db/client';
import { AppointmentRepository } from './repositories/appointment.repository';
import { AppointmentService } from './services/appointment.service';
import { AppointmentStateMachine } from './domain/appointment-state-machine';
import { createApp } from './app';

/**
 * Real entrypoint: wires the real PostgreSQL Pool through Repository ->
 * Service -> Express app, and starts listening. Not exercised by any test
 * (tests build their own app via createApp() so they can control the Pool
 * and clean up between tests) — this file is intentionally the thinnest
 * possible composition root.
 */
const pool = createPool();
const repo = new AppointmentRepository(pool);
const service = new AppointmentService(repo, new AppointmentStateMachine());
const app = createApp(service);

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Faculty scheduling API listening on port ${port}`);
});
