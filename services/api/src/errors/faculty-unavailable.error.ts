export class FacultyUnavailableError extends Error {
  constructor(message = 'The requested slot is outside faculty availability or falls during a teaching, leave, or blocked period.') {
    super(message);
    this.name = 'FacultyUnavailableError';
    Object.setPrototypeOf(this, FacultyUnavailableError.prototype);
  }
}
