/*
 * Extension to detect ES6 and auto-load Traceur or Babel for processing
 */
function es6(loader) {

  loader._extensions.push(es6);

  var autoLoadTranspiler = typeof window !== 'undefined' || typeof WorkerGlobalScope !== 'undefined';

  // auto-detection of paths to loader transpiler files
  var scriptBase;
  if ($__curScript && $__curScript.src)
    scriptBase = $__curScript.src.substr(0, $__curScript.src.lastIndexOf('/') + 1);
  else
    scriptBase = loader.baseURL + (loader.baseURL.lastIndexOf('/') == loader.baseURL.length - 1 ? '' : '/');

  function setConfig(module) {
    loader.meta[module] = { format: 'global', build: false };

    if (loader.paths[module])
      return;
    loader.paths[module] = $__curScript && $__curScript.getAttribute('data-' + module.substr(1) + '-src') || scriptBase + module.substr(1) + '.js';
  }
  
  setConfig('@traceur');
  setConfig('@traceur-runtime');
  setConfig('@babel');
  setConfig('@babel-helpers');
  loader.meta['@traceur'].exports = 'traceur';

  // good enough ES6 detection regex - format detections not designed to be accurate, but to handle the 99% use case
  var es6RegEx = /(^\s*|[}\);\n]\s*)(import\s+(['"]|(\*\s+as\s+)?[^"'\(\)\n;]+\s+from\s+['"]|\{)|export\s+\*\s+from\s+["']|export\s+(\{|default|function|class|var|const|let|async\s+function))/;

  var loaderTranslate = loader.translate;
  loader.translate = function(load) {
    var loader = this;

    return loaderTranslate.call(loader, load)
    .then(function(source) {

      // detect ES6
      if (load.metadata.format == 'es6' || !load.metadata.format && source.match(es6RegEx)) {
        load.metadata.format = 'es6';

        // dynamically load transpiler for ES6 if necessary
        if (autoLoadTranspiler && !$__global[loader.transpiler])
          return loader['import']('@' + loader.transpiler).then(function() {
            return source;
          });
      }

      // ensure Traceur doesn't clobber the System global
      if (load.name == '@traceur' || load.name == '@traceur-runtime')
        return '(function() { var curSystem = System; ' + source + '\nSystem = curSystem; })();';

      return source;
    });

  };

}
