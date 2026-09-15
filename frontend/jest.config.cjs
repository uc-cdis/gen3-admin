const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  // Mirror the `@/*` -> `./*` mapping in tsconfig.json. Listing only components
  // and pages meant imports from @/lib, @/hooks, @/contexts and @/utils failed
  // to resolve under Jest even though they compile fine.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testEnvironment: 'jest-environment-jsdom',
};

module.exports = createJestConfig(customJestConfig);
