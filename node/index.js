var SystemProduction = require('../dist/system-production.src.js');
var fs = require('fs');
var path = require('path');
var Module = require('module');

var babel = require('babel-core');
var modulesRegister = require('babel-plugin-transform-es2015-modules-systemjs');
var importSyntax = require('babel-plugin-syntax-dynamic-import');

var isWindows = process.platform.match(/^win/);
function fileUrlToPath (fileUrl) {
  if (fileUrl.substr(0, 7) !== 'file://')
    return;
  if (isWindows)
    return fileUrl.substr(8).replace(/\//g, '/');
  else
    return fileUrl.substr(7);
}
function pathToFileUrl (filePath) {
  return 'file://' + (isWindows ? '/' : '') + (isWindows ? filePath.replace(/\\/g, '/') : filePath);
}

var sourceMapSources = global.systemjsProductionNodeLoaderSourceMapSources = global.systemjsProductionNodeLoaderSourceMapSources || {};
require('source-map-support').install({
  retrieveSourceMap: function (source) {
    if (!sourceMapSources[source])
      return null;

    return {
      url: source.replace('!transpiled', ''),
      map: sourceMapSources[source]
    };
  }
});

var SystemJSProductionLoader = SystemProduction.constructor;

function SystemJSProductionNodeLoader () {
  SystemJSProductionLoader.call(this);
}

SystemJSProductionNodeLoader.prototype = Object.create(SystemJSProductionLoader.prototype);
SystemJSProductionNodeLoader.prototype.constructor = SystemJSProductionNodeLoader;

SystemJSProductionNodeLoader.prototype.version = SystemJSProductionLoader.prototype.version + ' Node';

var plainResolveSync = SystemJSProductionLoader.prototype[SystemJSProductionLoader.plainResolveSync];

// add node_modules loading to plain resolve
SystemJSProductionNodeLoader.prototype[SystemJSProductionLoader.plainResolve] =
SystemJSProductionNodeLoader.prototype[SystemJSProductionLoader.plainResolveSync] = function (key, parentKey) {
  // SystemJS map takes preference
  // SystemJS map targets entirely skip Node resolution process
  var resolved = plainResolveSync.call(this, key, parentKey);
  if (resolved !== undefined)
    return resolved;

  var parentPath = parentKey ? fileUrlToPath(parentKey) : process.cwd();
  var requireContext = new Module(parentPath);
  requireContext.paths = Module._nodeModulePaths(parentPath);

  try {
    resolved = Module._resolveFilename(key.substr(0, 5) === 'file:' ? fileUrlToPath(key) : key, requireContext, true);
  }
  catch (e) {
    if (e.code === 'MODULE_NOT_FOUND')
      return;
    throw e;
  }

  // core modules are returned as plain non-absolute paths -> convert into node:fs etc to have a URL
  return path.isAbsolute(resolved) ? pathToFileUrl(resolved) : 'node:' + resolved;
};

// allow defining code by source
SystemJSProductionNodeLoader.prototype.define = function (key, source) {
  var path = fileUrlToPath(key);

  // transform source with Babel
  var output = babel.transform(source, {
    compact: false,
    moduleId: key,
    filename: key + '!transpiled',
    sourceFileName: key,
    moduleIds: true,
    sourceMaps: 'both',
    plugins: [importSyntax, modulesRegister]
  });

  // evaluate without require, exports and module variables
  output.map.sources = output.map.sources.map(fileUrlToPath);
  sourceMapSources[path + '!transpiled'] = output.map;
  var curSystem = global.System;
  global.System = this;
  (0, eval)(output.code + (path && '\n//# sourceURL=' + path + '!transpiled'));
  global.System = curSystem;
};

SystemJSProductionNodeLoader.prototype[SystemJSProductionLoader.instantiate] = function (key, processAnonRegister) {
  var loader = this;

  var path = fileUrlToPath(key);
  var curSystem = global.System;
  global.System = loader;
  var nodeModule = tryNodeLoad(key.substr(0, 5) === 'node:' ? key.substr(5) : path);
  global.System = curSystem;

  if (nodeModule) {
    // if it was System.register, then ignore the node loaded exports
    if (processAnonRegister())
      return;
    // CommonJS
    return Promise.resolve(loader.newModule({
      default: nodeModule,
      __useDefault: true
    }));
  }

  // otherwise, load as ES converting into System.register
  return new Promise(function (resolve, reject) {
    fs.readFile(path, function (err, source) {
      if (err)
        return reject(err);

      // transform source with Babel
      var output = babel.transform(source, {
        compact: false,
        filename: key + '!transpiled',
        sourceFileName: key,
        moduleIds: false,
        sourceMaps: 'both',
        plugins: [importSyntax, modulesRegister]
      });

      // evaluate without require, exports and module variables
      output.map.sources = output.map.sources.map(fileUrlToPath);
      sourceMapSources[path + '!transpiled'] = output.map;
      var curSystem = global.System;
      global.System = loader;
      (0, eval)(output.code + '\n//# sourceURL=' + path + '!transpiled');
      global.System = curSystem;
      processAnonRegister();

      resolve();
    });
  });
};

function tryNodeLoad (path) {
  try {
    return require(path);
  }
  catch (e) {
    if (e instanceof SyntaxError &&
        (e.message.indexOf('Unexpected token export') !== -1 || e.message.indexOf('Unexpected token import') !== -1 ||
        // for Node 4 and less
        e.message.indexOf('Unexpected reserved word') !== -1))
      return;
    throw e;
  }
}

module.exports = new SystemJSProductionNodeLoader();
