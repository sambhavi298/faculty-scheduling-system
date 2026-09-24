import { NotificationService } from '../../src/services/notification.service';
import { NotificationRepository, NotificationRow } from '../../src/repositories/notification.repository';
import { NotFoundError } from '../../src/errors/not-found.error';

function fakeRepo(): jest.Mocked<Pick<NotificationRepository, 'insert' | 'listForUser' | 'listUnreadForUser' | 'markRead'>> {
  return {
    insert: jest.fn(),
    listForUser: jest.fn(),
    listUnreadForUser: jest.fn(),
    markRead: jest.fn(),
  };
}

function notificationRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: '1',
    recipient_id: '100',
    appointment_id: '5000',
    type: 'APPOINTMENT_APPROVED',
    message: 'Your appointment request was approved.',
    is_read: false,
    created_at: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationService (unit — mocked NotificationRepository)', () => {
  function fakeService() {
    const repo = fakeRepo();
    const service = new NotificationService(repo as unknown as NotificationRepository);
    return { repo, service };
  }

  describe('notify (Strategy formatter map — Level 5 Section 10)', () => {
    it('formats APPOINTMENT_REQUESTED with actor name and reason when both are provided', async () => {
      const { repo, service } = fakeService();
      repo.insert.mockResolvedValueOnce(notificationRow({ type: 'APPOINTMENT_REQUESTED' }));

      await service.notify('200', 'APPOINTMENT_REQUESTED', {
        appointmentId: '5000',
        actorName: 'Alice Student',
        reason: 'Doubt in assignment 2',
      });

      expect(repo.insert).toHaveBeenCalledWith(
        '200',
        '5000',
        'APPOINTMENT_REQUESTED',
        'New appointment request from Alice Student: "Doubt in assignment 2".'
      );
    });

    it('formats APPOINTMENT_REQUESTED gracefully when actorName/reason are absent', async () => {
      const { repo, service } = fakeService();
      repo.insert.mockResolvedValueOnce(notificationRow());

      await service.notify('200', 'APPOINTMENT_REQUESTED', { appointmentId: '5000' });

      expect(repo.insert).toHaveBeenCalledWith('200', '5000', 'APPOINTMENT_REQUESTED', 'New appointment request.');
    });

    it('formats APPOINTMENT_APPROVED with a fixed message', async () => {
      const { repo, service } = fakeService();
      repo.insert.mockResolvedValueOnce(notificationRow());

      await service.notify('100', 'APPOINTMENT_APPROVED', { appointmentId: '5000' });

      expect(repo.insert).toHaveBeenCalledWith('100', '5000', 'APPOINTMENT_APPROVED', 'Your appointment request was approved.');
    });

    it('formats APPOINTMENT_REJECTED with a fixed message', async () => {
      const { repo, service } = fakeService();
      repo.insert.mockResolvedValueOnce(notificationRow());

      await service.notify('100', 'APPOINTMENT_REJECTED', { appointmentId: '5000' });

      expect(repo.insert).toHaveBeenCalledWith('100', '5000', 'APPOINTMENT_REJECTED', 'Your appointment request was rejected.');
    });

    it('formats APPOINTMENT_CANCELLED with the actor name when provided', async () => {
      const { repo, service } = fakeService();
      repo.insert.mockResolvedValueOnce(notificationRow());

      await service.notify('200', 'APPOINTMENT_CANCELLED', { appointmentId: '5000', actorName: 'Alice Student' });

      expect(repo.insert).toHaveBeenCalledWith('200', '5000', 'APPOINTMENT_CANCELLED', 'An appointment was cancelled by Alice Student.');
    });

    it('formats APPOINTMENT_CANCELLED without an actor name', async () => {
      const { repo, service } = fakeService();
      repo.insert.mockResolvedValueOnce(notificationRow());

      await service.notify('200', 'APPOINTMENT_CANCELLED', { appointmentId: '5000' });

      expect(repo.insert).toHaveBeenCalledWith('200', '5000', 'APPOINTMENT_CANCELLED', 'An appointment was cancelled.');
    });

    it('formats APPOINTMENT_COMPLETED with a fixed message', async () => {
      const { repo, service } = fakeService();
      repo.insert.mockResolvedValueOnce(notificationRow());

      await service.notify('100', 'APPOINTMENT_COMPLETED', { appointmentId: '5000' });

      expect(repo.insert).toHaveBeenCalledWith('100', '5000', 'APPOINTMENT_COMPLETED', 'Your appointment was marked completed.');
    });

    it('formats APPOINTMENT_MISSED with a fixed message', async () => {
      const { repo, service } = fakeService();
      repo.insert.mockResolvedValueOnce(notificationRow());

      await service.notify('100', 'APPOINTMENT_MISSED', { appointmentId: '5000' });

      expect(repo.insert).toHaveBeenCalledWith('100', '5000', 'APPOINTMENT_MISSED', 'Your appointment was marked missed.');
    });

    it('returns the row the repository created', async () => {
      const { repo, service } = fakeService();
      const row = notificationRow();
      repo.insert.mockResolvedValueOnce(row);

      expect(await service.notify('100', 'APPOINTMENT_APPROVED', { appointmentId: '5000' })).toEqual(row);
    });
  });

  describe('listMine', () => {
    it('delegates to listForUser with the given user id', async () => {
      const { repo, service } = fakeService();
      const rows = [notificationRow()];
      repo.listForUser.mockResolvedValueOnce(rows);

      expect(await service.listMine('100')).toEqual(rows);
      expect(repo.listForUser).toHaveBeenCalledWith('100');
    });
  });

  describe('listUnread', () => {
    it('delegates to listUnreadForUser with the given user id', async () => {
      const { repo, service } = fakeService();
      const rows = [notificationRow({ is_read: false })];
      repo.listUnreadForUser.mockResolvedValueOnce(rows);

      expect(await service.listUnread('100')).toEqual(rows);
      expect(repo.listUnreadForUser).toHaveBeenCalledWith('100');
    });
  });

  describe('markRead', () => {
    it('returns the updated row when the repository finds and updates it', async () => {
      const { repo, service } = fakeService();
      const row = notificationRow({ is_read: true });
      repo.markRead.mockResolvedValueOnce(row);

      expect(await service.markRead('1', '100')).toEqual(row);
      expect(repo.markRead).toHaveBeenCalledWith('1', '100');
    });

    it('throws NotFoundError when the repository returns null (wrong id, or not owned by this user)', async () => {
      const { repo, service } = fakeService();
      repo.markRead.mockResolvedValueOnce(null);

      await expect(service.markRead('999', '100')).rejects.toThrow(NotFoundError);
    });
  });
});
