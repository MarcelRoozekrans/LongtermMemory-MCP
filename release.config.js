export default {
  branches: ['main'],
  repositoryUrl: 'git@github.com:MarcelRoozekrans/LongtermMemory-MCP.git',
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
      },
    ],
    [
      '@semantic-release/exec',
      {
        prepareCmd:
          'node -e "' +
          "const fs=require('fs');" +
          "const v='${nextRelease.version}';" +
          "const s=JSON.parse(fs.readFileSync('server.json','utf8'));s.version=v;s.packages[0].version=v;fs.writeFileSync('server.json',JSON.stringify(s,null,2)+'\\n');" +
          "const p=JSON.parse(fs.readFileSync('.claude-plugin/plugin.json','utf8'));p.version=v;fs.writeFileSync('.claude-plugin/plugin.json',JSON.stringify(p,null,2)+'\\n');" +
          "const m=JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json','utf8'));m.metadata.version=v;m.plugins[0].version=v;fs.writeFileSync('.claude-plugin/marketplace.json',JSON.stringify(m,null,2)+'\\n');" +
          '"',
      },
    ],
    ['@semantic-release/npm', { provenance: true }],
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
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json', 'server.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
  ],
};
