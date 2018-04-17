/* global chrome */
// This file is a template, not a module
// It will be added to the extension while the tests run, to let Cypress pass commands
// to the background tab and access the browser/chrome object and the local storage
// It MUST be standalone (no require/import will work, this is simple copy, not Webpack)
// It MAY contain an {{alias}} placeholder, to link it to a specific extension
const listenerSource = 'CypressBrowserExtensionBackgroundListener';
const responseSource = 'CypressBrowserExtensionBackgroundResponse';

const listeners = {};

// Duplicated log function since we can't (yet) use require in templates
function log(txt, ...rest) { console.log(`%cCypress ext bg %c${txt}`, 'color: gray; font-weight: lighter;', 'font-weight: bolder;', ...rest); }

function getProperty(chrome, property) {
  if (!property || property.trim() === '') return chrome;
  const propertyPath = property.split('.');
  return propertyPath.reduce((position, nextStep) => position[nextStep], chrome);
}

function logPromiseResult(promise) {
  promise.then(
    res => log('Command success', res) || res,
    err => log('Command error', err) || err,
  );
}

function addPromisifiedCb(args, resolve, reject) {
  return (args || []).concat(val => (
    (chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(val))
  ));
}

// calls method on (given property of) the browser API object and returns a promise
// since it can't know in advance if the method has a sync return, a promise or a callback,
// this relies on the message.returnType passed by the caller (set to 'callback' if cb)
function executeBrowserCommand(message) {
  const { debug, property, method, returnType, args } = message;
  if (debug) log(`Calling command ${property}.${method}()`, message);
  const promise = new Promise((resolve, reject) => {
    const target = getProperty(chrome, property);
    if (!method) { // always sync if just accessing property (no method)
      resolve(target);
    } else if (returnType === 'callback') {
      target[method].apply(this, addPromisifiedCb(args, resolve, reject));
    } else { // returnType sync or promise
      try {
        const res = target[message].apply(this, args);
        if (res && typeof res.then === 'function') {
          res.then(resolve, reject);
        } else {
          resolve(res);
        }
      } catch (err) {
        reject(err);
      }
    }
  });
  if (debug) logPromiseResult(promise);
  return promise;
}

function addListener(message) {
  const { debug, listenerId, property } = message;
  if (debug) log(`Adding listener ${listenerId} to ${property}`, message);
  const target = getProperty(chrome, property);
  const listener = function browserListener(payload) {
    // don't relay inner-working events of the plugin, in case this is a runtime.onMessage listener
    if (payload && payload.cypressExtType) return;
    if (debug) log(`Calling listener ${listenerId} on ${property}`, payload, message);
    chrome.runtime.sendMessage({
      cypressExtType: 'BrowserListener',
      source: listenerSource,
      listenerId,
      property,
      debug,
      payload,
    });
  };
  listeners[message.listenerId] = listener;
  target.addListener(listener);
}

function removeListener(message) {
  const { debug, listenerId, property } = message;
  if (debug) log(`Removing listener ${listenerId} from ${property}`, message);
  const target = getProperty(chrome, property);
  target.removeListener(listeners[listenerId]);
  delete listeners[listenerId];
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message.cypressExtType;
  if (type === 'BrowserCommand') {
    const { responseId } = message;
    executeBrowserCommand(message).then(
      response => sendResponse({ responseId, source: responseSource, response }),
      error => sendResponse({ responseId, source: responseSource, error }),
    );
    // tells browser API the response to sendResponse will be async
    return true;
  } else if (type === 'BrowserSubscription') {
    addListener(message);
  } else if (type === 'BrowserUnsubscription') {
    removeListener(message);
  }
  // default to sync sendResponse or no response
  return false;
});
