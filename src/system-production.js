import { global, isBrowser } from './common.js';
import SystemJSProductionLoader from './systemjs-production-loader.js';

SystemJSProductionLoader.prototype.version = VERSION;

var System = new SystemJSProductionLoader();

// only set the global System on the window in browsers
if (typeof window !== 'undefined') {
  window.SystemJS = System;

  // dont override an existing System global
  if (!window.System) {
    window.System = System;
  }
  // rather just extend or set a System.register on the existing System global
  else {
    var register = window.System.register;
    window.System.register = function () {
      if (register)
        register.apply(this, arguments);
      System.register.apply(this, arguments);
    };
  }
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = System;
