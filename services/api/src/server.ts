import { createPool } from './db/client';
import { AppointmentRepository } from './repositories/appointment.repository';
import { AppointmentService } from './services/appointment.service';
import { AppointmentStateMachine } from './domain/appointment-state-machine';
import { FacultyRepository } from './repositories/faculty.repository';
import { FacultyService } from './services/faculty.service';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationService } from './services/notification.service';
import { FacultyAvailabilityRepository } from './repositories/faculty-availability.repository';
import { FacultyAvailabilityService } from './services/faculty-availability.service';
import { AuthRepository } from './repositories/auth.repository';
import { AuthService } from './services/auth.service';
import { getJwtSecret } from './auth/jwt-secret';
import { AdminRepository } from './repositories/admin.repository';
import { AdminService } from './services/admin.service';
import { createApp } from './app';

/**
 * Real entrypoint: wires the real PostgreSQL Pool through Repository ->
 * Service -> Express app, and starts listening. Not exercised by any test
 * (tests build their own app via createApp() so they can control the Pool
 * and clean up between tests) — this file is intentionally the thinnest
 * possible composition root.
 */
const pool = createPool();

const notificationRepo = new NotificationRepository(pool);
const notificationService = new NotificationService(notificationRepo);

const appointmentRepo = new AppointmentRepository(pool);
const appointmentService = new AppointmentService(appointmentRepo, new AppointmentStateMachine(), notificationService);

const facultyRepo = new FacultyRepository(pool);
const facultyService = new FacultyService(facultyRepo);

const facultyAvailabilityRepo = new FacultyAvailabilityRepository(pool);
const facultyAvailabilityService = new FacultyAvailabilityService(facultyAvailabilityRepo);

const authRepo = new AuthRepository(pool);
const authService = new AuthService(authRepo, getJwtSecret());

const adminRepo = new AdminRepository(pool);
const adminService = new AdminService(adminRepo);

const app = createApp({
  appointmentService,
  facultyService,
  notificationService,
  facultyAvailabilityService,
  authService,
  adminService,
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Faculty scheduling API listening on port ${port}`);
});
