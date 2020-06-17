const CDP = require('chrome-remote-interface')
const chalk = require('chalk')

let eventFilter

const severityColors = {
  'verbose': (a) => a,
  'info': chalk.blue,
  'warning': chalk.yellow,
  'error': chalk.red
}

const severityIcons = {
  'verbose': ' ',
  'info': '🛈',
  'warning': '⚠',
  'error': '⚠',
}

function debugLog(msg) {
  // suppress with DEBUG=-cypress-log-to-output
  if (process.env.DEBUG && process.env.DEBUG.includes('-cypress-log-to-output')) {
    return
  }

  log(`[cypress-log-to-output] ${msg}`)
}

function log(msg) {
  console.log(msg)
}

function logEntry(params) {
  if (eventFilter && !eventFilter('browser', params.entry)) {
    return
  }

  const { level, source, text, timestamp, url, lineNumber, stackTrace, args } = params.entry
  const color = severityColors[level]
  const icon = severityIcons[level]

  const prefix = `[${new Date(timestamp).toISOString()}] ${icon} `
  const prefixSpacer = ' '.repeat(prefix.length)

  log(color(`${prefix}${chalk.bold(level)} (${source}): ${text}`))

  const logAdditional = (msg) => {
    log(color(`${prefixSpacer}${msg}`))
  }

  if (url) {
    logAdditional(`${chalk.bold('URL')}: ${url}`)
  }

  if (stackTrace && lineNumber) {
    logAdditional(`Stack trace line number: ${lineNumber}`)
    logAdditional(`Stack trace description: ${stackTrace.description}`)
    logAdditional(`Stack call frames: ${JSON.stringify(stackTrace.callFrames)}`)
  }

  if (args) {
    logAdditional(`Arguments:`)
    logAdditional('  ' + JSON.stringify(args, null, 2).split('\n').join(`\n${prefixSpacer}  `).trimRight())
  }
}

function processArgs(args) {
  return args.map(arg => {
    if (arg.value !== undefined) {
      return arg.value;
    }

    return JSON.stringify(arg);
  });
}

function logConsole(params) {
  if (eventFilter && !eventFilter('console', params)) {
    return
  }

  const { type, args } = params
  try {
    console[type](...processArgs(args))
  }
  catch (e) {}
}

function install(on, filter) {
  eventFilter = filter
  on('before:browser:launch', browserLaunchHandler)
}

function isChrome(browser) {
  return browser.family === 'chrome' || ['chrome', 'chromium', 'canary'].includes(browser.name)
}

function ensureRdpPort(args) {
  const existing = args.find(arg => arg.slice(0, 23) === '--remote-debugging-port')

  if (existing) {
    return Number(existing.split('=')[1])
  }

  const port = 40000 + Math.round(Math.random() * 25000)

  args.push(`--remote-debugging-port=${port}`)

  return port
}

function browserLaunchHandler(browser = {}, launchOptions) {
  const args = launchOptions.args || launchOptions

  if (!isChrome(browser)) {
    return debugLog(`Warning: An unsupported browser family was used, output will not be logged to console: ${browser.family}`)
  }

  debugLog('Attempting to connect to Chrome Debugging Protocol')

  let maxRetries = 10
  let tryCounter = 0

  const tryConnect = () => {
    tryCounter++

    if(tryCounter > maxRetries) {
      return
    }

    const port = ensureRdpPort(args)
    new CDP({
      port
    })
    .then((cdp) => {
      debugLog('Connected to Chrome Debugging Protocol')

      /** captures logs from the browser */
      cdp.Log.enable()
      cdp.Log.entryAdded(logEntry)

      /** captures logs from console.X calls */
      cdp.Runtime.enable()
      cdp.Runtime.consoleAPICalled(logConsole)

      cdp.on('error', (...args) => {
        console.log('Chrome Debugging Protocol error')
        console.log(JSON.stringify(args))
      })

      cdp.on('disconnect', () => {
        debugLog('Chrome Debugging Protocol disconnected')
      })
    })
    .catch(() => {
      console.log(`Error when connecting to Chrome Debugging Protocol, retrying ${tryCounter} / ${maxRetries}, port: ${port}`)
      setTimeout(tryConnect, 100)
    })
  }

  tryConnect()

  return launchOptions
}

module.exports = {
  _ensureRdpPort: ensureRdpPort,
  install,
  browserLaunchHandler
}
