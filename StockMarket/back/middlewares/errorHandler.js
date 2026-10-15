export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function notFound(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`))
}

// Express recognises error handlers by their 4-argument signature, so `_next` must stay.
export function errorHandler(err, _req, res, _next) {
  // Errors without a status are unexpected: log them and hide the details from the client.
  if (!err.status) console.error(err)
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' })
}
