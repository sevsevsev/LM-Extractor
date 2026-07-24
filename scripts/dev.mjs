import { spawn } from 'node:child_process';

const kids = [
  spawn('npx', ['tsx', 'server.ts'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true }),
];

const shutdown = (code = 0) => {
  for (const kid of kids) {
    if (!kid.killed) kid.kill('SIGTERM');
  }
  process.exit(code);
};

for (const kid of kids) {
  kid.on('exit', code => {
    if (code && code !== 0) shutdown(code);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
