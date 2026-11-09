import { readFileSync, writeFileSync } from 'node:fs'
const root = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')
const path = `${root}/index.js`
const text = readFileSync(path, 'utf8')
const before = `  ctx.inject(['webServer'], (webCtx) => {\n    webCtx.effect(\n      () => registerRoutes(webCtx.webServer, { core, ready }),\n      'dsh-plugin-viburnum: routes',\n    )\n  })`
const after = `  ctx.inject(['webServer'], (webCtx) => {\n    // The desktop opener is the session controller's verified path opener. It\n    // is read at use time because the API domain may activate after this row.\n    const openPath = async (path, target, signal) => {\n      void target\n      const sessionController = webCtx.get('sessionController')\n      const unavailable = (message) => {\n        const error = new Error(message)\n        error.code = 'open-unavailable'\n        return error\n      }\n      if (sessionController === undefined || sessionController === null\n        || typeof sessionController.openWorkspacePath !== 'function') {\n        throw unavailable('desktop opening is not available in this profile')\n      }\n      if (typeof sessionController.canOpenWorkspacePath === 'function'\n        && !sessionController.canOpenWorkspacePath()) {\n        throw unavailable('desktop opening is not available on this host')\n      }\n      await sessionController.openWorkspacePath({ path }, signal)\n    }\n    webCtx.effect(\n      () => registerRoutes(webCtx.webServer, { core, ready, openPath }),\n      'dsh-plugin-viburnum: routes',\n    )\n  })`
if (!text.includes(before)) throw new Error('index marker not found')
writeFileSync(path, text.replace(before, after), 'utf8')
console.log('index wired')
