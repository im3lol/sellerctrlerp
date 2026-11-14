// Package the current working tree (including uncommitted work), without secrets,
// local databases, build outputs, or desktop/mobile projects.
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const output = resolve(process.argv[2] || 'dbbackups/vps-source.tar.gz');
const allowed = new Set(['app', 'components', 'content', 'db', 'docker', 'docs', 'lib', 'public', 'scripts', 'test', 'types']);
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 20 * 1024 * 1024 }).toString().split('\0'))]
  .filter(f => f && (allowed.has(f.split('/')[0]) || !f.includes('/')))
  .filter(f => !f.split('/').some(p => p.startsWith('.env') && p !== '.env.example'))
  .filter(f => !/\.(pem|key|pfx|dump|pdf|zip|tar|gz)$/i.test(f))
  .filter(f => existsSync(f) && statSync(f).isFile());
const list = join(dirname(output), 'source-files.list');
writeFileSync(list, files.join('\n') + '\n');
try {
  execFileSync('tar', ['-czf', output, '-T', list], { stdio: 'inherit' });
} finally { unlinkSync(list); }
console.log(`Packaged ${files.length} source files.`);
