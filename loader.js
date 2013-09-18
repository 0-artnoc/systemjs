/*
 * ES6 RequireJS-style module loader
 *
 * Supports RequireJS-inspired map, packages and plugins.
 *
 * https://github.com/jspm/jspm-loader
 * 
 * MIT
 *
 */
(function() {

  (function() {

    var isBrowser = typeof window != 'undefined';
    var global = isBrowser ? window : {};

    var startConfig = global.jspm || {};

    var config = {};
    config.waitSeconds = 20;
    config.map = config.map || {};
    config.locations = config.locations || {};
    config.depends = config.depends || {};

    global.createLoader = function() {
      delete global.createLoader;

      config.baseURL = config.baseURL || isBrowser ? document.URL.substring(0, window.location.href.lastIndexOf('\/') + 1) : './';
      config.locations.plugin = config.locations.plugin || config.baseURL;

      // -- helpers --

        // es6 module regexs to check if it is a module or a global script
        var importRegEx = /(?:^\s*|[}{\(\);,\n]\s*)import\s+./;
        var exportRegEx = /(?:^\s*|[}{\(\);,\n]\s*)export\s+(\{|\*|var|class|function|default)/;
        var moduleRegEx = /(?:^\s*|[}{\(\);,\n]\s*)module\s+("[^"]+"|'[^']+')\s*\{/;

        // AMD and CommonJS regexs for support
        var amdDefineRegEx = /(?:^\s*|[}{\(\);,\n]\s*)define\s*\(\s*("[^"]+"\s*,|'[^']+'\s*,)?\s*(\[(\s*("[^"]+"|'[^']+')\s*,)*(\s*("[^"]+"|'[^']+')\s*)?\])?/g;
        var cjsDefineRegEx = /(?:^\s*|[}{\(\);,\n]\s*)define\s*\(\s*(function\s*|{|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*\))/g;
        var cjsRequireRegEx = /(?:^\s*|[}{\(\);,\n=:]\s*)require\s*\(\s*("([^"]+)"|'([^']+)')\s*\)/g;
        var cjsExportsRegEx = /(?:^\s*|[}{\(\);,\n=:]\s*)exports\s*\[\s*('[^']+'|"[^"]+")\s*\]|\exports\s*\.\s*[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*|exports\s*\=/g;

        // global dependency specifier, used for shimmed dependencies
        var globalDependencyRegEx = /["']import ([^'"]+)["']/g;

        var sourceMappingURLRegEx = /\/\/[@#] ?sourceMappingURL=(.+)/;
        var sourceURLRegEx = /\/\/[@#] ?sourceURL=(.+)/;

        var wrapperRegEx = /^\s*export\s*\*\s*from\s*(?:'([^']+)'|"([^"]+)")/;

        // regex to check absolute urls
        var absUrlRegEx = /^\/|([^\:\/]*:\/\/)/;

        // function to remove the comments from a string
        function removeComments(str) {

          // if it is uglified code, skip
          var newlines = str.match(/\n/g);
          var lineCnt = newlines && newlines.length || 0;
          if (str.length / lineCnt > 200)
            return false;

          // output
          // block comments replaced with equivalent whitespace
          // this is to ensure source maps remain valid
          var curOutIndex = 0,
            outString = '',
            blockCommentWhitespace = '';

          // mode variables
          var singleQuote = false,
            doubleQuote = false,
            regex = false,
            blockComment = false,
            doubleBackslash = false,
            lineComment = false;

          // character buffer
          var lastChar;
          var curChar = '';
          var lastToken;

          for (var i = 0, l = str.length; i <= l; i++) {
            lastChar = curChar;
            curChar = str.charAt(i);

            if (curChar === '\n' || curChar === '\r' || curChar === '') {
              regex = doubleQuote = singleQuote = doubleBackslash = false;
              if (lineComment) {
                curOutIndex = i;
                lineComment = false;
              }
              if (blockComment)
                blockCommentWhitespace += curChar;
              lastToken = '';
              continue;
            }

            if (lastChar !== ' ' && lastChar !== '\t')
              lastToken = lastChar;

            if (singleQuote || doubleQuote || regex) {
              if (curChar == '\\' && lastChar == '\\')
                doubleBackslash = !doubleBackslash;
            }

            if (singleQuote) {
              if (curChar === "'" && (lastChar !== '\\' || doubleBackslash))
                singleQuote = doubleBackslash = false;
            }

            else if (doubleQuote) {
              if (curChar === '"' && (lastChar !== '\\' || doubleBackslash))
                doubleQuote = doubleBackslash = false;
            }

            else if (regex) {
              if (curChar === '/' && (lastChar !== '\\' || doubleBackslash)) {
                // a comment inside a regex immediately means we've misread the regex
                // so switch back to block mode to detect the comment
                if (str.charAt(i + 1) == '/') {
                  regex = doubleBackslash = false;
                }
                else {
                  regex = doubleBackslash = false;
                  i++;
                  lastToken = lastChar = curChar;
                  curChar = str.charAt(i);
                }
              }
            }

            else if (blockComment) {
              blockCommentWhitespace += ' ';
              if (curChar === '/' && lastChar === '*' && blockCommentWhitespace.length > 3) {
                blockComment = false;
                curOutIndex = i + 1;
              }
            }

            else if (!lineComment) {
              doubleQuote = curChar === '"';
              singleQuote = curChar === "'";

              if (lastChar !== '/')
                continue;
              
              if (curChar === '*') {
                blockComment = true;
                outString += blockCommentWhitespace + str.substring(curOutIndex, i - 1);
                blockCommentWhitespace = '  ';
              }
              else if (curChar === '/') {
                lineComment = true;
                outString += blockCommentWhitespace + str.substring(curOutIndex, i - 1);
                blockCommentWhitespace = '';
              }
              else if (lastToken !== '}' && lastToken !== ')' && lastToken !== ']' && !lastToken.match(/\w|\d|'|"|\-|\+/)) {
                // detection not perfect - careful comment detection within regex is used to compensate
                // without sacrificing global comment removal accuracy
                regex = true;
              }
            }
          }
          return outString + blockCommentWhitespace + str.substr(curOutIndex);
        }

        // configuration object extension
        // objects extend, everything else replaces
        var extend = function(objA, objB) {
          for (var p in objB) {
            if (typeof objA[p] == 'object' && !(objA[p] instanceof Array))
              extend(objA[p], objB[p])
            else
              objA[p] = objB[p];
          }
        }

        // check if a module name starts with a given prefix
        // the key check is not to match the prefix 'jquery'
        // to the module name jquery-ui/some/thing, and only
        // to jquery/some/thing or jquery:some/thing
        // (multiple ':'s is a module name error)
        var prefixMatch = function(name, prefix) {
          var prefixParts = prefix.split(/[\/:]/);
          var nameParts = name.split(/[\/:]/);
          if (prefixParts.length > nameParts.length)
            return false;
          for (var i = 0; i < prefixParts.length; i++)
            if (nameParts[i] != prefixParts[i])
              return false;
          return true;
        }

        // check if the module is defined on a location
        var getLocation = function(name) {
          var locationParts = name.split(':');

          return locationParts[1] !== undefined && !name.match(absUrlRegEx) ? locationParts[0] : '';
        }

        // given a resolved module name and normalized parent name,
        // apply the map configuration
        var applyMap = function(name, parentName) {
          parentName = parentName || '';
          
          var location = getLocation(name);
          var parentLocation = getLocation(parentName);

          // if there is a parent location, and there is no location, add it here
          if (parentLocation && !location)
            name = parentLocation + ':' + name;

          // check for most specific map config
          var parentPrefixMatch = ''; // the matching parent refix
          var mapPrefixMatch = ''; // the matching map prefix
          var mapMatch = ''; // the matching map value

          for (var p in config.map) {
            var curMap = config.map[p];
            // do the global map check
            if (p == '*')
              continue;
            if (typeof curMap == 'string') {
              if (!prefixMatch(name, p))
                continue;
              if (p.length <= mapPrefixMatch.length)
                continue;
              mapPrefixMatch = p;
              mapMatch = curMap;
            }

            if (!prefixMatch(parentName, p))
              continue;

            // now check if this matches our current name
            for (var _p in curMap) {
              if (!prefixMatch(name, _p))
                continue;

              // the most specific mapPrefix wins first
              if (_p.length < mapPrefixMatch.length)
                continue;

              // then the most specific prefixMatch on the parent name
              if (_p.length == mapPrefixMatch.length && p.length < parentPrefixMatch.length)
                continue;

              parentPrefixMatch = p;
              mapPrefixMatch = _p;
              mapMatch = curMap[_p];
            }
          }
          // now compare against the global map config
          for (var _p in config.map['*'] || {}) {
            if (!prefixMatch(name, _p))
              continue;
            if (_p.length <= mapPrefixMatch.length)
              continue;
            mapPrefixMatch = _p;
            mapMatch = config.map['*'][_p];
          }
          // apply map config
          if (mapPrefixMatch) {
            // get main specifier (#main)
            var main;
            if (mapMatch.indexOf('#') != -1) {
              main = mapMatch.substr(mapMatch.indexOf('#') + 1);
              mapMatch = mapMatch.substr(0, mapMatch.length - main.length - 1);
            }
            name = mapMatch + name.substr(mapPrefixMatch.length) + (name.length == mapPrefixMatch.length && main ? '/' + main : '');
          }

          return name;
        }

        // given a module's global dependencies, prepare the global object
        // to contain the union of the defined properties of its dependent modules
        var globalObj = {};
        function setGlobal(deps) {
          // first, we add all the dependency module properties to the global
          if (deps) {
            for (var i = 0; i < deps.length; i++) {
              var dep = deps[i];
              for (var m in dep)
                jspm.global[m] = dep[m];
            }
          }

          // now we store a complete copy of the global object
          // in order to detect changes
          for (var g in jspm.global) {
            if (jspm.global.hasOwnProperty(g))
              globalObj[g] = jspm.global[g];
          }
        }

        // go through the global object to find any changes
        // the differences become the returned global for this object
        // the global object is left as is
        function getGlobal() {
          var moduleGlobal = {};
          var firstGlobalName;
          var globalCnt = 0;
          for (var g in jspm.global) {
            if (jspm.global.hasOwnProperty(g) && g != (isBrowser ? 'window' : 'global') && globalObj[g] != jspm.global[g]) {
              moduleGlobal[g] = jspm.global[g];
              firstGlobalName = firstGlobalName || g;
              globalCnt++;
            }
          }
          
          // for a single global, return directly
          if (globalCnt == 1)
            return { default: moduleGlobal[firstGlobalName] };
          else
            return moduleGlobal;
        }

        var pluginRegEx = /(\.[^\/\.]+)?!(.*)/;

        var nodeProcess = {
          nextTick: function(f) {
            setTimeout(f, 7);
          }
        };
        var nodeGlobals = ['global', 'exports', 'process', 'require', '__filename', '__dirname', 'module'];



      // -- /helpers --

      var jspm = global.jspm = new global.Loader({
        global: global,
        normalize: function(name, referer) {
          name = name.trim();

          var parentName = referer && referer.name;

          // if it has a js extension, and not a url or plugin, remove the js extension
          if (!pluginMatch && name.substr(name.length - 3, 3) == '.js' && !name.match(absUrlRegEx))
            name = name.substr(0, name.length - 3);

          // check for a plugin (some/name!plugin)
          var pluginMatch = name.match(pluginRegEx);

          // if a plugin, remove the plugin part to do normalization
          var pluginName;
          if (pluginMatch) {
            pluginName = pluginMatch[2] || pluginMatch[1].substr(1);
            name = name.substr(0, name.length - pluginMatch[2].length - 1);
          }

          if (name.substr(0, 1) != '#') {

            // treat an initial '/' as location relative
            if (name.substr(0, 1) == '/')
              name = name.substr(1);

            // do standard normalization (resolve relative module name)
            name = global.System.normalize(name, referer);

            // do map config
            name = applyMap(name, parentName);

          }

          if (pluginName)
            name = name + '!' + pluginName;
          
          return name;
        },
        resolve: function(name, options) {
          var pluginMatch = name.match(pluginRegEx);
          // remove plugin part
          if (pluginMatch)
            name = name.substr(0, name.length - pluginMatch[2].length - 1);

          // ondemand
          for (var r in this.ondemandTable)
            if (this.ondemandTable[r].indexOf(name) != -1)
              return name;

          if (name.match(absUrlRegEx))
            return name;

          // locations
          var oldBaseURL = this.baseURL;

          var location = getLocation(name);
          if (location) {
            if (!config.locations[location])
              throw 'Location "' + location + '" not defined.';
            this.baseURL = config.locations[location];
            name = name.substr(location.length + 1);
          }

          var address = global.System.resolve.call(this, name, options);

          // remove js extension added if a plugin
          if (pluginMatch)
            address = address.substr(0, address.length - 3);

          this.baseURL = oldBaseURL;

          if (location)
            return address;
          else
            // cache bust local
            return address;// + '?' + (new Date()).getTime();
        },
        fetch: function(url, callback, errback, options) {
          options = options || {};
          var pluginMatch = (options.normalized || '').match(pluginRegEx);

          if (!pluginMatch) {
            // do a fetch with a timeout
            var rejected = false;
            if (config.waitSeconds) {
              var waitTime = 0;
              setTimeout(function() {
                waitTime++;
                if (waitTime >= config.waitSeconds) {
                  rejected = true;
                  errback();
                }
              }, 1000);
            }
            global.System.fetch(url, function(source) {
              if (!rejected)
                callback(source);
            }, errback, options);
            return;
          }

          // for plugins, we first need to load the plugin module itself
          var pluginName = pluginMatch[2];
          jspm.import('plugin:' + pluginName, function(plugin) {

            plugin(options.normalized.substr(0, options.normalized.indexOf('!')), url, jspm.fetch, callback, errback);

          });
        },
        link: function(originalSource, options) {
          // plugins provide empty source
          if (!originalSource)
            return new global.Module({});

          var source = originalSource;
          if (config.onLoad)
            config.onLoad(options.normalized, source, options);

          var match;

          // check if it is a "wrapper" module
          // import * from 'jquery';
          if (match = source.match(wrapperRegEx)) {
            return {
              imports: [match[1] || match[2]],
              execute: function(dep) {
                return dep;
              }
            };
          }

          if (source.match(importRegEx) || source.match(exportRegEx) || source.match(moduleRegEx))
            return;

          // detect any source map comments
          var sourceMappingURL = source.match(sourceMappingURLRegEx);
          if (sourceMappingURL)
            sourceMappingURL = sourceMappingURL[1];

          var sourceURL = source.match(sourceURLRegEx);
          sourceURL = sourceURL ? sourceURL[1] : null;

          // remove comments before doing regular expressions
          source = removeComments(source);

          if (!source) {
            // comments not removed - use original source
            source = originalSource;
            // dont add the sourceURL and sourceMappingURL now
            sourceMappingURL = null;
            sourceURL = sourceURL ? null : options.address;
          }
          else
            sourceURL = sourceURL || options.address;

          // depends config
          var _imports = config.depends[options.normalized] ? [].concat(config.depends[options.normalized]) : [];

          // check if this module uses AMD form
          // define([.., .., ..], ...)
          // define('modulename', [.., ..., ..])
          amdDefineRegEx.lastIndex = 0;

          if ((match = amdDefineRegEx.exec(source)) && (match[2] || match[1])) {

            _imports = _imports.concat(eval(match[2] || '[]'));

            // if its a named define, check for any other named defines in this file
            if (match[1]) {
              var defines = [match[1]];
              
              while (match = amdDefineRegEx.exec(source)) {
                if (match[1]) {
                  defines.push(match[1]);
                  _imports = _imports.concat(eval(match[2] || '[]'));
                }
              }

              // ensure imports are unique
              for (var i = 0; i < _imports.length; i++) {
                if (_imports.lastIndexOf(_imports[i]) != i)
                  _imports.splice(i--, 1);
              }

              // run through the defined names and remove them from the imports
              for (var i = 0; i < defines.length; i++) {
                if (_imports.indexOf(defines[i]) != -1)
                  _imports.splice(_imports.indexOf(defines[i]), 1);
              }
            }

            // remove any reserved words
            var requireIndex, exportsIndex, moduleIndex;

            if ((requireIndex = _imports.indexOf('require')) != -1)
              _imports.splice(requireIndex, 1);
            if ((exportsIndex = _imports.indexOf('exports')) != -1)
              _imports.splice(exportsIndex, 1);
            if ((moduleIndex = _imports.indexOf('module')) != -1)
              _imports.splice(moduleIndex, 1);

            return {
              imports: _imports,
              execute: function() {
                var deps = Array.prototype.splice.call(arguments, 0);

                // add system dependencies
                var exports;

                if (moduleIndex != -1)
                  deps.splice(moduleIndex, 0, { id: options.normalized, uri: options.address });
                if (exportsIndex != -1)
                  deps.splice(exportsIndex, 0, exports = {});
                if (requireIndex != -1)
                  deps.splice(requireIndex, 0, function(names, callback, errback) {
                    if (typeof names == 'object' && !(names instanceof Array))
                      return require.apply(null, Array.prototype.splice.call(arguments, 1));

                    return jspm.require(names, callback, errback, { name: options.normalized, address: options.address });
                  });

                var output;

                var g = jspm.global;

                g.require = g.requirejs = jspm.require;
                g.define = function(name, dependencies, factory) {
                  // anonymous define
                  if (typeof name != 'string') {
                    factory = dependencies;
                    name = undefined;
                  }
                  // no dependencies
                  if (!(dependencies instanceof Array))
                    factory = dependencies;

                  // run the factory function
                  if (typeof factory == 'function')
                    output = factory.apply(g, deps);
                  // otherwise factory is the value
                  else
                    output = factory;
                  
                  if (name && name != options.normalized)
                      jspm.set(name, { default: output });
                }
                g.define.amd = {};

                // ensure no NodeJS environment detection
                delete g.module;
                delete g.exports;

                __scopedEval(source, g, sourceURL, sourceMappingURL);

                delete g.define;
                delete g.require;
                delete g.requirejs;

                output = output || exports;

                if (typeof output == 'object' && !(output instanceof Array))
                  return new global.Module(output);
                else
                  return new global.Module({ 'default': output });
              }
            };
          }

          // check if it uses the AMD CommonJS form
          // define(varName); || define(function(require, exports) {}); || define({})
          if (source.match(cjsDefineRegEx)) {
            var match;
            while (match = cjsRequireRegEx.exec(source))
              _imports.push(match[2] || match[3]);

            return {
              imports: _imports,
              execute: function() {
                var depMap = {};
                for (var i = 0; i < _imports.length; i++)
                  depMap[_imports[i]] = arguments[i]['default'] || arguments[i];
                
                var exports = {};
                var module = { id: options.normalized, uri: options.address };

                var g = jspm.global;
                g.require = g.requirejs = jspm.require;

                var output;

                g.define = function(factory) { 
                  output = typeof factory == "function" ? factory.call(g, function(d) { 
                    return depMap[d]; 
                  }, exports) : factory; 
                };
                g.define.amd = {};

                // ensure no NodeJS environment detection
                delete g.module;
                delete g.exports;

                __scopedEval(source, g, sourceURL, sourceMappingURL);

                delete g.require;
                delete g.requirejs;
                delete g.define;

                output = output || exports;

                if (typeof output == 'object' && !(output instanceof Array))
                  return new global.Module(output);
                else
                  return new global.Module({ 'default': output });
              }
            };
          }
          
          // CommonJS
          // require('...') || exports[''] = ... || exports.asd = ... || module.exports = ...
          if (source.match(cjsExportsRegEx) || source.match(cjsRequireRegEx)) {
            var match;
            while (match = cjsRequireRegEx.exec(source))
              _imports.push(match[2] || match[3]);

            return {
              imports: _imports, // clone the array as we still need it
              execute: function() {
                var depMap = {};
                for (var i = 0; i < _imports.length; i++)
                  depMap[_imports[i]] = arguments[i]['default'] || arguments[i];

                var dirname = options.address.split('/');
                dirname.pop();
                dirname = dirname.join('/');

                var g = jspm.global;

                g.global = g;
                g.exports = {};
                g.process = nodeProcess;
                g.require = function(d) {
                  return depMap[d];
                }
                g.__filename = options.address;
                g.__dirname = dirname;
                g.module = {
                  exports: g.exports
                };

                __scopedEval(source, g, sourceURL, sourceMappingURL);

                var outModule;

                if (typeof g.module.exports == 'object' && !(g.module.exports instanceof Array))
                  outModule = new global.Module(g.module.exports);
                else
                  outModule = new global.Module({ 'default': g.module.exports });

                for (var p in nodeGlobals)
                  delete g[p];

                return outModule;
              }
            };
          }

          // global script
          
          // check for global shimmed dependencies
          // specified with eg:
          // "import lib:jquery";
          while (match = globalDependencyRegEx.exec(source))
            _imports.push(match[1]);

          return {
            // apply depends config
            imports: _imports,
            execute: function() {
              setGlobal(arguments);
              __scopedEval(source, jspm.global, sourceURL, sourceMappingURL);

              return new global.Module(getGlobal());
            }
          };
        }
      });

      var _import = jspm.import;
      jspm.import = function(name, callback, errback, referer) {
        _import.call(jspm, name, function() {          
          var newArgs = [];
          for (var i = 0; i < arguments.length; i++) {
            var isDefaultOnly = true;
            for (var q in arguments[i])
              if (arguments[i].hasOwnProperty(q)) {
                if (q != 'default') {
                  isDefaultOnly = false;
                  break;
                }
              }
            if (isDefaultOnly && arguments[i] && arguments[i].default)
              newArgs[i] = arguments[i].default;
            else
              newArgs[i] = arguments[i];
          }
          if (callback)
            callback.apply(null, newArgs);
        }, errback, referer);
      }

      jspm.baseURL = config.baseURL;

      // ondemand functionality
      jspm.ondemandTable = {};
      jspm.ondemand = global.System.ondemand;

      jspm._config = config;
      jspm.config = function(newConfig) {
        if (newConfig.paths)
          extend(newConfig.map = newConfig.map || {}, newConfig.paths);

        extend(config, newConfig);

        if (newConfig.baseURL)
          jspm.baseURL = newConfig.baseURL;
        if (newConfig.baseUrl)
          jspm.baseURL = newConfig.baseUrl;

        if (newConfig.localLibs)
          for (var l in config.locations)
            config.locations[l] = newConfig.localLibs + '/' + l;
      }
      jspm.ondemand = function(resolvers) {
        jspm.ondemand(resolvers);
      }

      /*
        AMD & CommonJS-compatible require
        To copy RequireJS, set window.require = window.requirejs = jspm.require
      */
      jspm.require = function(names, callback, errback, referer) {
        // in amd, first arg can be a config object
        if (typeof names == 'object' && !(names instanceof Array)) {
          jspm.config(names);
          return jspm.require.apply(null, Array.prototype.splice.call(arguments, 1));
        }

        if (typeof callback == 'object') {
          referer = callback;
          callback = undefined;
        }
        else if (typeof errback == 'object') {
          referer = errback;
          errback = undefined;
        }

        // amd require
        if (names instanceof Array)
          return jspm.import(names, callback, errback, referer);
        
        // commonjs require
        else if (typeof names == 'string')
          return jspm.get(names);

        else
          throw 'Invalid require';
      }
      jspm.require.config = jspm.config;

      // add convenience locations
      jspm.config({
        locations: {
          github: 'https://github.jspm.io',
          npm: 'https://npm.jspm.io',
          cdnjs: 'https://cdnjs.cloudflare.com/ajax/libs',
          lib: 'https://registry.jspm.io',
          plugin: 'https://github.jspm.io/jspm/plugins@0.0.7'
        }
      });

      // add initial config
      jspm.config(startConfig);

      if (!isBrowser)
        module.exports = jspm;
    }

    // dynamically polyfill the es6 loader if necessary
    if (!global.Loader) {
      if (isBrowser) {
        // determine the current script path as the base path
        var scripts = document.getElementsByTagName('script');
        var head = document.getElementsByTagName('head')[0];
        var curPath = scripts[scripts.length - 1].src;
        var basePath = curPath.substr(0, curPath.lastIndexOf('/') + 1);
        document.write(
          '<' + 'script type="text/javascript" src="' + basePath + 'es6-module-loader.js">' + '<' + '/script>' +
          '<' + 'script type="text/javascript">' + 'createLoader();' + '<' + '/script>'
        );
      }
      else {
        var es6ModuleLoader = require('es6-module-loader');
        global.System = es6ModuleLoader.System;
        global.Loader = es6ModuleLoader.Loader;
        global.Module = es6ModuleLoader.Module;
        global.createLoader();
      }
    }
    else
      createLoader();

  })();

  // carefully scoped eval with given global
  var __scopedEval = function(__source, global, __sourceURL, __sourceMappingURL) {
    eval('(function(global) { with(global) { ' + __source + ' \n } }).call(global, global);' + (__sourceMappingURL 
      ? '\n//# sourceMappingURL=' + __sourceMappingURL 
      : (__sourceURL ? '\n//# sourceURL=' + __sourceURL : '')));
  }

})();

