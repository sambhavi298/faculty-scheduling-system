/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverage: true,
  collectCoverageFrom: [
    'src/services/appointment.service.ts',
    'src/repositories/appointment.repository.ts',
    'src/domain/appointment-state-machine.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'json-summary'],
  coverageThreshold: {
    './src/services/appointment.service.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    },
    './src/domain/appointment-state-machine.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    }
  },
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts']
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts']
    },
    {
      displayName: 'concurrency',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/concurrency/**/*.test.ts'],
      testTimeout: 20000
    },
    {
      displayName: 'security',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/security/**/*.test.ts']
    },
    {
      displayName: 'advanced-sql',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/advanced-sql/**/*.test.ts'],
      testTimeout: 30000
    },
    {
      displayName: 'performance',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/performance/**/*.test.ts'],
      testTimeout: 120000
    },
    {
      displayName: 'failure-injection',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/failure-injection/**/*.test.ts'],
      testTimeout: 30000
    }
  ]
};
