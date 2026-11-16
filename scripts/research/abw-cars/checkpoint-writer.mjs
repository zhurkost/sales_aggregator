// Full snapshots are expensive. Serialize writes and coalesce intermediate responses.
export function createCheckpointWriter(write,{intervalMs=2000,now=()=>Date.now()}={}){
  let revision=0,persisted=0,lastWrite=-Infinity,inFlight=null,current;
  const flush=async()=>{
    const savedRevision=revision,value=current;
    await write(value);persisted=savedRevision;lastWrite=now();
  };
  return {
    get dirty(){return revision!==persisted;},
    async save(value,{force=true}={}){
      current=value;revision++;
      while(inFlight)await inFlight;
      if(revision===persisted||(!force&&now()-lastWrite<intervalMs))return;
      inFlight=flush();
      try{await inFlight;}finally{inFlight=null;}
    }
  };
}
