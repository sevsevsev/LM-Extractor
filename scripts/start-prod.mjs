import { spawn } from 'node:child_process';

process.env.NODE_ENV = 'production';

const child = spawn('npx', ['tsx', 'server.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', code => process.exit(code ?? 0));
