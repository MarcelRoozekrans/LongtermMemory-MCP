export default {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
      },
    ],
    ['@semantic-release/npm', { provenance: true }],
    [
      '@semantic-release/exec',
      {
        prepareCmd:
          'node -e "const s=JSON.parse(require(\'fs\').readFileSync(\'server.json\',\'utf8\'));s.version=\'${nextRelease.version}\';s.packages[0].version=\'${nextRelease.version}\';require(\'fs\').writeFileSync(\'server.json\',JSON.stringify(s,null,2)+\'\\n\')"',
      },
    ],
    [
      '@semantic-release/github',
      {
        successComment: false,
        failCommentCondition: false,
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json', 'server.json'],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
  ],
};
