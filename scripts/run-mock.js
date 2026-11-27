#!/usr/bin/env node
// Cross-platform "npm run mock": starts the server in offline demo mode (no API key needed).
process.env.MOCK = '1';
require('../server.js');
