// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import promisePlugin from 'eslint-plugin-promise'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  // Files / dirs we never lint
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'drizzle/migrations/**',
      'drizzle/migrations/meta/**',
      'assets/**',
      '*.config.js',
      '*.config.mjs',
    ],
  },

  // Base JS recommendations
  eslint.configs.recommended,

  // TypeScript recommended + type-aware rules.
  // strictTypeChecked turns on rules like no-floating-promises and no-misused-promises
  // which are the main reason we picked ESLint over Biome.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Promise correctness — async/await + .catch() habits matter for payment / webhook code.
  promisePlugin.configs['flat/recommended'],

  // Project-wide settings
  {
    languageOptions: {
      parserOptions: {
        // Point at tsconfig.eslint.json which extends the build tsconfig but
        // also includes tests/, scripts/, vitest.config.ts (which the build
        // tsconfig deliberately excludes from the emitted bundle).
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ─── Backend-critical correctness rules (ERROR — the whole point of ESLint here) ──
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // ─── Unused vars: errors, with leading underscore as intentional-ignore ────────
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      // ─── Soft-fail rules: warn for now so adoption is feasible ─────────────────────
      // The codebase deliberately uses `any` in a few places (WS socket, generic catches).
      '@typescript-eslint/no-explicit-any': 'warn',
      // Used legitimately for post-existence-check patterns like ticketRooms.get(id)!.foo
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Drizzle's sql`` and z.object() inference often look like `any` to the engine
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      // Common pattern: returning Promises that already resolve with typed values
      '@typescript-eslint/require-await': 'warn',
      // `return await` adds a microtask hop; useful only in try/catch — too stylistic
      '@typescript-eslint/return-await': 'warn',
      // Wants `??` over `||` — stylistic improvement, not a bug
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      // `?.` over `&&` chains — also stylistic
      '@typescript-eslint/prefer-optional-chain': 'warn',
      // `unknown` in catch over `any` — codebase pattern uses typed errors
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'warn',

      // ─── Disabled — too noisy or doesn't fit this codebase ─────────────────────────
      // Flags conditions involving optional chains as "unnecessary" — false positives
      // are common when external data (DB rows, API responses) can be undefined.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Flags every Drizzle .where().limit() pattern as deprecated. Drizzle's surface
      // changes too frequently for this to be useful here.
      '@typescript-eslint/no-deprecated': 'off',
      // Class methods passed as callbacks (e.g. controller methods routed by Fastify)
      // trip this constantly. Fastify itself binds `this` correctly.
      '@typescript-eslint/unbound-method': 'off',
      // Enum vs enum comparison — codebase uses string enums with runtime guards.
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      // Pure style: `T[]` vs `Array<T>` — codebase uses both freely
      '@typescript-eslint/array-type': 'off',
      // Pure style: interface vs type
      '@typescript-eslint/consistent-type-definitions': 'off',
      // Flags `${string}` in templates if value isn't a string — Drizzle decimal columns
      // emit string types but template usage is intentional.
      '@typescript-eslint/restrict-template-expressions': 'off',
      // Empty functions — pattern: `.catch(() => {})` for fire-and-forget intentionally
      '@typescript-eslint/no-empty-function': 'off',
      // Style: `if (x) for` vs `for-of`
      '@typescript-eslint/prefer-for-of': 'off',
      // Style: void expression returns
      '@typescript-eslint/no-confusing-void-expression': 'off',

      // ─── Promise plugin: turn off rules covered by typescript-eslint ───────────────
      'promise/always-return': 'off',
      'promise/catch-or-return': 'off',
      'promise/no-callback-in-promise': 'off',
    },
  },

  // Test files: relax some rules that are noisy in test setup
  {
    files: ['tests/**/*.ts', 'tests/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Scripts: more permissive (one-off operational code)
  {
    files: ['scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      'no-console': 'off',
    },
  },

  // Prettier last — turns off any formatting rules that conflict with Prettier.
  // Keep at the end so it overrides earlier configs.
  prettierConfig,
)
