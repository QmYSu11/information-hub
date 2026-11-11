import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { assertPublicSnapshot } from './data-utils.mjs';

// This script can write Git objects / push only in the repository's Actions runner.
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('快照持久化仅在 GitHub Actions 中运行');
const mode = process.argv[2];
if (!['restore', 'persist'].includes(mode)) throw new Error('需要 restore 或 persist');

function git(args, input, optional = false) {
  const result = spawnSync('git', args, {
    input, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'github-actions[bot]', GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com', GIT_COMMITTER_NAME: 'github-actions[bot]', GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com' },
  });
  if (result.status !== 0 && !optional) throw new Error('快照 Git 操作失败：' + args[0]);
  return result.status === 0 ? result.stdout.trim() : null;
}

const found = git(['ls-remote', '--heads', 'origin', 'data'], undefined, true);
if (found) git(['fetch', 'origin', 'data:refs/remotes/origin/data', '--depth=1']);
const parent = found ? git(['rev-parse', 'refs/remotes/origin/data']) : null;
if (mode === 'restore') {
  if (!parent) console.log('没有历史快照分支，使用项目自带的最近快照');
  else {
    const content = git(['show', parent + ':snapshot.json']);
    assertPublicSnapshot(JSON.parse(content));
    await mkdir('public/data', { recursive: true });
    await writeFile('public/data/snapshot.json', content + '\n', 'utf8');
    console.log('已恢复最近成功快照，失败来源可保留原数据');
  }
} else {
  const content = await readFile('public/data/snapshot.json', 'utf8');
  assertPublicSnapshot(JSON.parse(content));
  const blob = git(['hash-object', '-w', '--stdin'], content);
  const tree = git(['mktree'], '100644 blob ' + blob + '\tsnapshot.json\n');
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], 'Update public source snapshot\n');
  git(['push', 'origin', commit + ':refs/heads/data']);
  console.log('公开快照已保存到 data 分支；未写入个人记录');
}
