/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

/**
 * Use the ./definitions/stubs.json manifest to create Chrome API stubs in
 * content process to communicate back to the add-ons main thread where the
 * implementation is handled.
 */

var path = require("path");
var fs = require("fs");
var stubs = require("../definitions/stubs.json");
var data = "";
var CONTENT_SCRIPT_DEST = path.join(__dirname, "..", "data", "chrome-api-child.js");

// Create header
data += "/**\n";
data += " * THIS FILE GENERATED BY ./scripts/build-chrome-api-child.js\n";
data += " * DO NOT EDIT MANUALLY.\n";
data += " */\n\n";

// Add core `chrome` object
data += "var chrome = createObjectIn(unsafeWindow, { defineAs: \"chrome\" });\n";
data += "var INC_ID = 0;\n";

Object.keys(stubs).forEach(function (namespace) {
  data += createObjectsFor(namespace);
  data += createFunctionsFor(namespace, stubs);
});

// Expose our functions
data += chromeAPIBridge.toString() + "\n";
data += cleanse.toString() + "\n";

fs.writeFileSync(CONTENT_SCRIPT_DEST, data);

/**
 * Turns an api name like "experimental.devtools.audit" into a variable
 * like `experimentaldevtoolsaudit`, based on which index to stop.
 */
function identify (apiName, index) {
  var namePieces = Array.isArray(apiName) ? apiName : apiName.split(".");
  return namePieces.reduce(function (acc, chunk, i) {
    if (index === void 0 || i <= index) {
      acc += chunk;
    }
    return acc;
  }, "");
}

/**
 * Used in content script. Gets stringified.
 */
function chromeAPIBridge (config) {
  var id = INC_ID++;
  var args = Array.prototype.slice.call(arguments);
  var successCallback = config.success ? args[config.success] : null;
  // Not really supporting failureCallback at the moment, as only one API uses it.
  var failureCallback = config.failure ? args[config.failure] : null;

  // Pop off the configuration;
  args.shift();

  self.port.on("chrome-api:response", handler);
  self.port.emit("chrome-api:request", {
    method: config.method,
    args: args,
    id: id,
    namespace: config.namespace,
    success: config.success,
    failure: config.failure
  });

  function handler (data) {
    if (data.id !== id) {
      return;
    }
    self.port.removeListener("chrome-api:response", handler);
    if (typeof successCallback === "function") {
      if (data.res != null) {
        callback.apply(null, cleanse(res));
      } else {
        callback();
      }
    }
  }
}

/**
 * Used in content script. Gets stringified.
 */
function cleanse (obj) {
  return unsafeWindow.JSON.parse(JSON.stringify(obj));
}

/**
 * Takes a namespace like "devtools.inspectedWindow" and returns
 * a string to be used in generating a content script, like
 * 'var devtools = createObjectIn(chrome, { defineAs: "devtools" });'
 * 'var devtoolsinspectedwindow = createObjectIn(chrome.devtools, { defineAs: "inspectedWindow" });'
 *
 * @param {string} namespace
 * @return {string}
 */
function createObjectsFor (namespace) {
  var namespaces = namespace.split(".");
  var output = "";
  for (var i = 0; i < namespaces.length; i++) {
    var identifier = identify(namespaces, i);
    var name = namespaces[i];
    var owner = i === 0 ? "chrome" : identify(namespaces, i - 1);
    output += "var " + identifier + " = createObjectIn(" + owner + ", { defineAs: \"" + name + "\" });\n";
  }
  return output;
};

/**
 * Takes a namespace like "tabs", and a stub object from ./definitions/stubs.json
 * and constructs and returns the `exposeFunction` string bound to the chromeAPIBridge helper.
 *
 * @param {string} namespace
 * @param {object} stubs
 * @return {string}
 */
function createFunctionsFor (namespace) {
  var def = stubs[namespace];
  var output = "";
  var start = "exportFunction(chromeAPIBridge.bind(null,";
 
  var expose = function (fn) {
    var params = JSON.stringify({
      namespace: namespace,
      method: fn.name,
      success: fn.successCallbackIndex,
      failure: fn.failureCallbackIndex
    });
    return start + params + "," + suffix(fn.name);
  };
  var suffix = function (name) {
    return identify(namespace) + ",{ defineAs:\"" + name + "\"});\n";
  };

  (def.functions || []).forEach(function (fnDef) {
    output += expose(fnDef);
  });

  return output;
}
