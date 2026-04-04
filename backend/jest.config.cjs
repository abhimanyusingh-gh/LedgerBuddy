if (!process.env.MONGO_URI) {
  process.env.MONGO_URI = 'mongodb://billforge_app:billforge_local_pass@127.0.0.1:27018/billforge?authSource=billforge';
}
if (!process.env.ENV) {
  process.env.ENV = 'local';
}

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$', '\\.e2e\\.test\\.ts$'],
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
      branches: 20,
      functions: 40,
      lines: 30,
      statements: 30
    },
    './src/services/confidenceAssessment.ts': { branches: 95, functions: 100, lines: 100, statements: 100 },
    './src/services/tallyExporter.ts': { branches: 86, functions: 100, lines: 95, statements: 95 },
    './src/utils/currency.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    './src/utils/mime.ts': { branches: 100, functions: 100, lines: 100, statements: 100 }
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  clearMocks: true
};
