/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: [
    'src/lib/invoice/confidence.ts',
    'src/lib/common/currency.ts',
    'src/lib/invoice/extractedFields.ts',
    'src/lib/common/selection.ts',
    'src/lib/invoice/tallyMapping.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 96,
      lines: 80,
      statements: 80
    }
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  clearMocks: true
};
