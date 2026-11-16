export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // release-please treats deps as a visible, releasing type (release-please-config.json), so
    // commitlint must accept it too.
    'type-enum': [
      2,
      'always',
      ['build', 'chore', 'ci', 'deps', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'],
    ],
  },
};
