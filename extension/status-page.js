(async function(){
  'use strict';
  if (window !== window.top) return;
  let task;
  try { task = (await chrome.runtime.sendMessage({kind:'GET_STATUS_TASK'}))?.task; } catch { return; }
  if (!task) return;
  const started = Date.now();
  let done = false, sending = false;
  const observer = new MutationObserver(()=>void inspect());
  const timer = setInterval(()=>void inspect(),1000);
  async function inspect() {
    if (done || sending) return;
    const visible = globalThis.AutopostDOM.visible;
    let result = globalThis.AutopostStatus.inspect(document,location.href,task,visible);
    // Give hydrated status banners time to appear before treating a detail page as visible.
    if (result?.state === 'visible' && Date.now()-started < 2500) return;
    if (!result && Date.now()-started < 7000) return;
    result ||= {state:'unknown',message:globalThis.AutopostStatus.labels.unknown};
    sending = true;
    try {
      const response = await chrome.runtime.sendMessage({kind:'REPORT_STATUS',checkId:task.id,result});
      if (response?.ok || response?.task === null) { done=true; observer.disconnect(); clearInterval(timer); }
    } catch { done=true; observer.disconnect(); clearInterval(timer); }
    finally { sending=false; }
  }
  observer.observe(document.documentElement,{childList:true,subtree:true});
  void inspect();
})();
