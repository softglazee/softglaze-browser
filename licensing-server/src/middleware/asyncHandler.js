'use strict';
// Wrap an async route so a rejected promise reaches the Express error handler.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
