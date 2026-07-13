// See: https://jestjs.io/docs/configuration

export default {
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: ['./dist/src/**/*.js'],
  coverageDirectory: './coverage',
  coveragePathIgnorePatterns: ['/node_modules/'],
  coverageReporters: ['json-summary', 'text', 'lcov'],
  reporters: ['default'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/dist/__tests__/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  verbose: true
}
