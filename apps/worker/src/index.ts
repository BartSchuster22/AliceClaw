console.log('[worker] started', new Date().toISOString());
setInterval(() => {
  console.log('[worker] heartbeat', new Date().toISOString());
}, 30000);
