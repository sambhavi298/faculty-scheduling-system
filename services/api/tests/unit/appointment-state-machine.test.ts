import { AppointmentStateMachine } from '../../src/domain/appointment-state-machine';
import { InvalidTransitionError } from '../../src/errors/invalid-transition.error';

describe('AppointmentStateMachine', () => {
  const sm = new AppointmentStateMachine();

  describe('canTransition', () => {
    const validTransitions: Array<[string, string]> = [
      ['PENDING', 'APPROVED'],
      ['PENDING', 'REJECTED'],
      ['PENDING', 'CANCELLED'],
      ['PENDING', 'EXPIRED'],
      ['APPROVED', 'COMPLETED'],
      ['APPROVED', 'CANCELLED'],
      ['APPROVED', 'MISSED'],
    ];

    it.each(validTransitions)('allows %s -> %s', (from, to) => {
      expect(sm.canTransition(from as any, to as any)).toBe(true);
    });

    const invalidTransitions: Array<[string, string]> = [
      ['REJECTED', 'APPROVED'],
      ['CANCELLED', 'APPROVED'],
      ['COMPLETED', 'CANCELLED'],
      ['MISSED', 'COMPLETED'],
      ['PENDING', 'COMPLETED'],
      ['PENDING', 'MISSED'],
      ['APPROVED', 'REJECTED'],
      ['APPROVED', 'EXPIRED'],
      ['EXPIRED', 'PENDING'],
    ];

    it.each(invalidTransitions)('rejects %s -> %s', (from, to) => {
      expect(sm.canTransition(from as any, to as any)).toBe(false);
    });

    it('treats a same-status "transition" as allowed (no-op update)', () => {
      expect(sm.canTransition('PENDING', 'PENDING')).toBe(true);
    });
  });

  describe('assertValidTransition', () => {
    it('does not throw for a valid transition', () => {
      expect(() => sm.assertValidTransition('PENDING', 'APPROVED')).not.toThrow();
    });

    it('throws InvalidTransitionError for an invalid transition, carrying from/to', () => {
      expect(() => sm.assertValidTransition('COMPLETED', 'PENDING')).toThrow(InvalidTransitionError);
      try {
        sm.assertValidTransition('COMPLETED', 'PENDING');
        fail('expected assertValidTransition to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        expect((err as InvalidTransitionError).from).toBe('COMPLETED');
        expect((err as InvalidTransitionError).to).toBe('PENDING');
      }
    });
  });
});
