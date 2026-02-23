/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/parser/invoiceParser.ts',
    'src/services/confidenceAssessment.ts',
    'src/services/invoiceExtractionAgent.ts',
    'src/services/tallyExporter.ts',
    'src/utils/currency.ts',
    'src/ocr/DeepSeekOcrProvider.ts',
    'src/utils/mime.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 80,
      statements: 80
    }
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  clearMocks: true
};
