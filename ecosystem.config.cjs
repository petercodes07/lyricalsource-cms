module.exports = { apps: [{
  name: 'lyricalsource-cms',
  cwd: __dirname,
  script: 'src/server.js',
  instances: 1,
  node_args: '--max-old-space-size=192',
  exec_mode: 'fork',
  max_memory_restart: '384M',
  kill_timeout: 20000,
  exp_backoff_restart_delay: 1000,
  env: { NODE_ENV: 'production' },
}] };
