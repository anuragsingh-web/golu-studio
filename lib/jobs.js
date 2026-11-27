// Tiny in-memory job runner for long AI tasks (polled by the UI).
const crypto = require('crypto');
const jobs = new Map();
function createJob(kind, steps, fn) {
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, kind, status: 'running', steps: steps.map((label) => ({ label, state: 'pending', note: '' })), log: [], result: null, error: null, startedAt: Date.now() };
  const api = {
    step(i, state = 'active', note = '') { job.steps[i].state = state; if (note) job.steps[i].note = note; if (state === 'active') job.steps.forEach((s, k) => { if (k < i && s.state === 'active') s.state = 'done'; }); },
    log(msg) { job.log.push(`${new Date().toLocaleTimeString('en-IN', { hour12: false })} ${msg}`); },
    job,
  };
  jobs.set(id, job);
  Promise.resolve().then(() => fn(api)).then((result) => {
    job.result = result; job.status = 'done'; job.steps.forEach((s) => { if (s.state !== 'error' && s.state !== 'skipped') s.state = 'done'; });
  }).catch((e) => {
    job.status = 'error'; job.error = e.message || String(e); const a = job.steps.find((s) => s.state === 'active'); if (a) a.state = 'error';
    console.error(`[job ${kind}] ${job.error}`);
  }).finally(() => { job.finishedAt = Date.now(); });
  return job;
}
const getJob = (id) => jobs.get(id);
module.exports = { createJob, getJob };
