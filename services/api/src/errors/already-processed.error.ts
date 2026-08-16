export class AlreadyProcessedError extends Error {
  constructor(message = 'This appointment has already been processed and can no longer be changed this way.') {
    super(message);
    this.name = 'AlreadyProcessedError';
    Object.setPrototypeOf(this, AlreadyProcessedError.prototype);
  }
}
