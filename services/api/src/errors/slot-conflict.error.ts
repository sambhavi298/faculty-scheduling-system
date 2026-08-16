export class SlotConflictError extends Error {
  constructor(message = 'The requested time overlaps an existing active appointment for this faculty member.') {
    super(message);
    this.name = 'SlotConflictError';
    Object.setPrototypeOf(this, SlotConflictError.prototype);
  }
}
