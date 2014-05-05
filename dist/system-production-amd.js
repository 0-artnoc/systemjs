/*
 * SystemJS
 * 
 * Copyright (c) 2013 Guy Bedford
 * MIT License
 */

(function(__$global) {

// indexOf polyfill for IE
var indexOf = Array.prototype.indexOf || function(item) {
  for (var i = 0, l = this.length; i < l; i++)
    if (this[i] === item)
      return i;
  return -1;
}

__$global.upgradeSystemLoader = function() {
  __$global.upgradeSystemLoader = undefined;/*
 * SystemJS Core
 * Code should be vaguely readable
 * 
 */
function core(loader) {
  (function() {

    /*
      __useDefault
      
      When a module object looks like:
      Module({
        __useDefault: true,
        default: 'some-module'
      })

      Then importing that module provides the 'some-module'
      result directly instead of the full module.

      Useful for eg module.exports = function() {}
    */
    var loaderImport = loader['import'];
    loader['import'] = function(name, options) {
      return loaderImport.call(this, name, options).then(function(module) {
        return module.__useDefault ? module['default'] : module;
      });
    }

    // support the empty module, as a concept
    loader.set('@empty', Module({}));

    /*
      Config
      Extends config merging one deep only

      loader.config({
        some: 'random',
        config: 'here',
        deep: {
          config: { too: 'too' }
        }
      });

      <=>

      loader.some = 'random';
      loader.config = 'here'
      loader.deep = loader.deep || {};
      loader.deep.config = { too: 'too' };
    */
    loader.config = function(cfg) {
      for (var c in cfg) {
        var v = cfg[c];
        if (typeof v == 'object') {
          this[c] = this[c] || {};
          for (var p in v)
            this[c][p] = v[p];
        }
        else
          this[c] = v;
      }
    }

    // override locate to allow baseURL to be document-relative
    var baseURI;
    if (typeof window == 'undefined') {
      baseURI = __dirname + '/';
    }
    else {
      baseURI = document.baseURI;
      if (!baseURI) {
        var bases = document.getElementsByTagName('base');
        baseURI = bases[0] && bases[0].href || window.location.href;
      }
    }
    var loaderLocate = loader.locate;
    var normalizedBaseURL;
    loader.locate = function(load) {
      if (this.baseURL != normalizedBaseURL) {
        normalizedBaseURL = toAbsoluteURL(baseURI, this.baseURL);

        if (normalizedBaseURL.substr(normalizedBaseURL.length - 1, 1) != '/')
          normalizedBaseURL += '/';

        this.baseURL = normalizedBaseURL;
      }

      return Promise.resolve(loaderLocate.call(this, load));
    }


    // Traceur conveniences
    var aliasRegEx = /^\s*export\s*\*\s*from\s*(?:'([^']+)'|"([^"]+)")/;
    var es6RegEx = /(?:^\s*|[}{\(\);,\n]\s*)(import\s+['"]|(import|module)\s+[^"'\(\)\n;]+\s+from\s+['"]|export\s+(\*|\{|default|function|var|const|let|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*))/;

    var loaderTranslate = loader.translate;
    loader.translate = function(load) {
      var loader = this;

      loader.__exec = exec;

      // support ES6 alias modules ("export * from 'module';") without needing Traceur
      var match;
      if (!loader.global.traceur && (load.metadata.format == 'es6' || !load.metadata.format) && (match = load.source.match(aliasRegEx))) {
        var depName = match[1] || match[2];
        load.metadata.deps = [depName];
        load.metadata.execute = function(require) {
          return require(depName);
        }
      }

      // detect ES6
      if (load.metadata.format == 'es6' || !load.metadata.format && load.source.match(es6RegEx)) {
        load.metadata.format = 'es6';

        // dynamically load Traceur for ES6 if necessary
        if (!loader.global.traceur)
          return loader['import']('@traceur').then(function() {
            return loaderTranslate.call(loader, load);
          });
      }

      return loaderTranslate.call(loader, load);
    }

    // always load Traceur as a global
    var loaderInstantiate = loader.instantiate;
    loader.instantiate = function(load) {
      var loader = this;
      if (load.name == '@traceur') {
        loader.__exec(load);
        return {
          deps: [],
          execute: function() {}
        };
      }
      return loaderInstantiate.call(loader, load);
    }


    // define exec for easy evaluation of a load record (load.name, load.source, load.address)
    // main feature is source maps support handling
    var curSystem
    function exec(load) {
      if (load.name == '@traceur')
        curSystem = System;
      // support sourceMappingURL (efficiently)
      var sourceMappingURL;
      var lastLineIndex = load.source.lastIndexOf('\n');
      if (lastLineIndex != -1) {
        if (load.source.substr(lastLineIndex + 1, 21) == '//# sourceMappingURL=')
          sourceMappingURL = toAbsoluteURL(load.address, load.source.substr(lastLineIndex + 22));
      }

      __eval(load.source, this.global, load.address, sourceMappingURL);

      // traceur overwrites System - write it back
      if (load.name == '@traceur') {
        this.global.traceurSystem = this.global.System;
        this.global.System = curSystem;
      }
    }
    loader.__exec = exec;

    // Absolute URL parsing, from https://gist.github.com/Yaffle/1088850
    function parseURI(url) {
      var m = String(url).replace(/^\s+|\s+$/g, '').match(/^([^:\/?#]+:)?(\/\/(?:[^:@]*(?::[^:@]*)?@)?(([^:\/?#]*)(?::(\d*))?))?([^?#]*)(\?[^#]*)?(#[\s\S]*)?/);
      // authority = '//' + user + ':' + pass '@' + hostname + ':' port
      return (m ? {
        href     : m[0] || '',
        protocol : m[1] || '',
        authority: m[2] || '',
        host     : m[3] || '',
        hostname : m[4] || '',
        port     : m[5] || '',
        pathname : m[6] || '',
        search   : m[7] || '',
        hash     : m[8] || ''
      } : null);
    }
    function toAbsoluteURL(base, href) {
      function removeDotSegments(input) {
        var output = [];
        input.replace(/^(\.\.?(\/|$))+/, '')
          .replace(/\/(\.(\/|$))+/g, '/')
          .replace(/\/\.\.$/, '/../')
          .replace(/\/?[^\/]*/g, function (p) {
            if (p === '/..')
              output.pop();
            else
              output.push(p);
        });
        return output.join('').replace(/^\//, input.charAt(0) === '/' ? '/' : '');
      }

      href = parseURI(href || '');
      base = parseURI(base || '');

      return !href || !base ? null : (href.protocol || base.protocol) +
        (href.protocol || href.authority ? href.authority : base.authority) +
        removeDotSegments(href.protocol || href.authority || href.pathname.charAt(0) === '/' ? href.pathname : (href.pathname ? ((base.authority && !base.pathname ? '/' : '') + base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1) + href.pathname) : base.pathname)) +
        (href.protocol || href.authority || href.pathname ? href.search : (href.search || base.search)) +
        href.hash;
    }

  })();

  function __eval(__source, __global, __address, __sourceMap) {
    try {
      __source = 'with(__global) { (function() { ' + __source + ' \n }).call(__global); }'
        + '\n//# sourceURL=' + __address
        + (__sourceMap ? '\n//# sourceMappingURL=' + __sourceMap : '');
      eval(__source);
    }
    catch(e) {
      if (e.name == 'SyntaxError')
        e.message = 'Evaluating ' + __address + '\n\t' + e.message;
      throw e;
    }
  }
}
/*
 * Instantiate registry extension
 *
 * Supports Traceur System.register 'instantiate' output for loading ES6 as ES5.
 *
 * - Creates the loader.register function
 * - Also supports metadata.format = 'register' in instantiate for anonymous register modules
 * - Also supports metadata.deps, metadata.execute and metadata.executingRequire
 *     for handling dynamic modules alongside register-transformed ES6 modules
 *
 * Works as a standalone extension provided there is a
 * loader.__exec(load) like the one set in SystemJS core
 *
 */

function register(loader) {
  if (typeof indexOf == 'undefined')
    indexOf = Array.prototype.indexOf;
  if (!loader.__exec)
    throw "loader.__exec(load) needs to be provided for loader.register. See SystemJS core for an implementation example.";

  function dedupe(deps) {
    var newDeps = [];
    for (var i = 0; i < deps.length)
      if (indexOf.call(newDeps, deps[i]) == -1)
        newDeps.push(deps[i])
    return newDeps;
  }

  // Registry side table
  // Registry Entry Contains:
  //    - deps 
  //    - declare for register modules
  //    - execute for dynamic modules, also after declare for register modules
  //    - declarative boolean indicating which of the above
  //    - normalizedDeps derived from deps, created in instantiate
  //    - depMap array derived from deps, populated gradually in link
  //    - groupIndex used by group linking algorithm
  //    - module a raw module exports object with no wrapper
  //    - evaluated indiciating whether evaluation has happend for declarative modules
  // After linked and evaluated, entries are removed
  var lastRegister;
  function register(name, deps, declare) {
    if (declare.length == 0)
      throw 'Invalid System.register form. Ensure setting --modules=instantiate if using Traceur.';

    loader.defined = loader.defined || {};

    if (typeof name != 'string') {
      declare = deps;
      deps = name;
      name = null;
    }

    lastRegister = {
      deps: deps,
      declare: declare,
      declarative: true
    };

    if (name)
      loader.defined[name] = lastRegister;
  }
  loader.register = register;

  function buildGroups(entry, loader, groups) {

    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0; i < entry.normalizedDeps.length; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = loader.defined[depName];
      
      // not in the registry means already linked / ES6
      if (!depEntry)
        continue;
      
      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      if (depEntry.groupIndex === undefined) {
        depEntry.groupIndex = depGroupIndex;
      }
      else if (depEntry.groupIndex != depGroupIndex) {
        throw new TypeError('System.register mixed dependency cycle');
      }

      buildGroups(entry, loader, groups);
    }
  }

  function link(name, loader) {
    var startEntry = loader.defined[name];

    startEntry.groupIndex = 0;

    var groups = buildGroups(name, loader, []);

    var curGroupDeclarative = startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry, loader);
        else
          linkDynamicModule(entry, loader);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  function linkDeclarativeModule(entry, loader) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    // declare the module with an empty depMap
    var depMap = [];

    var declaration = load.declare.call(loader.global, depMap);
    
    entry.module = declaration.exports;
    entry.exportStar = declaration.exportStar;
    entry.execute = declaration.execute;

    var module = entry.module;

    // now link all the module dependencies
    // amending the depMap as we go
    for (var i = 0; i < entry.normalizedDeps.length; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = loader.defined[depName];
      
      // part of another linking group - use loader.get
      if (!depEntry) {
        depModule = loader.get(depName);
      }
      // if dependency already linked, use that
      else if (depEntry.module) {
        depModule = depEntry.module;
      }
      // otherwise we need to link the dependency
      else {
        linkDeclarativeModule(depEntry, loader);
        depModule = depEntry.module;
      }

      if (entry.exportStar && indexOf.call(entry.exportStar, entry.normalizedDeps[i]) != -1) {
        // we are exporting * from this dependency
        (function(depModule) {
          for (var p in depModule) (function(p) {
            // if the property is already defined throw?
            Object.defineProperty(module, p, {
              enumerable: true,
              get: function() {
                return depModule[p];
              },
              set: function(value) {
                depModule[p] = value;
              }
            });
          })(p);
        })(depModule);
      }

      depMap[i] = depModule;
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name, loader) {
    var entry = loader.defined[name];

    if (!entry)
      return loader.get(name);

    if (entry.declarative)
      ensureEvaluated(name, [], loader);
    
    else if (!entry.evaluated)
      linkDynamicModule(entry, loader);

    return entry.module;
  }

  function linkDynamicModule(entry, loader) {
    if (entry.module)
      return;

    entry.module = {};

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0; i < entry.normalizedDeps.length; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = loader.defined[depName];
        linkDynamicModule(depEntry, loader);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute(function(name) {
      for (var i = 0; i < entry.deps.length; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i], loader);
      }
    }, entry.module, name);
    
    if (output)
      entry.module = output;
  }

  // given a module, and the list of modules for this current branch,
  // ensure that each of the dependencies of this module is evaluated
  //  (unless one is a circular dependency already in the list of seen
  //   modules, in which case we execute it)
  // then evaluate the module itself
  // depth-first left to right execution to match ES6 modules
  function ensureEvaluated(moduleName, seen, loader) {
    var entry = loader.defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry.declarative || entry.evaluated || indexOf.call(seen, moduleName) != -1)
      return;

    seen.push(moduleName);

    for (var i = 0; i < entry.normalizedDeps.length; i++) {
      var depName = entry.normalizedDeps[i];
      
      // circular -> execute now if not already executed
      if (indexOf.call(seen, depName) != -1) {
        var depEntry = loader.defined[depName];
        if (depEntry && !depEntry.evaluated) {
          depEntry.execute.call(loader.global);
          delete depEntry.execute;
        }
      }
      // in turn ensure dependencies are evaluated
      else
        ensureEvaluated(depName, seen);
    }

    // we've evaluated all dependencies so evaluate this module now
    entry.execute.call(loader.global);
    entry.evaluated = true;
  }

  var registerRegEx = /asdf/;


  var loaderTranslate = loader.translate;
  loader.translate = function(load) {
    loader.register = register;

    // run detection for register format here
    if (load.metadata.format == 'register' || !load.metadata.format && load.source.match(registerRegEx))
      load.metadata.format = 'register';

    load.metadata.deps = [];
    return loaderTranslate.call(this, load);
  }


  var loaderInstantiate = loader.instantiate;
  loader.instantiate = function(load) {
    var loader = this;

    var entry;
    
    if (loader.defined[load.name])
      entry = loader.defined[load.name];

    else if (load.metadata.execute) {
      entry = {
        deps: load.metadata.deps || [],
        execute: load.metadata.execute,
        executingRequire: load.metadata.executingRequire // NodeJS-style requires or not
      };
    }
    else if (load.metadata.format == 'register') {
      lastRegister = null;
      loader.__exec(load);

      // for a bundle, take the last defined module
      // in the bundle to be the bundle itself
      if (lastRegister)
        entry = lastRegister;
    }

    if (!entry)
      return loaderInstantiate.call(this, load);


    // first, normalize all dependencies
    var normalizePromises = [];
    for (var i = 0; i < deps.length; i++)
      normalizePromises.push(Promise.resolve(loader.normalize(deps[i], load.name)));
   
    return Promise.all(normalizePromises).then(function(normalizedDeps) {

      entry.normalizedDeps = normalizedDeps;

      // create the empty dep map - this is our key deferred dependency binding object passed into declare
      entry.depMap = [];

      entry.deps = dedupe(entry.deps);

      return {
        deps: entry.deps,
        execute: function() {
          // recursively ensure that the module and all its 
          // dependencies are linked (with dependency group handling)
          link(load.name, loader);

          // now handle dependency execution in correct order
          ensureEvaluated(load.name, [], loader);

          // remove from the registry
          delete loader.defined[load.name];

          var module = Module(entry.module);

          // if the entry is an alias, set the alias too
          for (var name in loader.defined) {
            if (loader.defined[name].execute != entry.execute)
              continue;
            if (!loader.has(name))
              loader.set(name, module);
          }

          // return the defined module object
          return module;
        }
      };
    });
  }
}
/*
 * Script tag fetch
 */

function scriptLoader(loader) {
  if (typeof indexOf == 'undefined')
    indexOf = Array.prototype.indexOf;

  var head = document.getElementsByTagName('head')[0];

  // override fetch to use script injection
  loader.fetch = function(load) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.async = true;
      s.addEventListener('load', function(evt) {
        resolve('');
      }, false);
      s.addEventListener('error', function(err) {
        reject(err);
      }, false);
      s.src = load.address;
      head.appendChild(s);
    });
  }
}
/*
  SystemJS map support
  
  Provides map configuration through
    System.map['jquery'] = 'some/module/map'

  As well as contextual map config through
    System.map['bootstrap'] = {
      jquery: 'some/module/map2'
    }

  Note that this applies for subpaths, just like RequireJS

  jquery      -> 'some/module/map'
  jquery/path -> 'some/module/map/path'
  bootstrap   -> 'bootstrap'

  Inside any module name of the form 'bootstrap' or 'bootstrap/*'
    jquery    -> 'some/module/map2'
    jquery/p  -> 'some/module/map2/p'

  Maps are carefully applied from most specific contextual map, to least specific global map
*/
function map(loader) {
  loader.map = loader.map || {};


  // return the number of prefix parts (separated by '/') matching the name
  // eg prefixMatchLength('jquery/some/thing', 'jquery') -> 1
  function prefixMatchLength(name, prefix) {
    var prefixParts = prefix.split('/');
    var nameParts = name.split('/');
    if (prefixParts.length > nameParts.length)
      return 0;
    for (var i = 0; i < prefixParts.length; i++)
      if (nameParts[i] != prefixParts[i])
        return 0;
    return prefixParts.length;
  }


  // given a relative-resolved module name and normalized parent name,
  // apply the map configuration
  function applyMap(name, parentName, loader) {

    var curMatch, curMatchLength = 0;
    var curParent, curParentMatchLength = 0;
    var subPath;
    var nameParts;
    
    // first find most specific contextual match
    if (parentName) {
      for (var p in loader.map) {
        var curMap = loader.map[p];
        if (typeof curMap != 'object')
          continue;

        // most specific parent match wins first
        if (prefixMatchLength(parentName, p) <= curParentMatchLength)
          continue;

        for (var q in curMap) {
          // most specific name match wins
          if (prefixMatchLength(name, q) <= curMatchLength)
            continue;

          curMatch = q;
          curMatchLength = q.split('/').length;
          curParent = p;
          curParentMatchLength = p.split('/').length;
        }
      }
    }

    // if we found a contextual match, apply it now
    if (curMatch) {
      nameParts = name.split('/');
      subPath = nameParts.splice(curMatchLength, nameParts.length - curMatchLength).join('/');
      name = loader.map[curParent][curMatch] + (subPath ? '/' + subPath : '');
      curMatchLength = 0;
    }

    // now do the global map
    for (var p in loader.map) {
      var curMap = loader.map[p];
      if (typeof curMap != 'string')
        continue;

      if (prefixMatchLength(name, p) <= curMatchLength)
        continue;

      curMatch = p;
      curMatchLength = p.split('/').length;
    }
    
    // return a match if any
    if (!curMatchLength)
      return name;
    
    nameParts = name.split('/');
    subPath = nameParts.splice(curMatchLength, nameParts.length - curMatchLength).join('/');
    return loader.map[curMatch] + (subPath ? '/' + subPath : '');
  }

  var loaderNormalize = loader.normalize;
  loader.normalize = function(name, parentName, parentAddress) {
    var loader = this;
    if (!loader.map)
      loader.map = {};
    return Promise.resolve(loaderNormalize.call(loader, name, parentName, parentAddress))
    .then(function(name) {
      return applyMap(name, parentName, loader);
    });
  }
}
/*
  System bundles

  Allows a bundle module to be specified which will be dynamically 
  loaded before trying to load a given module.

  For example:
  System.bundles['mybundle'] = ['jquery', 'bootstrap/js/bootstrap']

  Will result in a load to "mybundle" whenever a load to "jquery"
  or "bootstrap/js/bootstrap" is made.

  In this way, the bundle becomes the request that provides the module
*/

function bundles(loader) {
  if (typeof indexOf == 'undefined')
    indexOf = Array.prototype.indexOf;

  // bundles support (just like RequireJS)
  // bundle name is module name of bundle itself
  // bundle is array of modules defined by the bundle
  // when a module in the bundle is requested, the bundle is loaded instead
  // of the form System.bundles['mybundle'] = ['jquery', 'bootstrap/js/bootstrap']
  loader.bundles = loader.bundles || {};

  var loaderFetch = loader.fetch;
  loader.fetch = function(load) {
    if (!loader.bundles)
      loader.bundles = {};

    // if this module is in a bundle, load the bundle first then
    for (var b in loader.bundles) {
      if (indexOf.call(loader.bundles[b], load.name) == -1)
        continue;
      // we do manual normalization in case the bundle is mapped
      // this is so we can still know the normalized name is a bundle
      return Promise.resolve(loader.normalize(b))
      .then(function(normalized) {
        loader.bundles[normalized] = loader.bundles[normalized] || loader.bundles[b];
        return loader.load(normalized);
      })
      .then(function() {
        return '';
      });
    }
    return loaderFetch.apply(this, arguments);
  }
}/*
  SystemJS Semver Version Addon
  
  1. Uses Semver convention for major and minor forms

  Supports requesting a module from a package that contains a version suffix
  with the following semver ranges:
    module       - any version
    module@1     - major version 1, any minor (not prerelease)
    module@1.2   - minor version 1.2, any patch (not prerelease)
    module@1.2.3 - exact version

  It is assumed that these modules are provided by the server / file system.

  First checks the already-requested packages to see if there are any packages 
  that would match the same package and version range.

  This provides a greedy algorithm as a simple fix for sharing version-managed
  dependencies as much as possible, which can later be optimized through version
  hint configuration created out of deeper version tree analysis.
  
  2. Semver-compatibility syntax (caret operator - ^)

  Compatible version request support is then also provided for:

    module@^1.2.3        - module@1, >=1.2.3
    module@^1.2          - module@1, >=1.2.0
    module@^1            - module@1
    module@^0.5.3        - module@0.5, >= 0.5.3
    module@^0.0.1        - module@0.0.1

  The ^ symbol is always normalized out to a normal version request.

  This provides comprehensive semver compatibility.
  
  3. System.versions version hints and version report

  Note this addon should be provided after all other normalize overrides.

  The full list of versions can be found at System.versions providing an insight
  into any possible version forks.

  It is also possible to create version solution hints on the System global:

  System.versions = {
    jquery: ['1.9.2', '2.0.3'],
    bootstrap: '3.0.1'
  };

  Versions can be an array or string for a single version.

  When a matching semver request is made (jquery@1.9, jquery@1, bootstrap@3)
  they will be converted to the latest version match contained here, if present.

  Prereleases in this versions list are also allowed to satisfy ranges when present.
*/

function versions(loader) {
  if (typeof indexOf == 'undefined')
    indexOf = Array.prototype.indexOf;

  // match x, x.y, x.y.z, x.y.z-prerelease.1
  var semverRegEx = /^(\d+)(?:\.(\d+)(?:\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?)?)?$/;

  var semverCompare = function(v1, v2) {
    var v1Parts = v1.split('.');
    var v2Parts = v2.split('.');
    var prereleaseIndex;
    if (v1Parts[2] && (prereleaseIndex = indexOf.call(v1Parts[2], '-')) != -1)
      v1Parts.splice(2, 1, v1Parts[2].substr(0, prereleaseIndex), v1Parts[2].substr(prereleaseIndex + 1));
    if (v2Parts[2] && (prereleaseIndex = indexOf.call(v2Parts[2], '-')) != -1)
      v2Parts.splice(2, 1, v2Parts[2].substr(0, prereleaseIndex), v2Parts[2].substr(prereleaseIndex + 1));
    for (var i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      if (!v1Parts[i])
        return 1;
      else if (!v2Parts[i])
        return -1;
      if (v1Parts[i] != v2Parts[i])
        return parseInt(v1Parts[i]) > parseInt(v2Parts[i]) ? 1 : -1;
    }
    return 0;
  }  
  

  loader.versions = loader.versions || {};

  var loaderNormalize = loader.normalize;
  loader.normalize = function(name, parentName, parentAddress) {
    if (!loader.versions)
      loader.versions = {};
    var packageVersions = this.versions;
    // run all other normalizers first
    return Promise.resolve(loaderNormalize.call(this, name, parentName, parentAddress)).then(function(normalized) {
      
      var version, semverMatch, nextChar, versions;
      var index = normalized.indexOf('@');

      // see if this module corresponds to a package already in our versioned packages list
      
      // no version specified - check against the list (given we don't know the package name)
      if (index == -1) {
        for (var p in packageVersions) {
          versions = packageVersions[p];
          if (normalized.substr(0, p.length) != p)
            continue;

          nextChar = normalized.substr(p.length, 1);

          if (nextChar && nextChar != '/')
            continue;

          // match -> take latest version
          return p + '@' + (typeof versions == 'string' ? versions : versions[versions.length - 1]) + normalized.substr(p.length);
        }
        return normalized;
      }

      // get the version info
      version = normalized.substr(index + 1).split('/')[0];
      var versionLength = version.length;

      var minVersion;
      if (version.substr(0, 1) == '^') {
        version = version.substr(1);
        minVersion = true;
      }

      semverMatch = version.match(semverRegEx);

      // if not a semver, we cant help
      if (!semverMatch)
        return normalized;

      // translate '^' in range to simpler range form
      if (minVersion) {
        // ^0 -> 0
        // ^1 -> 1
        if (!semverMatch[2])
          minVersion = false;
        
        if (!semverMatch[3]) {
          
          // ^1.1 -> ^1.1.0
          if (semverMatch[2] > 0)
            semverMatch[3] = '0';

          // ^0.1 -> 0.1
          // ^0.0 -> 0.0
          else
            minVersion = false;
        }
      }

      if (minVersion) {
        // >= 1.0.0
        if (semverMatch[1] > 0) {
          if (!semverMatch[2])
            version = semverMatch[1] + '.0.0';
          if (!semverMatch[3])
            version = semverMatch[1] + '.0';
          minVersion = version;
          semverMatch = [semverMatch[1]];
        }
        // >= 0.1.0
        else if (semverMatch[2] > 0) {
          minVersion = version;
          semverMatch = [0, semverMatch[2]];
        }
        // >= 0.0.0
        else {
          // NB compatible with prerelease is just prelease itself?
          minVersion = false;
          semverMatch = [0, 0, semverMatch[3]];
        }
        version = semverMatch.join('.');
      }

      var packageName = normalized.substr(0, index);

      versions = packageVersions[packageName] || [];

      if (typeof versions == 'string')
        versions = [versions];

      // look for a version match
      // if an exact semver, theres nothing to match, just record it
      if (!semverMatch[3] || minVersion)
        for (var i = versions.length - 1; i >= 0; i--) {
          var curVersion = versions[i];
          // if I have requested x.y, find an x.y.z-b
          // if I have requested x, find any x.y / x.y.z-b
          if (curVersion.substr(0, version.length) == version && curVersion.substr(version.length, 1).match(/^[\.\-]?$/)) {
            // if a minimum version, then check too
            if (!minVersion || minVersion && semverCompare(curVersion, minVersion) != -1)
              return packageName + '@' + curVersion + normalized.substr(packageName.length + versionLength + 1);
          }
        }

      // no match
      // record the package and semver for reuse since we're now asking the server
      // x.y and x versions will now be latest by default, so they are useful in the version list
      if (indexOf.call(versions, version) == -1) {
        versions.push(version);
        versions.sort(semverCompare);

        normalized = packageName + '@' + version + normalized.substr(packageName.length + versionLength + 1);

        // if this is an x.y.z, remove any x.y, x
        // if this is an x.y, remove any x
        if (semverMatch[3] && (index = indexOf.call(versions, semverMatch[1] + '.' + semverMatch[2])) != -1)
          versions.splice(index, 1);
        if (semverMatch[2] && (index = indexOf.call(versions, semverMatch[1])) != -1)
          versions.splice(index, 1);

        packageVersions[packageName] = versions.length == 1 ? versions[0] : versions;
      }

      return normalized;
    });
  }
}
core(System);
register(System);
scriptLoader(System);
map(System);
bundles(System);
versions(System);
  System.baseURL = __$curScript.getAttribute('data-baseurl') || System.baseURL;

  var configPath = __$curScript.getAttribute('data-config');
  if (configPath === '')
    configPath = System.baseURL + 'config.json';

  var main = __$curScript.getAttribute('data-main');

  (!configPath ? Promise.resolve() :
    Promise.resolve(System.fetch.call(System, { address: configPath, metadata: {} }))
    .then(JSON.parse)
    .then(System.config)
  ).then(function() {
    if (main)
      return System['import'](main);
  })
  ['catch'](function(e) {
    setTimeout(function() {
      throw e;
    })
  });

};

var __$curScript;

(function(global) {
  if (typeof window != 'undefined') {
    var scripts = document.getElementsByTagName('script');
    __$curScript = scripts[scripts.length - 1];

    if (!global.System || global.System.registerModule) {
      // determine the current script path as the base path
      var curPath = __$curScript.src;
      var basePath = curPath.substr(0, curPath.lastIndexOf('/') + 1);
      document.write(
        '<' + 'script type="text/javascript" src="' + basePath + 'es6-module-loader.js" data-init="upgradeSystemLoader">' + '<' + '/script>'
      );
    }
    else {
      global.upgradeSystemLoader();
    }
  }
  else {
    var es6ModuleLoader = require('es6-module-loader');
    global.System = es6ModuleLoader.System;
    global.Loader = es6ModuleLoader.Loader;
    global.Module = es6ModuleLoader.Module;
    module.exports = global.System;
    global.upgradeSystemLoader();
  }
})(__$global);

})(typeof window != 'undefined' ? window : global);