chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL('index.html');
  const existing=(await chrome.tabs.query({})).find(t=>t.url===url);
  if(existing)await chrome.tabs.update(existing.id,{active:true});
  else await chrome.tabs.create({url});
});
