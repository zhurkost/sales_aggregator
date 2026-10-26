import test from 'node:test';
import assert from 'node:assert/strict';
import {extension, extensionVersionOK} from '../lib/workspace.ts';

async function page(work) {
  const previous = new Map();
  const listeners = new Set();
  const sent = [];
  const origin = 'https://87.199.205.227';
  const window = {
    addEventListener(type, listener) { assert.equal(type,'message'); listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); },
    postMessage(message, target) { assert.equal(target,origin); sent.push(message); window.onSend?.(message); },
  };
  function reply(message, type, payload, overrides = {}) {
    for (const listener of listeners) listener({source:window,origin,data:{source:'autopost-extension',requestId:message.requestId,type,payload},...overrides});
  }
  for (const [key,value] of Object.entries({window,location:{origin}})) {
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{value,configurable:true});
  }
  try { await work({window,sent,reply}); assert.equal(listeners.size,0,'Request listeners must be cleaned up'); }
  finally { for (const [key,value] of previous) { if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]; } }
}

test('handshake retries when bridge arrives after the page has loaded', () => page(async ({window,sent,reply}) => {
  const pending = extension('PING',undefined,2000);
  window.onSend = message => reply(message,'RESPONSE',{version:'0.5.0'});
  assert.equal((await pending).version,'0.5.0');
  assert.equal(sent.length,2);
  assert.equal(sent[0].requestId,sent[1].requestId);
}));

test('a cold worker can take longer than two seconds without being marked missing', () => page(async ({window,sent,reply}) => {
  window.onSend = message => {
    reply(message,'ACK',{version:'0.5.0'});
    setTimeout(() => reply(message,'RESPONSE',{version:'0.5.0'}),2200);
  };
  assert.equal((await extension('PING')).version,'0.5.0');
  assert.equal(sent.length,1);
}));

test('worker timeout is distinguished from a missing bridge', () => page(async ({window,reply}) => {
  window.onSend = message => reply(message,'ACK',{version:'0.5.0'});
  await assert.rejects(extension('PING',undefined,20),/0\.5\.0 найдено, но его фоновая часть/);
  window.onSend = undefined;
  await assert.rejects(extension('PING',undefined,20),/Нет связи.*Обновите страницу/);
}));

test('launch is never retried and unrelated responses are ignored', () => page(async ({window,sent,reply}) => {
  window.onSend = message => {
    reply(message,'RESPONSE',{jobs:[]},{origin:'https://evil.invalid'});
    reply(message,'RESPONSE',{jobs:[]},{source:{}});
    reply({...message,requestId:'other'},'RESPONSE',{jobs:[]});
  };
  await assert.rejects(extension('RUN',{batchId:'single'},650),/Нет связи/);
  assert.equal(sent.length,1);
}));

test('version check requires price search and category field support', () => {
  assert.equal(extensionVersionOK('0.4.0'),false);
  assert.equal(extensionVersionOK('0.4.1'),false);
  assert.equal(extensionVersionOK('0.5.0'),true);
  assert.equal(extensionVersionOK(undefined),false);
  assert.equal(extensionVersionOK('not-a-version'),false);
});
