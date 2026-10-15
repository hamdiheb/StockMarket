export function requestLogger(req, res, next) {
  const start = performance.now()
  res.on('finish', () => {
    const ms = (performance.now() - start).toFixed(0)
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`)
  })
  next()
}
